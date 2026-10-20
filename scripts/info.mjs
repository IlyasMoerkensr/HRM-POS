// Toont de adressen voor de kassa-pc en de telefoons, plus de koppelcode.
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

const env = readFileSync('.env', 'utf8');
const code = env.match(/^PAIRING_CODE="?(\d+)"?/m)?.[1] ?? '(onbekend)';
const mollie = /^MOLLIE_API_KEY="?(live|test)_\w{20,}/m.exec(env)?.[1];
const port = 3000;

const ips = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);

const line = '='.repeat(60);
console.log(`\n${line}`);
console.log('  HRM KASSA');
console.log(line);
console.log(`  Kassa (deze pc):  http://localhost:${port}/kassa`);
for (const ip of ips) console.log(`  Telefoons:        http://${ip}:${port}/telefoon`);
console.log('');
console.log(`  Koppelcode:       ${code}`);
console.log(`  Mollie:           ${mollie ? (mollie === 'test' ? 'TESTMODUS (test_-sleutel)' : 'LIVE') : 'geen API-sleutel (alleen handmatig pinnen)'}`);
console.log(line);
console.log('  Laat dit venster open staan. Sluiten = kassa stopt.');
console.log(`${line}\n`);
