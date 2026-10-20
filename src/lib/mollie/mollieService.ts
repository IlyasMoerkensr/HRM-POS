/**
 * Mollie Tap to Pay-koppeling — ALLEEN SERVER-SIDE gebruiken
 * (API-routes / server actions). De API-sleutel mag nooit naar de browser.
 *
 * ┌──────────── Architectuur ─────────────────────────────────────────────────┐
 * │                                                                           │
 * │  Elke medewerker logt op de eigen telefoon in de Mollie Tap-app in. Mollie │
 * │  ziet die telefoon als een "terminal" met een eigen ID (term_xxx). In de   │
 * │  kassa koppelen we elke medewerker aan zijn/haar terminal-ID              │
 * │  (User.mollieTerminalId). Daarmee weten we bij ELKE Mollie-transactie op   │
 * │  welke telefoon — dus door welke medewerker — er gepind is.                │
 * │                                                                           │
 * │  Modus A  Kassa-pc → POST /v2/payments {method: pointofsale, terminalId}   │
 * │           → bedrag verschijnt vanzelf op de telefoon → klant tikt →        │
 * │           webhook/polling → status "paid" → bon sluit automatisch.         │
 * │                                                                           │
 * │  Modus B  Zelfde API-aanroep, maar gestart vanaf de telefoon van de        │
 * │           medewerker (companion web-app). De telefoon pusht het bedrag     │
 * │           naar zichzelf. Niets overtypen, dus geen tikfouten.             │
 * │                                                                           │
 * │  Modus C  Medewerker tikt het bedrag zelf in Mollie Tap en bevestigt in    │
 * │           de kassa. Er is dan nog geen tr_-ID; de dagcontrole zoekt de     │
 * │           bijbehorende Mollie-transactie op bedrag + telefoon + tijd.      │
 * │                                                                           │
 * │  Dagcontrole  Alle Mollie point-of-sale-transacties van de dag ophalen en  │
 * │           naast de kassabetalingen leggen → per medewerker het verschil.   │
 * │                                                                           │
 * │  Uitbetalingen  Settlements API → bruto omzet, ingehouden kosten, netto    │
 * │           uitbetaald → journaalpost voor 1150 Tussenrekening Mollie.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Webhook of polling?
 *   Mollie kan alleen een webhook sturen naar een publiek bereikbaar adres
 *   (https://...). Draait de kassa alleen lokaal op de pc, dan is er geen
 *   webhook en vraagt het kassascherm elke 2 seconden de status op
 *   (refreshPaymentStatus). Beide wegen komen uit bij syncMolliePayment(),
 *   die idempotent is: dubbele meldingen zijn onschadelijk.
 *
 * Omgevingsvariabelen: zie .env.example
 */

import createMollieClient, { MollieApiError, PaymentMethod, type MollieClient } from '@mollie/api-client';
import type { PaymentStatus as DbPaymentStatus, Prisma } from '@prisma/client';

import { audit } from '../audit';
import { formatEUR, parseMollieAmount, toMollieAmount } from '../money';
import { remainingToPay, settleOrderIfFullyPaid } from '../orders/settle';
import { prisma } from '../prisma';
import { shopDateString, shopDayRange } from '../time';

// ===========================================================================
//  Configuratie & client
// ===========================================================================

export interface MollieConfig {
  apiKey: string;
  testMode: boolean;
  /** Publieke basis-URL (https) voor webhooks. Leeg = alleen polling. */
  webhookBaseUrl: string | null;
  /** Organisatie-token: nodig voor Settlements (uitbetalingen + kosten). */
  orgAccessToken: string | null;
}

export function getMollieConfig(): MollieConfig {
  const apiKey = process.env.MOLLIE_API_KEY ?? '';
  if (!/^(live|test)_\w{20,}$/.test(apiKey)) {
    throw new MollieNotConfiguredError(
      'MOLLIE_API_KEY ontbreekt of is ongeldig (verwacht live_... of test_...). Pinnen kan dan alleen via modus C.',
    );
  }
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') || null;
  // Mollie weigert webhooks naar localhost/LAN-adressen
  const webhookBaseUrl = base && /^https:\/\//.test(base) && !/localhost|127\.0\.0\.1|192\.168\.|10\.\d/.test(base) ? base : null;
  return {
    apiKey,
    testMode: apiKey.startsWith('test_'),
    webhookBaseUrl,
    orgAccessToken: process.env.MOLLIE_ORG_ACCESS_TOKEN || null,
  };
}

export class MollieNotConfiguredError extends Error {
  readonly name = 'MollieNotConfiguredError';
}

export class PosPaymentError extends Error {
  readonly name = 'PosPaymentError';
}

let paymentsClient: MollieClient | null = null;
let orgClient: MollieClient | null = null;

/** Alleen voor ontwikkelen/testen tegen een nep-Mollie-server; normaal leeg. */
const apiEndpoint = () => process.env.MOLLIE_API_ENDPOINT || undefined;
const versionStrings = 'HRM-Kassa/0.1';

function client(): MollieClient {
  if (!paymentsClient) paymentsClient = createMollieClient({ apiKey: getMollieConfig().apiKey, apiEndpoint: apiEndpoint(), versionStrings });
  return paymentsClient;
}

function organizationClient(): MollieClient {
  const { orgAccessToken } = getMollieConfig();
  if (!orgAccessToken) {
    throw new MollieNotConfiguredError(
      'MOLLIE_ORG_ACCESS_TOKEN ontbreekt. Maak in het Mollie Dashboard een organisatie-token aan met recht "settlements.read" om uitbetalingen en kosten op te halen.',
    );
  }
  if (!orgClient) orgClient = createMollieClient({ accessToken: orgAccessToken, apiEndpoint: apiEndpoint(), versionStrings });
  return orgClient;
}

// ===========================================================================
//  Telefoons (terminals) ↔ medewerkers
// ===========================================================================

export interface PhoneTerminal {
  terminalId: string;
  description: string;
  status: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  linkedUser: { id: string; name: string } | null;
}

/**
 * Alle Tap to Pay-telefoons (en eventuele vaste terminals) in het Mollie-account,
 * met de medewerker aan wie ze gekoppeld zijn. Gebruikt in het admin-scherm
 * "Telefoons koppelen".
 *
 * Verschijnt een telefoon hier niet? Dan is de Mollie Tap-app op die telefoon
 * nog niet ingelogd/geactiveerd op hetzelfde Mollie-profiel als de API-sleutel.
 */
