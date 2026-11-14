import test from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';

// Workers-only extension of SubtleCrypto; Node keeps it in node:crypto.
crypto.subtle.timingSafeEqual ??= (a, b) => timingSafeEqual(a, b);
import { authorized, workerConfig } from '../src/request.js';
import { hasGoogleSession, makeOpenContext, summarizeSessionLog, appendSessionLog, STATE_KEY } from '../src/session.js';

function fakeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key, type) { const v = store.get(key); return v == null ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
  };
}

const signedIn = { cookies: [{ name: '__Secure-1PSID', domain: '.google.com', value: 'x' }], origins: [] };
const signedOut = { cookies: [{ name: 'NID', domain: '.google.com', value: 'y' }], origins: [] };

test('authorized needs the exact bearer token, and a configured one', async () => {
  const req = (h) => new Request('https://w/health', { headers: h ? { authorization: h } : {} });
  assert.equal(await authorized(req('Bearer s3cret'), 's3cret'), true);
  assert.equal(await authorized(req('Bearer wrong'), 's3cret'), false);
  assert.equal(await authorized(req(null), 's3cret'), false);
  assert.equal(await authorized(req('Bearer '), ''), false);
});

test('workerConfig turns off every file and process dependency', () => {
  const c = workerConfig({ A: ['x'] });
  assert.deepEqual(c.regions, { A: ['x'] });
  assert.equal(c.useYtDlp, false);
  assert.equal(c.failureDir, '');
});

test('hasGoogleSession looks for the Google session cookie only', () => {
  assert.equal(hasGoogleSession(signedIn), true);
  assert.equal(hasGoogleSession(signedOut), false);
  assert.equal(hasGoogleSession(null), false);
});

function fakeLaunch(stateAfter) {
  const calls = { closed: 0, newContextArgs: null };
  const context = { pages: () => [], newPage: async () => ({}), storageState: async () => stateAfter };
  const launch = async () => ({
    newContext: async (opts) => { calls.newContextArgs = opts; return context; },
    close: async () => { calls.closed += 1; },
  });
  return { launch, calls };
}

test('openContext loads the stored state and writes a refreshed signed-in state back', async () => {
  const kv = fakeKv({ [STATE_KEY]: JSON.stringify(signedIn) });
  const refreshed = { ...signedIn, cookies: [...signedIn.cookies, { name: '__Secure-1PSIDTS', domain: '.google.com', value: 'new' }] };
  const { launch, calls } = fakeLaunch(refreshed);
  const ctx = await makeOpenContext({ GMAP_KV: kv, BROWSER: {} }, { launch })();
  assert.deepEqual(calls.newContextArgs.storageState, signedIn);
  await ctx.close();
  assert.equal(calls.closed, 1);
  assert.equal(JSON.parse(kv.store.get(STATE_KEY)).cookies.length, 2);
});

test('openContext never overwrites the stored session with a signed-out one', async () => {
  const kv = fakeKv({ [STATE_KEY]: JSON.stringify(signedIn) });
  const { launch } = fakeLaunch(signedOut);
  const ctx = await makeOpenContext({ GMAP_KV: kv, BROWSER: {} }, { launch })();
  await ctx.close();
  assert.deepEqual(JSON.parse(kv.store.get(STATE_KEY)), signedIn);
});

test('openContext fails clearly when no session was uploaded', async () => {
  const { launch } = fakeLaunch(signedIn);
  await assert.rejects(makeOpenContext({ GMAP_KV: fakeKv(), BROWSER: {} }, { launch })(), /No Google session/);
});

test('session log summary reports when Google first turned the session away', async () => {
  const kv = fakeKv();
  await appendSessionLog(kv, { at: 't1', signedIn: true });
  await appendSessionLog(kv, { at: 't2', signedIn: false, error: 'timeout' });
  await appendSessionLog(kv, { at: 't3', signedIn: false });
  const s = summarizeSessionLog(await kv.get('session-log', 'json'));
  assert.deepEqual([s.checks, s.signedIn, s.signedOut, s.errors], [3, 1, 1, 1]);
  assert.equal(s.lastSignedInAt, 't1');
  assert.equal(s.firstSignedOutAt, 't3');
});
