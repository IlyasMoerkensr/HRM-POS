// Wacht tot de kassa-server klaar is en opent dan het kassascherm in de standaardbrowser.
import { exec } from 'node:child_process';

const url = 'http://localhost:3000/kassa';
const started = Date.now();

async function waitAndOpen() {
  while (Date.now() - started < 120_000) {
    try {
      await fetch('http://localhost:3000/', { redirect: 'manual' });
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
waitAndOpen();