export async function listPhoneTerminals(): Promise<PhoneTerminal[]> {
  const users = await prisma.user.findMany({
    where: { mollieTerminalId: { not: null } },
    select: { id: true, name: true, mollieTerminalId: true },
  });
  const byTerminal = new Map(users.map((u) => [u.mollieTerminalId!, { id: u.id, name: u.name }]));

  const result: PhoneTerminal[] = [];
  for await (const t of client().terminals.iterate()) {
    result.push({
      terminalId: t.id,
      description: t.description,
      status: t.status,
      brand: t.brand,
      model: t.model,
      serialNumber: t.serialNumber,
      linkedUser: byTerminal.get(t.id) ?? null,
    });
  }
  return result;
}

export async function linkPhoneToUser(userId: string, terminalId: string | null, adminUserId: string, phoneLabel?: string) {
  if (terminalId) {
    const terminal = await client().terminals.get(terminalId);
    if (terminal.status !== 'active') {
      throw new PosPaymentError(`Terminal ${terminalId} is niet actief in Mollie (status: ${terminal.status})`);
    }
  }
  await prisma.$transaction(async (tx) => {
    // Een telefoon hoort bij precies één medewerker
    if (terminalId) {
      await tx.user.updateMany({ where: { mollieTerminalId: terminalId, NOT: { id: userId } }, data: { mollieTerminalId: null } });
    }
    await tx.user.update({ where: { id: userId }, data: { mollieTerminalId: terminalId, phoneLabel: phoneLabel ?? undefined } });
    await audit(tx, { action: 'PHONE_LINKED', userId: adminUserId, entity: 'User', entityId: userId, data: { terminalId } });
  });
}

// ===========================================================================
//  Modus A + B: betaling naar de telefoon van een medewerker sturen
// ===========================================================================

export interface StartTerminalPaymentInput {
  orderId: string;
  amountCents: number;
  /** Medewerker op wiens telefoon gepind wordt (standaard: wie de bon aanslaat) */
  employeeId: string;
  /** Wie de actie startte (kassa-pc of telefoon) — voor de audit trail */
  initiatedById: string;
  mode: 'API' | 'PUSH';
  /** Uniek per klik in de UI; voorkomt dubbele betaalverzoeken bij dubbelklik/netwerkfout */
  idempotencyKey: string;
}

export interface StartedTerminalPayment {
  paymentId: string;
  molliePaymentId: string;
  status: DbPaymentStatus;
  amountCents: number;
  employeeName: string;
  /** Alleen in testmodus: link om de betaling handmatig op paid/failed te zetten */
  testChangeStateUrl?: string;
}

export async function startTerminalPayment(input: StartTerminalPaymentInput): Promise<StartedTerminalPayment> {
  const config = getMollieConfig();
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PosPaymentError('Bedrag moet groter dan € 0,00 zijn');
  }

  // Dubbelklik / herhaalde aanvraag: geef het bestaande verzoek terug
  const existing = await prisma.payment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { employee: true },
  });
  if (existing?.molliePaymentId) {
    return {
      paymentId: existing.id,
      molliePaymentId: existing.molliePaymentId,
      status: existing.status,
      amountCents: existing.amountCents,
      employeeName: existing.employee.name,
    };
  }

  // 1. Lokaal reserveren (in één transactie, zodat twee medewerkers niet
  //    tegelijk het restant van dezelfde bon kunnen laten pinnen)
  const local = existing ?? (await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { businessDay: true },
    });
    if (order.status !== 'PENDING_PAYMENT' || !order.number) {
      throw new PosPaymentError('Bon is niet klaar om af te rekenen (geen bonnummer of al afgerond)');
    }
    if (order.businessDay.status !== 'OPEN') throw new PosPaymentError('Kassadag is al afgesloten');
    if (order.type !== 'SALE') throw new PosPaymentError('Gebruik refundViaMollie() voor creditbonnen');

    const pending = await tx.payment.count({ where: { orderId: order.id, method: 'MOLLIE', status: 'PENDING' } });
    if (pending > 0) throw new PosPaymentError('Er loopt al een pinbetaling voor deze bon. Wacht of annuleer die eerst.');

    const remaining = await remainingToPay(tx, order.id);
    if (input.amountCents > remaining) {
      throw new PosPaymentError(`Bedrag (${formatEUR(input.amountCents)}) is hoger dan het restant (${formatEUR(remaining)})`);
    }

    const employee = await tx.user.findUniqueOrThrow({ where: { id: input.employeeId } });
    if (!employee.active) throw new PosPaymentError(`${employee.name} is niet actief`);
    if (!employee.mollieTerminalId) {
      throw new PosPaymentError(
        `De telefoon van ${employee.name} is nog niet gekoppeld aan Mollie. Koppel hem in Instellingen → Telefoons, of gebruik "handmatig bevestigen".`,
      );
    }

    // Telefoon al bezig met een andere bon?
    const busy = await tx.payment.findFirst({
      where: { mollieTerminalId: employee.mollieTerminalId, status: 'PENDING', method: 'MOLLIE' },
      include: { order: { select: { number: true } } },
    });
    if (busy) {
      throw new PosPaymentError(`De telefoon van ${employee.name} wacht nog op betaling van ${busy.order.number}.`);
    }

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        method: 'MOLLIE',
        mollieMode: input.mode,
        status: 'PENDING',
        amountCents: input.amountCents,
        employeeId: employee.id,
        mollieTerminalId: employee.mollieTerminalId,
        idempotencyKey: input.idempotencyKey,
      },
      include: { employee: true },
    });
    return payment;
  }));

  const order = await prisma.order.findUniqueOrThrow({ where: { id: local.orderId } });

  // 2. Betaalverzoek naar Mollie → verschijnt op de telefoon
  try {
    const molliePayment = await client().payments.create({
      method: PaymentMethod.pointofsale,
      terminalId: local.mollieTerminalId!,
      amount: toMollieAmount(local.amountCents),
      // Staat in het Mollie Dashboard en op het afschrift → zo vindt de boekhouder de bon terug
      description: `${order.number} – ${local.employee.name}`,
      metadata: {
        orderId: order.id,
        orderNumber: order.number,
        paymentId: local.id,
        employeeId: local.employeeId,
        mode: input.mode,
      },
      webhookUrl: config.webhookBaseUrl ? `${config.webhookBaseUrl}/api/mollie/webhook` : undefined,
      idempotencyKey: input.idempotencyKey,
    });

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: local.id },
        data: { molliePaymentId: molliePayment.id, mollieStatus: molliePayment.status },
      });
      await audit(tx, {
        action: 'MOLLIE_PAYMENT_CREATED',
        userId: input.initiatedById,
        entity: 'Payment',
        entityId: local.id,
        data: {
          molliePaymentId: molliePayment.id,
          terminalId: local.mollieTerminalId,
          amountCents: local.amountCents,
          mode: input.mode,
          orderNumber: order.number,
        },
      });
    });

    return {
      paymentId: local.id,
      molliePaymentId: molliePayment.id,
      status: 'PENDING',
      amountCents: local.amountCents,
      employeeName: local.employee.name,
      testChangeStateUrl: config.testMode ? molliePayment._links.changePaymentState?.href : undefined,
    };
  } catch (err) {
    // Mollie weigerde of onbereikbaar → lokaal als mislukt markeren, zodat de
    // medewerker direct opnieuw kan proberen of modus C/contant kan kiezen.
    const message = mollieErrorMessage(err);
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: local.id },
        data: { status: 'FAILED', mollieStatusReason: message, idempotencyKey: null },
      });
      await audit(tx, { action: 'MOLLIE_PAYMENT_CREATE_FAILED', userId: input.initiatedById, entity: 'Payment', entityId: local.id, data: { message } });
    });
    throw new PosPaymentError(`Mollie: ${message}`);
  }
}

