import { loadEnv, requireEnv } from './config.js';
import { performAutomatedLogin } from './comptaweb-client/auth-automated.js';
import { writeStoredSession } from './comptaweb-client/session-store.js';

async function main() {
  loadEnv();
  const username = requireEnv('COMPTAWEB_USERNAME');
  const password = requireEnv('COMPTAWEB_PASSWORD');

  console.log(`→ Tentative de login automatisé pour ${username} sur Comptaweb...`);
  const result = await performAutomatedLogin(username, password);
  const cookieNames = result.cookieHeader
    .split(';')
    .map((c) => c.trim().split('=')[0])
    .filter(Boolean);
  console.log(`✓ Login OK. Cookies de session capturés : ${cookieNames.join(', ')}`);
  console.log(`  Timestamp : ${result.capturedAt}`);
  writeStoredSession({ cookieHeader: result.cookieHeader, capturedAt: result.capturedAt, username });
  console.log('  Session écrite dans data/comptaweb-session.json');
}

main().catch((err) => {
  console.error('✗', err instanceof Error ? err.message : err);
  process.exit(1);
});
