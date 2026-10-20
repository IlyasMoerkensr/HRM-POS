/** Next.js roept dit één keer aan bij het starten van de server. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startBackgroundJobs } = await import('./lib/jobs');
    startBackgroundJobs();
  }
}