// ===========================================================================
//  Status bijwerken (webhook + polling)
// ===========================================================================

const FINAL: DbPaymentStatus[] = ['PAID', 'FAILED', 'CANCELED', 'EXPIRED'];

function mapMollieStatus(status: string): DbPaymentStatus {
  switch (status) {
    case 'paid':
      return 'PAID';
    case 'failed':
      return 'FAILED';
    case 'canceled':
      return 'CANCELED';
    case 'expired':
      return 'EXPIRED';
    default: // open, pending, authorized
      return 'PENDING';
  }
}

interface PosDetails {
  terminalId?: string;
  cardNumber?: string;
  cardLabel?: string;
}

/**
 * Haalt de ECHTE status op bij Mollie en verwerkt die. Wordt aangeroepen door
 * de webhook én door polling. We vertrouwen nooit op de inhoud van een
 * webhook-verzoek zelf: alleen het ID, de rest komt rechtstreeks van Mollie.
 *
 * @returns null als het geen betaling van deze kassa is.
 */
export async function syncMolliePayment(molliePaymentId: string): Promise<{ paymentId: string; status: DbPaymentStatus; orderPaid: boolean } | null> {
  if (!/^tr_\w+$/.test(molliePaymentId)) return null;

  const mp = await client().payments.get(molliePaymentId);
  const metadata = (mp.metadata ?? {}) as { paymentId?: string };

  const local =
    (await prisma.payment.findUnique({ where: { molliePaymentId } })) ??
    // Server crashte tussen Mollie-aanroep en opslaan van tr_: herstel via metadata
    (metadata.paymentId ? await prisma.payment.findUnique({ where: { id: metadata.paymentId } }) : null);
  if (!local) return null;

  const newStatus = mapMollieStatus(mp.status);
  const details = (mp.details ?? {}) as PosDetails;
  const mollieAmount = parseMollieAmount(mp.amount);

  return prisma.$transaction(async (tx) => {
    const current = await tx.payment.findUniqueOrThrow({ where: { id: local.id } });

    // Nooit terug van een eindstatus (bijv. PAID → PENDING door oude webhook)
    const statusChanges = current.status !== newStatus && !FINAL.includes(current.status);

    if (mollieAmount !== current.amountCents) {
      await audit(tx, {
        action: 'MOLLIE_AMOUNT_MISMATCH',
        entity: 'Payment',
        entityId: current.id,
        data: { molliePaymentId, posAmountCents: current.amountCents, mollieAmountCents: mollieAmount },
      });
    }

    await tx.payment.update({
      where: { id: current.id },
      data: {
        molliePaymentId,
        mollieStatus: mp.status,
        mollieStatusReason: mp.statusReason ? `${mp.statusReason.code}: ${mp.statusReason.message}` : current.mollieStatusReason,
        mollieTerminalId: details.terminalId ?? current.mollieTerminalId,
        cardLast4: details.cardNumber?.slice(-4) ?? current.cardLast4,
        cardLabel: details.cardLabel ?? current.cardLabel,
        mollieSettlementId: mp.settlementId ?? current.mollieSettlementId,
        ...(statusChanges
          ? { status: newStatus, paidAt: newStatus === 'PAID' ? (mp.paidAt ? new Date(mp.paidAt) : new Date()) : null }
          : {}),
      },
    });

    if (statusChanges) {
      await audit(tx, {
        action: 'MOLLIE_STATUS',
        entity: 'Payment',
        entityId: current.id,
        data: { molliePaymentId, from: current.status, to: newStatus, mollieStatus: mp.status },
      });
    }

    const finalStatus = statusChanges ? newStatus : current.status;
    const orderPaid = finalStatus === 'PAID' ? await settleOrderIfFullyPaid(tx, current.orderId) : false;
    return { paymentId: current.id, status: finalStatus, orderPaid };
  });
}

/**
 * Voor polling vanaf het kassascherm / de telefoon (elke ~2 s).
 * Vraagt Mollie alleen zolang de betaling nog PENDING is.
 */
export async function refreshPaymentStatus(paymentId: string) {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { order: { select: { id: true, number: true, status: true, totalInclCents: true } }, employee: { select: { name: true } } },
  });

  let status = payment.status;
  let orderStatus = payment.order.status;
  if (payment.status === 'PENDING' && payment.molliePaymentId) {
    const synced = await syncMolliePayment(payment.molliePaymentId);
    if (synced) {
      status = synced.status;
      if (synced.orderPaid) orderStatus = 'PAID';
    }
  }
  return {
    paymentId,
    status,
    orderStatus,
    orderNumber: payment.order.number,
    amountCents: payment.amountCents,
    employeeName: payment.employee.name,
    reason: payment.mollieStatusReason,
  };
}

/** Klant ziet ervan af / verkeerde telefoon: lopend verzoek afbreken. */
export async function cancelTerminalPayment(paymentId: string, userId: string) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.status !== 'PENDING') throw new PosPaymentError('Deze betaling loopt niet meer');

  if (payment.molliePaymentId) {
    try {
      await client().payments.cancel(payment.molliePaymentId);
    } catch (err) {
      // Niet (meer) annuleerbaar: misschien is de klant net aan het betalen.
      // Status opnieuw ophalen in plaats van blind annuleren.
      await syncMolliePayment(payment.molliePaymentId);
      const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (fresh.status === 'PAID') throw new PosPaymentError('Betaling is al geslaagd en kan niet meer geannuleerd worden');
      throw new PosPaymentError(`Annuleren mislukt: ${mollieErrorMessage(err)}. Annuleer op de telefoon.`);
    }
    await syncMolliePayment(payment.molliePaymentId);
  } else {
    await prisma.payment.update({ where: { id: paymentId }, data: { status: 'CANCELED' } });
  }
  await audit(prisma, { action: 'MOLLIE_PAYMENT_CANCELED', userId, entity: 'Payment', entityId: paymentId });
}

