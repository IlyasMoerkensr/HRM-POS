/**
 * Kassalade via USB (virtuele COM-poort) met de Web Serial API.
 *
 * Draait in de BROWSER van de kassa-pc (Chrome of Edge op desktop).
 * Vereisten:
 *  - De pagina moet op `http://localhost:...` of via HTTPS draaien (secure context).
 *    Start de kassa dus op de pc zelf en open http://localhost:3000.
 *  - De eerste keer moet een medewerker één keer op "Kassalade koppelen" klikken
 *    (de browser vraagt dan welke COM-poort). Daarna verbindt de kassa bij elke
 *    start automatisch opnieuw met dezelfde poort.
 *  - Er kan maar één programma tegelijk de COM-poort open hebben. Sluit dus
 *    andere kassa-tabbladen of drivers-testtools.
 *
 * Bedrijfsregels (zie onderaan):
 *  - Lade opent ALLEEN bij een contant (deel)bedrag, nooit bij 100% pin.
 *  - "Geen verkoop" vereist een reden en een medewerker, en wordt eerst
 *    gelogd en pas dán geopend (ook als de lade niet reageert, staat het in de log).
 */

/// <reference types="w3c-web-serial" />

// ---------------------------------------------------------------------------
//  Instellingen
// ---------------------------------------------------------------------------

/**
 * Hoe de lade geopend wordt:
 *  - 'escpos': stuur de kick-code (standaard voor USB-laden met COM-poort)
 *  - 'dtr' / 'rts': zet kort een stuursignaal hoog (sommige goedkope USB-laden)
 */
export type DrawerTrigger = 'escpos' | 'dtr' | 'rts';

export interface CashDrawerConfig {
  baudRate: number;
  /** Bytes die de lade opent. Standaard ESC p 0 25 250 */
  kickCode: number[];
  trigger: DrawerTrigger;
  /** Duur van het DTR/RTS-signaal in ms */
  pulseMs: number;
  /** Na het openen de poort open houden (sneller) of sluiten (vrijgeven) */
  keepPortOpen: boolean;
}

export const DEFAULT_KICK_CODE = [0x1b, 0x70, 0x00, 0x19, 0xfa]; // = [27, 112, 0, 25, 250]

export const DEFAULT_DRAWER_CONFIG: CashDrawerConfig = {
  baudRate: 9600,
  kickCode: DEFAULT_KICK_CODE,
  trigger: 'escpos',
  pulseMs: 200,
  keepPortOpen: true,
};

const STORAGE_KEY = 'kassa.cashDrawer.port';
const WRITE_TIMEOUT_MS = 2000;

/**
 * Leest een kick-code uit het admin-scherm. Toegestaan:
 *   "1B 70 00 19 FA"      (hex, met spaties)
 *   "0x1B,0x70,0x00,0x19,0xFA"
 *   "1B7000 19FA"         (hex aaneengesloten)
 *   "27,112,0,25,250"     (decimaal, met komma's)
 *   "dec: 27 112 0 25 250"
 *
 * Regel: komma's zonder hex-tekens = decimaal. Anders hex. Twijfel? Zet er
 * "dec:" of "hex:" voor.
 */
