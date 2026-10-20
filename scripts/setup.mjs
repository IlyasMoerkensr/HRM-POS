// Eerste keer starten: maakt .env aan met een geheime sleutel en een koppelcode.
// Bestaande waarden (zoals MOLLIE_API_KEY) blijven altijd staan.
import { randomBytes, randomInt } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  console.error(`Node.js ${process.versions.node} is te oud. Installeer de LTS-versie van https://nodejs.org`);
  process.exit(1);
}

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Bestand .env aangemaakt.');
}

let env = readFileSync('.env', 'utf8');
const has = (key) => new RegExp(`^${key}="?[^"\\s]{6,}`, 'm').test(env);
const set = (key, value) => {
  const line = `${key}="${value}"`;
  env = new RegExp(`^${key}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), line) : `${env.trimEnd()}\n${line}\n`;
};

if (!has('SESSION_SECRET') || /verander-mij/.test(env.match(/^SESSION_SECRET=.*$/m)?.[0] ?? '')) {
  set('SESSION_SECRET', randomBytes(32).toString('hex'));
}
if (!has('PAIRING_CODE')) set('PAIRING_CODE', String(randomInt(100000, 1000000)));
if (!has('CRON_SECRET') || /verander-mij/.test(env.match(/^CRON_SECRET=.*$/m)?.[0] ?? '')) {
  set('CRON_SECRET', randomBytes(24).toString('hex'));
}
if (!/^DATABASE_URL=/m.test(env)) set('DATABASE_URL', 'file:./kassa.db');

writeFileSync('.env', env);