// ===========================================================================
//  Modus C: handmatige bevestiging
// ===========================================================================

export interface ManualTapConfirmation {
  orderId: string;
  amountCents: number;
  /** Op wiens telefoon is gepind */
  employeeId: string;
  /** Wie op "Betaling geslaagd" klikte */
  confirmedById: string;
  idempotencyKey: string;
}

/**
 * "Betaling geslaagd op telefoon van [naam]". Werkt ook zonder Mollie-API.
 * De dagcontrole koppelt deze betaling later aan de echte Mollie-transactie;
 * lukt dat niet, dan verschijnt hij als ONLY_IN_POS (= mogelijk niet betaald!).
 */
export async function confirmManualTapPayment(input: ManualTapConfirmation) {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PosPaymentError('Bedrag moet groter dan € 0,00 zijn');
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { paymentId: existing.id, orderPaid: await settleOrderIfFullyPaid(tx, existing.orderId) };

    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: { businessDay: true } });
    if (order.status !== 'PENDING_PAYMENT') throw new PosPaymentError('Bon is niet klaar om af te rekenen');
    if (order.businessDay.status !== 'OPEN') throw new PosPaymentError('Kassadag is al afgesloten');
    if (order.type !== 'SALE') throw new PosPaymentError('Gebruik refundViaMollie() voor creditbonnen');

    const remaining = await remainingToPay(tx, order.id);
    if (input.amountCents > remaining) {
      throw new PosPaymentError(`Bedrag (${formatEUR(input.amountCents)}) is hoger dan het restant (${formatEUR(remaining)})`);
    }
    const employee = await tx.user.findUniqueOrThrow({ where: { id: input.employeeId } });

    const now = new Date();
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        method: 'MOLLIE',
        mollieMode: 'MANUAL',
        status: 'PAID',
        amountCents: input.amountCents,
        employeeId: employee.id,
        mollieTerminalId: employee.mollieTerminalId,
        confirmedById: input.confirmedById,
        confirmedAt: now,
        paidAt: now,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await audit(tx, {
      action: 'MOLLIE_MANUAL_CONFIRM',
      userId: input.confirmedById,
      entity: 'Payment',
      entityId: payment.id,
      data: { orderNumber: order.number, amountCents: input.amountCents, phoneOf: employee.name },
    });
    return { paymentId: payment.id, orderPaid: await settleOrderIfFullyPaid(tx, order.id) };
  });
}

// ===========================================================================
//  Retour via Mollie (creditbon)
// ===========================================================================

export interface MollieRefundInput {
  /** De creditbon (type CREDIT, status PENDING_PAYMENT, negatief totaal) */
  creditOrderId: string;
  /** De oorspronkelijke Mollie-betaling (Payment.id) */
  originalPaymentId: string;
  /** Positief bedrag dat terug moet naar de kaart van de klant */
  amountCents: number;
  userId: string;
  idempotencyKey: string;
}

/**
 * Stort (een deel van) een pinbetaling terug op dezelfde kaart. Mollie
 * verrekent dit met de volgende uitbetaling. Bij een handmatige (modus C)
 * betaling moet de dagcontrole eerst de tr_-ID gevonden hebben.
 */
export async function refundViaMollie(input: MollieRefundInput) {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PosPaymentError('Retourbedrag moet groter dan € 0,00 zijn');
  }
  const [creditOrder, original] = await Promise.all([
    prisma.order.findUniqueOrThrow({ where: { id: input.creditOrderId }, include: { businessDay: true } }),
    prisma.payment.findUniqueOrThrow({ where: { id: input.originalPaymentId }, include: { order: true } }),
  ]);
  if (creditOrder.type !== 'CREDIT' || creditOrder.status !== 'PENDING_PAYMENT') {
    throw new PosPaymentError('Creditbon is niet klaar voor terugbetaling');
  }
  if (creditOrder.businessDay.status !== 'OPEN') throw new PosPaymentError('Kassadag is al afgesloten');
  if (creditOrder.creditOfOrderId !== original.orderId) {
    throw new PosPaymentError('Deze pinbetaling hoort niet bij de originele bon van deze creditbon');
  }
  if (original.method !== 'MOLLIE' || original.status !== 'PAID' || original.amountCents <= 0) {
    throw new PosPaymentError('Alleen een geslaagde pinbetaling kan via Mollie worden teruggestort');
  }
  const molliePaymentId = original.molliePaymentId ?? original.reconciledMolliePaymentId;
  if (!molliePaymentId) {
    throw new PosPaymentError(
      'Deze pinbetaling is handmatig bevestigd en nog niet gekoppeld aan Mollie. Draai eerst de Mollie-controle, of betaal contant terug.',
    );
  }
  const remaining = await remainingToPay(prisma, creditOrder.id); // negatief bij creditbon
  if (-input.amountCents < remaining) {
    throw new PosPaymentError(`Retourbedrag is hoger dan het restant van de creditbon (${formatEUR(-remaining)})`);
  }

  const refundable = await client().payments.get(molliePaymentId);
  const refundableCents = refundable.amountRemaining ? parseMollieAmount(refundable.amountRemaining) : 0;
  if (input.amountCents > refundableCents) {
    throw new PosPaymentError(`Mollie kan nog maximaal ${formatEUR(refundableCents)} terugstorten op deze betaling`);
  }

  let refundId: string;
  let refundStatus: string;
  try {
    const refund = await client().paymentRefunds.create({
      paymentId: molliePaymentId,
      amount: toMollieAmount(input.amountCents),
      description: `${creditOrder.number} (retour ${original.order.number})`,
      metadata: { creditOrderId: creditOrder.id, originalPaymentId: original.id },
      idempotencyKey: input.idempotencyKey,
    });
    refundId = refund.id;
    refundStatus = refund.status;
  } catch (err) {
    throw new PosPaymentError(`Mollie-terugstorting mislukt: ${mollieErrorMessage(err)}`);
  }

  // Mollie heeft de terugstorting geaccepteerd (queued/pending/processing/refunded);
  // het bedrag wordt in alle gevallen van het Mollie-saldo afgeboekt.
  const accepted = refundStatus !== 'failed' && refundStatus !== 'canceled';
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        orderId: creditOrder.id,
        method: 'MOLLIE',
        mollieMode: 'API',
        status: accepted ? 'PAID' : 'FAILED',
        amountCents: -input.amountCents,
        employeeId: input.userId,
        molliePaymentId: null,
        mollieRefundId: refundId,
        mollieStatus: refundStatus,
        mollieTerminalId: original.mollieTerminalId,
        paidAt: accepted ? new Date() : null,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await audit(tx, {
      action: 'MOLLIE_REFUND_CREATED',
      userId: input.userId,
      entity: 'Payment',
      entityId: payment.id,
      data: { refundId, molliePaymentId, amountCents: input.amountCents, status: refundStatus },
    });
    const orderPaid = accepted ? await settleOrderIfFullyPaid(tx, creditOrder.id, input.userId) : false;
    return { paymentId: payment.id, refundId, refundStatus, orderPaid };
  });
}