export function parseKickCode(input: string): number[] {
  let text = input.trim().toLowerCase();
  if (!text) throw new Error('Kick-code is leeg');

  let mode: 'hex' | 'dec' | 'auto' = 'auto';
  if (text.startsWith('hex:')) {
    mode = 'hex';
    text = text.slice(4);
  } else if (text.startsWith('dec:')) {
    mode = 'dec';
    text = text.slice(4);
  }

  const hasHexHints = /0x|[a-f]/.test(text);
  if (mode === 'auto') mode = text.includes(',') && !hasHexHints ? 'dec' : 'hex';

  let tokens = text.split(/[\s,;]+/).filter(Boolean).map((t) => t.replace(/^0x/, ''));
  if (mode === 'hex' && tokens.length === 1 && tokens[0].length > 2) {
    // "1b700019fa" → ["1b","70","00","19","fa"]
    if (tokens[0].length % 2 !== 0) throw new Error('Hex-code moet een even aantal tekens hebben');
    tokens = tokens[0].match(/.{2}/g) ?? [];
  }

  const bytes = tokens.map((t) => {
    const valid = mode === 'hex' ? /^[0-9a-f]{1,2}$/.test(t) : /^\d{1,3}$/.test(t);
    const value = mode === 'hex' ? parseInt(t, 16) : parseInt(t, 10);
    if (!valid || Number.isNaN(value) || value < 0 || value > 255) {
      throw new Error(`Ongeldige byte "${t}" in kick-code`);
    }
    return value;
  });
  if (bytes.length === 0 || bytes.length > 32) throw new Error('Kick-code moet 1 tot 32 bytes zijn');
  return bytes;
}

