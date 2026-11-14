// Google login state lives in KV as a Playwright storageState, not in a
// Chromium profile directory: the Worker has no disk that outlives a request.

export const STATE_KEY = 'storage-state';
export const REGIONS_KEY = 'regions';
export const SESSION_LOG_KEY = 'session-log';
const SESSION_LOG_LIMIT = 200;

// SID / __Secure-1PSID are the Google session cookies. A state without them
// is a signed-out browser, and writing it back would replace the last good
// session with nothing.
export function hasGoogleSession(state) {
  return Boolean(state?.cookies?.some((c) => /(^|\.)google\.com$/.test(c.domain.replace(/^\./, ''))
    && (c.name === 'SID' || c.name === '__Secure-1PSID')));
}

export async function readState(kv) {
  return kv.get(STATE_KEY, 'json');
}

// Google rotates some session cookies (__Secure-1PSIDTS) as they are used;
// saving the context's state after each run keeps the stored copy current.
export async function writeStateIfSignedIn(kv, state) {
  if (!hasGoogleSession(state)) return false;
  await kv.put(STATE_KEY, JSON.stringify(state), {
    metadata: { updatedAt: new Date().toISOString(), source: 'worker' },
  });
  return true;
}

// Returns what the shared src/ code expects from `openContext`: an object
// with pages(), newPage() and close(). close() also writes the state back
// and releases the remote browser.
export function makeOpenContext(env, { launch }) {
  return async function openContext() {
    const storageState = await readState(env.GMAP_KV);
    if (!storageState) {
      throw new Error(`No Google session in KV key "${STATE_KEY}". Run scripts/export-state.js locally and upload it.`);
    }
    const browser = await launch(env.BROWSER);
    let context;
    try {
      context = await browser.newContext({
        storageState,
        viewport: { width: 1366, height: 900 },
        locale: 'zh-TW',
      });
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
    return {
      pages: () => context.pages(),
      newPage: () => context.newPage(),
      async close() {
        try {
          await writeStateIfSignedIn(env.GMAP_KV, await context.storageState());
        } catch (error) {
          console.error(`storageState write-back failed: ${error.message}`);
        }
        await browser.close().catch(() => {});
      },
    };
  };
}

export async function appendSessionLog(kv, entry) {
  const log = (await kv.get(SESSION_LOG_KEY, 'json')) || [];
  log.push(entry);
  await kv.put(SESSION_LOG_KEY, JSON.stringify(log.slice(-SESSION_LOG_LIMIT)));
  return log;
}

// Summary of the log for GET /session: when the session was last seen
// working, and when (if ever) Google first turned it away.
export function summarizeSessionLog(log = []) {
  const ok = log.filter((e) => e.signedIn);
  const failed = log.filter((e) => !e.signedIn && !e.error);
  return {
    checks: log.length,
    signedIn: ok.length,
    signedOut: failed.length,
    errors: log.filter((e) => e.error).length,
    firstCheckAt: log[0]?.at || null,
    lastSignedInAt: ok.at(-1)?.at || null,
    firstSignedOutAt: failed[0]?.at || null,
    latest: log.at(-1) || null,
  };
}
