/** Uniform antwoord van server actions, zodat de foutmelding altijd bij de medewerker aankomt. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const KNOWN = new Set(['PosError', 'PosPaymentError', 'AuthError', 'MollieNotConfiguredError', 'CartError']);

export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof Error && KNOWN.has(err.name)) return { ok: false, error: err.message };
    console.error(err);
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2025') {
      return { ok: false, error: 'Niet gevonden (misschien al verwerkt op een ander scherm)' };
    }
    return { ok: false, error: `Er ging iets mis: ${err instanceof Error ? err.message : String(err)}` };
  }
}