/** [27,112,0,25,250] → "1B 70 00 19 FA" */
export function formatKickCode(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

// ---------------------------------------------------------------------------
//  Hardware-service
// ---------------------------------------------------------------------------

export type DrawerStatus = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error';

export interface DrawerOpenResult {
  ok: boolean;
  error?: string;
}

interface SavedPort {
  usbVendorId?: number;
  usbProductId?: number;
}

type Listener = (status: DrawerStatus, error?: string) => void;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CashDrawer {
  private port: SerialPort | null = null;
  private config: CashDrawerConfig;
  private status: DrawerStatus;
  private lastError: string | undefined;
  private listeners = new Set<Listener>();
  /** Alle poortacties achter elkaar, nooit tegelijk (dubbelklik-veilig) */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(config: Partial<CashDrawerConfig> = {}) {
    this.config = { ...DEFAULT_DRAWER_CONFIG, ...config };
    this.status = CashDrawer.isSupported() ? 'disconnected' : 'unsupported';

    if (CashDrawer.isSupported()) {
      navigator.serial.addEventListener('disconnect', (event) => {
        if (event.target === this.port) {
          this.port = null;
          this.setStatus('disconnected', 'USB-kabel van de kassalade losgekoppeld');
        }
      });
      navigator.serial.addEventListener('connect', () => {
        // Kabel teruggeplaatst → stil opnieuw verbinden met de bekende poort
        if (this.status !== 'connected') void this.autoConnect();
      });
    }
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator && window.isSecureContext;
  }

  getStatus(): { status: DrawerStatus; error?: string } {
    return { status: this.status, error: this.lastError };
  }

  getConfig(): CashDrawerConfig {
    return { ...this.config, kickCode: [...this.config.kickCode] };
  }

  /** Nieuwe instellingen uit admin. Bij andere baudrate wordt de poort heropend. */
  async updateConfig(config: Partial<CashDrawerConfig>): Promise<void> {
    const baudChanged = config.baudRate !== undefined && config.baudRate !== this.config.baudRate;
    this.config = { ...this.config, ...config };
    if (baudChanged && this.port) {
      await this.enqueue(async () => {
        await this.closePort();
        await this.openPort();
      });
    }
  }

  onStatusChange(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status, this.lastError);
    return () => this.listeners.delete(listener);
  }

  /**
   * Eerste koppeling. MOET aangeroepen worden vanuit een klik (user gesture),
   * anders weigert de browser het poortkeuze-venster.
   */
  async connect(): Promise<DrawerOpenResult> {
    if (!CashDrawer.isSupported()) return this.unsupported();
    return this.enqueue(async () => {
      try {
        this.setStatus('connecting');
        const port = await navigator.serial.requestPort();
        await this.closePort();
        this.port = port;
        await this.openPort();
        const info = port.getInfo();
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ usbVendorId: info.usbVendorId, usbProductId: info.usbProductId } satisfies SavedPort));
        } catch {
          /* localStorage niet beschikbaar: dan alleen geen auto-reconnect */
        }
        this.setStatus('connected');
        return { ok: true };
      } catch (err) {
        const message = err instanceof DOMException && err.name === 'NotFoundError'
          ? 'Geen poort gekozen'
          : describeError(err);
        this.setStatus(this.port ? 'error' : 'disconnected', message);
        return { ok: false, error: message };
      }
    });
  }

  /**
   * Bij opstarten van het kassascherm: verbind zonder klik met een eerder
   * toegestane poort. Geeft false als er (nog) geen bekende poort is.
   */
  async autoConnect(): Promise<boolean> {
    if (!CashDrawer.isSupported()) return false;
    return this.enqueue(async () => {
      if (this.port?.writable) return true;
      const ports = await navigator.serial.getPorts();
      if (ports.length === 0) return false;

      let saved: SavedPort | null = null;
      try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedPort | null;
      } catch {
        saved = null;
      }
      const match =
        ports.find((p) => {
          const info = p.getInfo();
          return saved && info.usbVendorId === saved.usbVendorId && info.usbProductId === saved.usbProductId;
        }) ?? (ports.length === 1 ? ports[0] : undefined);
      if (!match) return false;

      try {
        this.setStatus('connecting');
        this.port = match;
        await this.openPort();
        this.setStatus('connected');
        return true;
      } catch (err) {
        this.setStatus('error', describeError(err));
        return false;
      }
    });
  }

  async disconnect(forget = false): Promise<void> {
    await this.enqueue(async () => {
      const port = this.port;
      await this.closePort();
      this.port = null;
      if (forget && port && 'forget' in port) {
        await (port as SerialPort & { forget(): Promise<void> }).forget();
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* negeren */
        }
      }
      this.setStatus('disconnected');
    });
  }

  /**
   * Stuurt de lade aan. Gebruik dit NIET direct vanuit de UI, maar via
   * openDrawerForPayment() of openDrawerNoSale() hieronder, zodat de
   * bedrijfsregels en logging altijd gelden.
   */
  async kick(): Promise<DrawerOpenResult> {
    if (!CashDrawer.isSupported()) return this.unsupported();
    return this.enqueue(async () => {
      try {
        if (!this.port?.writable) {
          const reconnected = await this.reconnectInsideQueue();
          if (!reconnected) {
            return { ok: false, error: 'Kassalade niet verbonden. Klik op "Kassalade koppelen".' };
          }
        }
        const port = this.port!;

        if (this.config.trigger === 'escpos') {
          await this.write(port, Uint8Array.from(this.config.kickCode));
        } else {
          const signal = this.config.trigger === 'dtr' ? 'dataTerminalReady' : 'requestToSend';
          await port.setSignals({ [signal]: true });
          await sleep(this.config.pulseMs);
          await port.setSignals({ [signal]: false });
        }

        if (!this.config.keepPortOpen) await this.closePort();
        this.setStatus(this.config.keepPortOpen ? 'connected' : 'disconnected');
        return { ok: true };
      } catch (err) {
        const message = describeError(err);
        // Poort in foutstatus: sluiten zodat de volgende poging schoon heropent
        await this.closePort().catch(() => undefined);
        this.setStatus('error', message);
        return { ok: false, error: message };
      }
    });
  }

  // ---- intern -------------------------------------------------------------

  private async reconnectInsideQueue(): Promise<boolean> {
    if (!this.port) {
      const ports = await navigator.serial.getPorts();
      if (ports.length !== 1) return false;
      this.port = ports[0];
    }
    try {
      await this.openPort();
      return true;
    } catch {
      return false;
    }
  }

  private async openPort(): Promise<void> {
    if (!this.port) throw new Error('Geen poort');
    if (this.port.writable) return; // al open
    await this.port.open({
      baudRate: this.config.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    });
  }

  private async closePort(): Promise<void> {
    if (!this.port) return;
    try {
      if (this.port.readable || this.port.writable) await this.port.close();
    } catch {
      /* al dicht */
    }
  }

  private async write(port: SerialPort, data: Uint8Array): Promise<void> {
    if (!port.writable) throw new Error('Poort is niet schrijfbaar');
    const writer = port.writable.getWriter();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        writer.write(data),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Kassalade reageert niet (time-out)')), WRITE_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      await writer.abort().catch(() => undefined);
      throw err;
    } finally {
      clearTimeout(timer);
      writer.releaseLock();
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private setStatus(status: DrawerStatus, error?: string) {
    this.status = status;
    this.lastError = error;
    for (const listener of this.listeners) listener(status, error);
  }

  private unsupported(): DrawerOpenResult {
    return {
      ok: false,
      error: 'Deze browser ondersteunt geen USB/COM-poorten. Gebruik Chrome of Edge op de kassa-pc via http://localhost.',
    };
  }
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'InvalidStateError':
        return 'COM-poort is al in gebruik (ander tabblad of programma open?)';
      case 'NetworkError':
        return 'Kan de COM-poort niet openen (kabel los of in gebruik)';
      case 'SecurityError':
        return 'Browser blokkeert de COM-poort (alleen via localhost of https)';
      default:
        return `${err.name}: ${err.message}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/** Eén lade per kassa-pc. Alleen in de browser aanmaken. */
let instance: CashDrawer | null = null;
export function getCashDrawer(config?: Partial<CashDrawerConfig>): CashDrawer {
  if (typeof window === 'undefined') throw new Error('Kassalade is alleen beschikbaar in de browser');
  if (!instance) instance = new CashDrawer(config);
  else if (config) void instance.updateConfig(config);
  return instance;
}

// ---------------------------------------------------------------------------
//  Bedrijfsregels
// ---------------------------------------------------------------------------

export interface PaymentLike {
  method: 'CASH' | 'MOLLIE';
  amountCents: number;
}

/**
 * Open de lade alleen als er contant geld in óf uit gaat.
 * 100% Mollie → dicht. Split €20 contant + rest pin → open.
 * Contante terugbetaling bij creditbon (negatief bedrag) → open.
 */
export function shouldOpenDrawer(payments: PaymentLike[]): boolean {
  return payments.some((p) => p.method === 'CASH' && p.amountCents !== 0);
}

/**
 * Lade openen na een betaling. `payments` = de zojuist geregistreerde
 * betalingen van deze bon.
 */
export async function openDrawerForPayment(
  payments: PaymentLike[],
  drawer: CashDrawer = getCashDrawer(),
): Promise<DrawerOpenResult & { skipped?: boolean }> {
  if (!shouldOpenDrawer(payments)) return { ok: true, skipped: true };
  return drawer.kick();
}

export interface NoSaleRequest {
  userId: string;
  reason: string;
}

/**
 * "Open kassalade (geen verkoop)". De registratie gebeurt EERST op de server
 * (via `log`), pas daarna gaat de lade open. Lukt het loggen niet, dan gaat de
 * lade ook niet open — zo bestaat er nooit een ongeregistreerde opening.
 *
 * @param log  bijv. `(r) => fetch('/api/cash/no-sale', { method: 'POST', body: JSON.stringify(r) })`
 *             en daarna `confirm(id, opened)` om vast te leggen of de lade echt reageerde.
 */
export async function openDrawerNoSale(
  request: NoSaleRequest,
  log: {
    register: (request: NoSaleRequest) => Promise<{ movementId: string }>;
    confirm: (movementId: string, result: DrawerOpenResult) => Promise<void>;
  },
  drawer: CashDrawer = getCashDrawer(),
): Promise<DrawerOpenResult> {
  const reason = request.reason.trim();
  if (!request.userId) return { ok: false, error: 'Kies eerst een medewerker' };
  if (reason.length < 3) return { ok: false, error: 'Vul een reden in (minimaal 3 tekens)' };

  const { movementId } = await log.register({ userId: request.userId, reason });
  const result = await drawer.kick();
  await log.confirm(movementId, result).catch(() => undefined);
  return result;
}
