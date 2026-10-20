/**
 * Automatische backups van de SQLite-database (lokaal draaien).
 *
 * - Bij elke start van de kassa en daarna elke 4 uur.
 * - Map: ./backups (staat niet in git). Laatste 90 bestanden blijven bewaard.
 * - Extra kopie naar BACKUP_DIR (bijv. een OneDrive- of Google Drive-map),
 *   zodat de administratie niet verloren gaat als de pc kapotgaat.
 *
 * VACUUM INTO maakt een consistente kopie, ook terwijl de kassa in gebruik is.
 */
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from './prisma';

const KEEP = 90;

function stamp(date = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

async function prune(dir: string) {
  const files = (await readdir(dir)).filter((f) => /^kassa_.*\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) await rm(path.join(dir, f));
}

export async function backupDatabase(reason: string): Promise<string | null> {
  if (!process.env.DATABASE_URL?.startsWith('file:')) return null; // alleen SQLite
  const dir = path.join(process.cwd(), 'backups');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `kassa_${stamp()}_${reason.replace(/[^a-z0-9-]/gi, '')}.db`);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  await prune(dir);

  const extra = process.env.BACKUP_DIR?.trim();
  if (extra) {
    try {
      await mkdir(extra, { recursive: true });
      await copyFile(file, path.join(extra, path.basename(file)));
      await prune(extra);
    } catch (err) {
      console.error('[backup] kopie naar BACKUP_DIR mislukt:', err instanceof Error ? err.message : err);
    }
  }
  return file;
}