// ===========================================================================
//  Modus B: hulpmiddelen voor de telefoon-weergave
// ===========================================================================

/**
 * Optionele deep link naar de Mollie Tap-app. Mollie publiceert (nog) geen
 * vast URL-schema voor webapps; daarom instelbaar via
 * MOLLIE_TAP_DEEPLINK_TEMPLATE, bijv. "mollie-tap://pay?amount={amount}&reference={reference}".
 * Zonder template gebruikt modus B gewoon startTerminalPayment(mode: 'PUSH'):
 * het bedrag verschijnt dan via Mollie zelf op de telefoon.
 */
export function buildTapDeepLink(amountCents: number, reference: string): string | null {
  const template = process.env.MOLLIE_TAP_DEEPLINK_TEMPLATE;
  if (!template) return null;
  return template
    .replaceAll('{amount}', encodeURIComponent(toMollieAmount(amountCents).value))
    .replaceAll('{amountCents}', String(amountCents))
    .replaceAll('{reference}', encodeURIComponent(reference));
}

/** Bonnen die op dit moment wachten op de telefoon van deze medewerker. */
export async function pendingPaymentsForPhone(employeeId: string) {
  return prisma.payment.findMany({
    where: { employeeId, method: 'MOLLIE', status: 'PENDING' },
    include: { order: { select: { number: true, totalInclCents: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

// ===========================================================================
//  Dagcontrole: kassa ↔ Mollie
// ===========================================================================

interface MollieTx {
  id: string;
  amountCents: number;
  createdAt: Date;
  paidAt: Date | null;
  terminalId: string | null;
  description: string;
  metadataPaymentId: string | null;
  settlementId: string | null;
}

interface MollieRefundTx {
  id: string;
  paymentId: string;
  amountCents: number;
  createdAt: Date;
  status: string;
}

/** Alle GESLAAGDE point-of-sale-betalingen in [from, until). */
async function fetchMolliePosPayments(from: Date, until: Date): Promise<MollieTx[]> {
  const result: MollieTx[] = [];
  // Mollie levert nieuwste eerst; stoppen zodra we vóór `from` zitten.
  for await (const p of client().payments.iterate()) {
    const createdAt = new Date(p.createdAt);
    if (createdAt < from) break;
    if (createdAt >= until) continue;
    if (String(p.method) !== PaymentMethod.pointofsale || p.status !== 'paid') continue;
    const details = (p.details ?? {}) as PosDetails;
    const meta = (p.metadata ?? {}) as { paymentId?: unknown };
    result.push({
      id: p.id,
      amountCents: parseMollieAmount(p.amount),
      createdAt,
      paidAt: p.paidAt ? new Date(p.paidAt) : null,
      terminalId: details.terminalId ?? null,
      description: p.description,
      metadataPaymentId: typeof meta.paymentId === 'string' ? meta.paymentId : null,
      settlementId: p.settlementId ?? null,
    });
  }
  return result;
}

/** Terugstortingen in [from, until) op point-of-sale-betalingen. */
async function fetchMollieRefunds(from: Date, until: Date, knownPosPaymentIds: Set<string>): Promise<MollieRefundTx[]> {
  const result: MollieRefundTx[] = [];
  const methodCache = new Map<string, boolean>();
  for await (const r of client().refunds.iterate()) {
    const createdAt = new Date(r.createdAt);
    if (createdAt < from) break;
    if (createdAt >= until) continue;
    if (r.status === 'failed' || r.status === 'canceled') continue;

    let isPos = knownPosPaymentIds.has(r.paymentId);
    if (!isPos) {
      if (!methodCache.has(r.paymentId)) {
        const p = await client().payments.get(r.paymentId);
        methodCache.set(r.paymentId, String(p.method) === PaymentMethod.pointofsale);
      }
      isPos = methodCache.get(r.paymentId)!;
    }
    if (!isPos) continue; // online betaling (bijv. webshop), hoort niet bij de kassa
    result.push({ id: r.id, paymentId: r.paymentId, amountCents: parseMollieAmount(r.amount), createdAt, status: r.status });
  }
  return result;
}

/** Hoe ver handmatige bevestiging en Mollie-tijdstip uit elkaar mogen liggen */
const FUZZY_WINDOW_MS = 20 * 60 * 1000;

type ItemDraft = Omit<Prisma.MollieReconciliationItemCreateManyInput, 'reconciliationId'>;

export interface EmployeeReconLine {
  userId: string | null;
  name: string;
  posCount: number;
  posAmountCents: number;
  mollieCount: number;
  mollieAmountCents: number;
  differenceCents: number;
  manualCount: number;
}

export interface ReconciliationResult {
  reconciliationId: string;
  date: string;
  status: 'MATCHED' | 'MISMATCH' | 'ERROR';
  posTotalCents: number;
  mollieTotalCents: number;
  differenceCents: number;
  perEmployee: EmployeeReconLine[];
  issues: ItemDraft[];
  errorMessage?: string;
}

/**
 * Legt alle pinbetalingen van één kassadag naast de echte Mollie-transacties.
 *
 *  1. Lopende (PENDING) kassabetalingen eerst bijwerken bij Mollie.
 *  2. Exact koppelen op tr_-ID (modus A/B, en eerder gevonden modus C).
 *  3. Modus C koppelen op: zelfde bedrag + zelfde telefoon + dichtstbijzijnde
 *     tijd (max 20 min). Daarna: zelfde bedrag op een ándere telefoon
 *     (medewerker pinde op telefoon van een collega).
 *  4. Overgebleven modus C ↔ Mollie op dezelfde telefoon binnen 10 min, maar
 *     ander bedrag → AMOUNT_MISMATCH ("verkeerd getikt").
 *  5. Rest: ONLY_IN_POS (bevestigd maar nooit gepind!) en ONLY_IN_MOLLIE
 *     (gepind maar geen bon aangeslagen).
 *  6. Terugstortingen idem op re_-ID.
 *
 * Gevonden koppelingen (stap 3) worden opgeslagen in
 * Payment.reconciledMolliePaymentId — dat is géén wijziging van de bon of het
 * bedrag, alleen een verwijzing voor de audit.
 */
export async function reconcileBusinessDay(
  businessDayId: string,
  trigger: 'z-report' | 'cron' | 'manual',
): Promise<ReconciliationResult> {
  const day = await prisma.businessDay.findUniqueOrThrow({ where: { id: businessDayId } });
  const { from, until } = shopDayRange(day.date);
  const users = await prisma.user.findMany({ select: { id: true, name: true, mollieTerminalId: true } });
  const userByTerminal = new Map(users.filter((u) => u.mollieTerminalId).map((u) => [u.mollieTerminalId!, u]));
  const userById = new Map(users.map((u) => [u.id, u]));

  // --- 1. lopende betalingen bijwerken
  const pending = await prisma.payment.findMany({
    where: { method: 'MOLLIE', status: 'PENDING', molliePaymentId: { not: null }, order: { businessDayId } },
    select: { molliePaymentId: true },
  });
  let mollieTxs: MollieTx[];
  let mollieRefunds: MollieRefundTx[];
  try {
    for (const p of pending) await syncMolliePayment(p.molliePaymentId!);
    mollieTxs = await fetchMolliePosPayments(from, until);
    mollieRefunds = await fetchMollieRefunds(from, until, new Set(mollieTxs.map((t) => t.id)));
  } catch (err) {
    const message = mollieErrorMessage(err);
    const run = await prisma.mollieReconciliation.create({
      data: { businessDayId, status: 'ERROR', posTotalCents: 0, mollieTotalCents: 0, differenceCents: 0, trigger, errorMessage: message },
    });
    return {
      reconciliationId: run.id, date: day.date, status: 'ERROR', posTotalCents: 0, mollieTotalCents: 0,
      differenceCents: 0, perEmployee: [], issues: [], errorMessage: message,
    };
  }

  const posPayments = await prisma.payment.findMany({
    where: { method: 'MOLLIE', status: 'PAID', order: { businessDayId } },
    orderBy: { paidAt: 'asc' },
  });
  const posSales = posPayments.filter((p) => p.amountCents > 0);
  const posRefunds = posPayments.filter((p) => p.amountCents < 0);

  const items: ItemDraft[] = [];
  const reconciledUpdates: { paymentId: string; molliePaymentId: string; settlementId: string | null }[] = [];
  const unmatchedMollie = new Map(mollieTxs.map((t) => [t.id, t]));
  const unmatchedPos: typeof posSales = [];

  const item = (type: ItemDraft['type'], pos: (typeof posSales)[number] | null, m: MollieTx | null, note?: string): ItemDraft => ({
    type,
    paymentId: pos?.id ?? null,
    molliePaymentId: m?.id ?? null,
    mollieTerminalId: m?.terminalId ?? pos?.mollieTerminalId ?? null,
    userId: pos?.employeeId ?? (m?.terminalId ? userByTerminal.get(m.terminalId)?.id ?? null : null),
    posAmountCents: pos?.amountCents ?? null,
    mollieAmountCents: m?.amountCents ?? null,
    mollieCreatedAt: m?.createdAt ?? null,
    note: note ?? null,
  });

  // --- 2. exact op ID
  for (const pos of posSales) {
    const id = pos.molliePaymentId ?? pos.reconciledMolliePaymentId;
    const m =
      (id ? unmatchedMollie.get(id) : undefined) ??
      [...unmatchedMollie.values()].find((t) => t.metadataPaymentId === pos.id);
    if (!m) {
      unmatchedPos.push(pos);
      continue;
    }
    unmatchedMollie.delete(m.id);
    items.push(
      m.amountCents === pos.amountCents
        ? item('MATCHED', pos, m)
        : item('AMOUNT_MISMATCH', pos, m, `Kassa ${formatEUR(pos.amountCents)}, Mollie ${formatEUR(m.amountCents)}`),
    );
    if (!pos.molliePaymentId && !pos.reconciledMolliePaymentId) {
      reconciledUpdates.push({ paymentId: pos.id, molliePaymentId: m.id, settlementId: m.settlementId });
    }
  }

  // --- 3. modus C: bedrag + telefoon + tijd
  const posTime = (p: (typeof posSales)[number]) => (p.confirmedAt ?? p.paidAt ?? p.createdAt).getTime();
  const mollieTime = (t: MollieTx) => (t.paidAt ?? t.createdAt).getTime();

  const fuzzyPass = (sameTerminalOnly: boolean) => {
    for (const pos of [...unmatchedPos]) {
      const candidates = [...unmatchedMollie.values()]
        .filter((t) => t.amountCents === pos.amountCents)
        .filter((t) => !sameTerminalOnly || (pos.mollieTerminalId && t.terminalId === pos.mollieTerminalId))
        .map((t) => ({ t, diff: Math.abs(mollieTime(t) - posTime(pos)) }))
        .filter((c) => c.diff <= FUZZY_WINDOW_MS)
        .sort((a, b) => a.diff - b.diff);
      const best = candidates[0];
      if (!best) continue;
      unmatchedMollie.delete(best.t.id);
      unmatchedPos.splice(unmatchedPos.indexOf(pos), 1);
      const otherPhone = !sameTerminalOnly && best.t.terminalId !== pos.mollieTerminalId;
      const phoneOwner = best.t.terminalId ? userByTerminal.get(best.t.terminalId)?.name : undefined;
      items.push(
        item(
          'MATCHED_FUZZY',
          pos,
          best.t,
          otherPhone ? `Gepind op telefoon van ${phoneOwner ?? 'onbekende terminal'}, niet op die van ${userById.get(pos.employeeId)?.name}` : undefined,
        ),
      );
      reconciledUpdates.push({ paymentId: pos.id, molliePaymentId: best.t.id, settlementId: best.t.settlementId });
    }
  };
  fuzzyPass(true);
  fuzzyPass(false);

  // --- 4. verkeerd getikt (zelfde telefoon, ander bedrag, binnen 10 min)
  for (const pos of [...unmatchedPos]) {
    if (!pos.mollieTerminalId) continue;
    const near = [...unmatchedMollie.values()]
      .filter((t) => t.terminalId === pos.mollieTerminalId)
      .map((t) => ({ t, diff: Math.abs(mollieTime(t) - posTime(pos)) }))
      .filter((c) => c.diff <= FUZZY_WINDOW_MS / 2)
      .sort((a, b) => a.diff - b.diff)[0];
    if (!near) continue;
    unmatchedMollie.delete(near.t.id);
    unmatchedPos.splice(unmatchedPos.indexOf(pos), 1);
    items.push(item('AMOUNT_MISMATCH', pos, near.t, `Waarschijnlijk verkeerd getikt: kassa ${formatEUR(pos.amountCents)}, telefoon ${formatEUR(near.t.amountCents)}`));
  }

  // --- 5. restanten
  for (const pos of unmatchedPos) {
    items.push(item('ONLY_IN_POS', pos, null, 'In kassa als betaald, maar geen geslaagde Mollie-transactie gevonden'));
  }
  for (const t of unmatchedMollie.values()) {
    const owner = t.terminalId ? userByTerminal.get(t.terminalId)?.name : undefined;
    items.push(item('ONLY_IN_MOLLIE', null, t, `Gepind${owner ? ` op telefoon van ${owner}` : ''} zonder bon in de kassa`));
  }

  // --- 6. terugstortingen
  const unmatchedRefunds = new Map(mollieRefunds.map((r) => [r.id, r]));
  for (const pos of posRefunds) {
    const r = pos.mollieRefundId ? unmatchedRefunds.get(pos.mollieRefundId) : undefined;
    if (r) {
      unmatchedRefunds.delete(r.id);
      items.push({
        type: r.amountCents === -pos.amountCents ? 'REFUND_MATCHED' : 'AMOUNT_MISMATCH',
        paymentId: pos.id, mollieRefundId: r.id, molliePaymentId: r.paymentId, userId: pos.employeeId,
        mollieTerminalId: pos.mollieTerminalId, posAmountCents: pos.amountCents, mollieAmountCents: -r.amountCents,
        mollieCreatedAt: r.createdAt, note: null,
      });
    } else {
      items.push({
        type: 'REFUND_ONLY_IN_POS', paymentId: pos.id, mollieRefundId: pos.mollieRefundId, userId: pos.employeeId,
        mollieTerminalId: pos.mollieTerminalId, posAmountCents: pos.amountCents, mollieAmountCents: null, note: 'Terugstorting niet gevonden in Mollie (andere dag?)',
      });
    }
  }
  for (const r of unmatchedRefunds.values()) {
    items.push({
      type: 'REFUND_ONLY_IN_MOLLIE', molliePaymentId: r.paymentId, mollieRefundId: r.id, posAmountCents: null,
      mollieAmountCents: -r.amountCents, mollieCreatedAt: r.createdAt, note: 'Terugstorting in Mollie Dashboard zonder creditbon in de kassa',
    });
  }

  // --- totalen
  const posTotalCents = posPayments.reduce((s, p) => s + p.amountCents, 0);
  const mollieTotalCents =
    mollieTxs.reduce((s, t) => s + t.amountCents, 0) - mollieRefunds.reduce((s, r) => s + r.amountCents, 0);
  const differenceCents = mollieTotalCents - posTotalCents;
  const okTypes = new Set<ItemDraft['type']>(['MATCHED', 'MATCHED_FUZZY', 'REFUND_MATCHED']);
  const issues = items.filter((i) => !okTypes.has(i.type));
  const status = issues.length === 0 && differenceCents === 0 ? 'MATCHED' : 'MISMATCH';

  // --- per medewerker (kassa: wie de betaling registreerde; Mollie: eigenaar van de telefoon)
  const lines = new Map<string, EmployeeReconLine>();
  const line = (userId: string | null) => {
    const key = userId ?? 'onbekend';
    if (!lines.has(key)) {
      lines.set(key, {
        userId, name: userId ? userById.get(userId)?.name ?? '?' : 'Onbekende telefoon',
        posCount: 0, posAmountCents: 0, mollieCount: 0, mollieAmountCents: 0, differenceCents: 0, manualCount: 0,
      });
    }
    return lines.get(key)!;
  };
  for (const p of posPayments) {
    const l = line(p.employeeId);
    l.posCount += 1;
    l.posAmountCents += p.amountCents;
    if (p.mollieMode === 'MANUAL') l.manualCount += 1;
  }
  for (const t of mollieTxs) {
    const l = line(t.terminalId ? userByTerminal.get(t.terminalId)?.id ?? null : null);
    l.mollieCount += 1;
    l.mollieAmountCents += t.amountCents;
  }
  const posRefundByMollieId = new Map(posRefunds.filter((p) => p.mollieRefundId).map((p) => [p.mollieRefundId!, p]));
  for (const r of mollieRefunds) {
    // Terugstorting tellen bij dezelfde medewerker als in de kassa, anders "onbekend"
    const l = line(posRefundByMollieId.get(r.id)?.employeeId ?? null);
    l.mollieCount += 1;
    l.mollieAmountCents -= r.amountCents;
  }
  const perEmployee = [...lines.values()]
    .map((l) => ({ ...l, differenceCents: l.mollieAmountCents - l.posAmountCents }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  // --- opslaan
  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.mollieReconciliation.create({
      data: { businessDayId, status, posTotalCents, mollieTotalCents, differenceCents, trigger },
    });
    if (items.length) {
      await tx.mollieReconciliationItem.createMany({ data: items.map((i) => ({ ...i, reconciliationId: created.id })) });
    }
    for (const u of reconciledUpdates) {
      await tx.payment.update({
        where: { id: u.paymentId },
        data: { reconciledMolliePaymentId: u.molliePaymentId, reconciledAt: new Date(), mollieSettlementId: u.settlementId ?? undefined },
      });
    }
    await audit(tx, {
      action: 'RECONCILIATION',
      entity: 'BusinessDay',
      entityId: businessDayId,
      data: { status, posTotalCents, mollieTotalCents, differenceCents, issues: issues.length, trigger },
    });
    return created;
  });

  return { reconciliationId: run.id, date: day.date, status, posTotalCents, mollieTotalCents, differenceCents, perEmployee, issues };
}

/**
 * Automatische dagelijkse controle (cron, bijv. 's nachts om 03:00 en
 * nogmaals 's middags). Controleert gisteren en vandaag, zodat late
 * Mollie-statusupdates ook meegenomen worden.
 */
export async function runDailyReconciliation(now: Date = new Date()) {
  const today = shopDateString(now);
  const yesterday = shopDateString(new Date(now.getTime() - 24 * 3600 * 1000));
  const days = await prisma.businessDay.findMany({ where: { date: { in: [yesterday, today] } } });
  const results: ReconciliationResult[] = [];
  for (const day of days) results.push(await reconcileBusinessDay(day.id, 'cron'));
  return results;
}

// ===========================================================================
//  Uitbetalingen (settlements) en Mollie-kosten voor de boekhouder
// ===========================================================================

/**
 * Haalt Mollie-uitbetalingen op sinds `since` en slaat per uitbetaling op:
 * bruto omzet, ingehouden transactiekosten (netto + btw) en uitbetaald bedrag.
 * Koppelt daarna de kassabetalingen aan hun uitbetaling (Payment.mollieSettlementId).
 *
 * Boeking per uitbetaling (zie export in stap 4):
 *   Bank (1100)                      debet   uitbetaald bedrag
 *   Transactiekosten (4xxx)          debet   kosten excl. btw
 *   Te vorderen btw (1620)           debet   btw op kosten
 *   Tussenrekening Mollie (1150)     credit  bruto omzet
 * Hiermee staat 1150 op nul zodra alle dagomzet is uitbetaald.
 *
 * Vereist MOLLIE_ORG_ACCESS_TOKEN (de gewone API-sleutel heeft geen toegang tot settlements).
 */
export async function syncSettlements(since: Date, linkPayments = true) {
  const mollie = organizationClient();
  const synced: string[] = [];

  for await (const s of mollie.settlements.iterate()) {
    const createdAt = new Date(s.createdAt);
    if (createdAt < since) break;
    if (s.status === 'open') continue; // nog lopend: bedragen veranderen nog

    const lines: Omit<Prisma.MollieSettlementLineCreateManyInput, 'settlementId'>[] = [];
    for (const [year, months] of Object.entries(s.periods ?? {})) {
      for (const [month, period] of Object.entries(months)) {
        const periodKey = `${year}-${String(month).padStart(2, '0')}`;
        for (const r of period.revenue ?? []) {
          lines.push({
            kind: 'revenue', period: periodKey, method: r.method, description: r.description, count: r.count,
            netCents: parseMollieAmount(r.amountNet), vatCents: r.amountVat ? parseMollieAmount(r.amountVat) : 0, grossCents: parseMollieAmount(r.amountGross),
          });
        }
        for (const c of period.costs ?? []) {
          lines.push({
            kind: 'cost', period: periodKey, method: c.method, description: c.description, count: c.count,
            netCents: parseMollieAmount(c.amountNet), vatCents: c.amountVat ? parseMollieAmount(c.amountVat) : 0, grossCents: parseMollieAmount(c.amountGross),
          });
        }
      }
    }
    const revenue = lines.filter((l) => l.kind === 'revenue');
    const costs = lines.filter((l) => l.kind === 'cost');
    const sum = (rows: typeof lines, k: 'netCents' | 'vatCents' | 'grossCents') => rows.reduce((t, r) => t + r[k], 0);

    await prisma.$transaction(async (tx) => {
      const data = {
        reference: s.reference,
        status: s.status,
        createdAt,
        settledAt: s.settledAt ? new Date(s.settledAt) : null,
        amountCents: parseMollieAmount(s.amount),
        revenueGrossCents: sum(revenue, 'grossCents'),
        costsGrossCents: sum(costs, 'grossCents'),
        costsNetCents: sum(costs, 'netCents'),
        costsVatCents: sum(costs, 'vatCents'),
        invoiceId: s.invoiceId ?? null,
        syncedAt: new Date(),
      };
      await tx.mollieSettlement.upsert({ where: { id: s.id }, create: { id: s.id, ...data }, update: data });
      await tx.mollieSettlementLine.deleteMany({ where: { settlementId: s.id } });
      if (lines.length) await tx.mollieSettlementLine.createMany({ data: lines.map((l) => ({ ...l, settlementId: s.id })) });
    });

    if (linkPayments) {
      const ids: string[] = [];
      for await (const p of mollie.settlementPayments.iterate({ settlementId: s.id })) {
        if (String(p.method) === PaymentMethod.pointofsale) ids.push(p.id);
      }
      if (ids.length) {
        await prisma.payment.updateMany({
          where: { OR: [{ molliePaymentId: { in: ids } }, { reconciledMolliePaymentId: { in: ids } }] },
          data: { mollieSettlementId: s.id },
        });
      }
    }
    synced.push(s.id);
  }
  return synced;
}

/** Overzicht voor de boekhouder: per maand bruto, kosten en netto uitbetaald. */
export async function settlementSummary(fromDate: Date, untilDate: Date) {
  const settlements = await prisma.mollieSettlement.findMany({
    where: { createdAt: { gte: fromDate, lt: untilDate } },
    include: { lines: true },
    orderBy: { createdAt: 'asc' },
  });
  return settlements.map((s) => ({
    id: s.id,
    reference: s.reference,
    settledAt: s.settledAt,
    revenueGrossCents: s.revenueGrossCents,
    costsNetCents: s.costsNetCents,
    costsVatCents: s.costsVatCents,
    costsGrossCents: s.costsGrossCents,
    paidOutCents: s.amountCents,
    // Controle: bruto − kosten = uitbetaald (verschil = refunds/chargebacks/correcties)
    otherCents: s.amountCents - (s.revenueGrossCents - s.costsGrossCents),
    pointOfSaleCosts: s.lines.filter((l) => l.kind === 'cost' && /pointofsale|point of sale|tap/i.test(`${l.method} ${l.description}`)),
  }));
}

// ===========================================================================
//  Hulpfuncties
// ===========================================================================

export function mollieErrorMessage(err: unknown): string {
  if (err instanceof MollieApiError) {
    if (err.statusCode === 401) return 'API-sleutel ongeldig of ingetrokken';
    if (err.statusCode === 403) return 'Geen toegang (verkeerde sleutel of ontbrekende rechten)';
    if (err.statusCode === 404) return 'Niet gevonden bij Mollie (verkeerde terminal-ID of test/live door elkaar?)';
    if (err.statusCode === 422) return `Mollie weigert: ${err.message}${err.field ? ` (${err.field})` : ''}`;
    return err.message;
  }
  if (err instanceof Error) {
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(err.message)) return 'Mollie niet bereikbaar (internetverbinding?)';
    return err.message;
  }
  return String(err);
}
