#!/usr/bin/env node
// Export the Google login in GOOGLE_MAPS_PROFILE as a Playwright storageState
// JSON, for the Cloudflare Worker (which has no persistent profile and loads
// this from KV instead). Upload the result with `npm run push-state` in worker/.
//
//   node scripts/export-state.js [out.json]           # reuse the existing profile
//   node scripts/export-state.js --login [out.json]   # open a window to sign in first
//
// The file holds live Google session cookies: anyone with it is signed in as
// that account. It is gitignored; delete it once uploaded.
import readline from 'node:readline';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { loadConfig } from '../src/config.js';

const args = process.argv.slice(2);
const login = args.includes('--login');
const out = args.find((a) => !a.startsWith('--')) || 'google-state.json';

const config = loadConfig();
if (!config.profile) {
  console.error('Set GOOGLE_MAPS_PROFILE to the browser profile that is (or will be) signed in to Google.');
  process.exit(2);
}

const context = await chromium.launchPersistentContext(config.profile, {
  headless: !login,
  viewport: { width: 1366, height: 900 },
  locale: 'zh-TW',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--lang=zh-TW'],
});

try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.google.com/maps?hl=zh-TW', { waitUntil: 'domcontentloaded' }).catch(() => {});
  if (login) {
    await new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      rl.question('Sign in to Google in the window, open Google Maps, then press Enter... ', () => { rl.close(); resolve(); });
    });
  }
  const state = await context.storageState();
  const signedIn = state.cookies.some((c) => /google\.com$/.test(c.domain) && (c.name === 'SID' || c.name === '__Secure-1PSID'));
  if (!signedIn) {
    console.error('No Google session cookie (SID / __Secure-1PSID) in this profile. Run again with --login.');
    process.exitCode = 1;
  } else {
    await fs.writeFile(out, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    console.error(`Wrote ${state.cookies.length} cookies to ${out}. Next: cd worker && npm run push-state`);
  }
} finally {
  await context.close();
}
