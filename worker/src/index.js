import { launch } from '@cloudflare/playwright';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerPlaceTools, run } from '../../mcp/tools.js';
import { unsavePlace } from '../../src/maps/unsave.js';
import { resolvePlace } from '../../src/resolve/wrapper.js';
import { resolveCandidate } from '../../src/resolve/candidate.js';
import { savePlace, signInRequired } from '../../src/maps/save.js';
import {
  REGIONS_KEY, SESSION_LOG_KEY, STATE_KEY,
  appendSessionLog, makeOpenContext, summarizeSessionLog,
} from './session.js';
import { authorized, workerConfig } from './request.js';

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

async function loadRegions(env) {
  const regions = await env.GMAP_KV.get(REGIONS_KEY, 'json');
  if (!regions) throw new Error(`No region config in KV key "${REGIONS_KEY}". Upload config/region-lists.json.`);
  return regions;
}

// Opens Google Maps with the stored session and reports whether Google still
// treats it as signed in. A signed-in Google bar links to SignOutOptions; a
// signed-out one shows a 登入 / Sign in control, or the page is bounced to
// accounts.google.com.
export async function checkSession(env, { openContext = makeOpenContext(env, { launch }) } = {}) {
  const at = new Date().toISOString();
  const started = Date.now();
  let context;
  try {
    context = await openContext();
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.google.com/maps?hl=zh-TW', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const accountLink = page.locator('a[href*="SignOutOptions"], a[aria-label^="Google 帳戶"], a[aria-label^="Google Account"]').first();
    const signInControl = page.locator('a:has-text("Sign in"), button:has-text("Sign in"), a:has-text("登入"), button:has-text("登入")').first();
    const accountVisible = await accountLink.waitFor({ state: 'attached', timeout: 15000 }).then(() => true).catch(() => false);
    const signInControlVisible = accountVisible ? false : await signInControl.isVisible({ timeout: 2000 }).catch(() => false);
    const signedIn = accountVisible && !signInRequired({ url: page.url(), signInControlVisible });
    return { at, signedIn, url: page.url().split('?')[0], signInControlVisible, ms: Date.now() - started };
  } catch (error) {
    return { at, signedIn: false, error: error.message, ms: Date.now() - started };
  } finally {
    await context?.close();
  }
}

// One MCP server per request, stateless: nothing outlives the request but
// KV, so there is no session to keep.
export function buildMcpServer(env, { openContext = makeOpenContext(env, { launch }) } = {}) {
  const server = new McpServer({ name: 'gmap', version: '0.1.0' });
  const config = async () => workerConfig(await loadRegions(env));
  registerPlaceTools(server, {
    // Caches have nowhere to live here; the caller's cache flags are moot.
    resolvePlace: async (input, { fastSocial } = {}) => resolvePlace(input, {
      config: await config(),
      fastSocial: fastSocial ?? true,
      useCache: false,
      writeCache: false,
      resolveCandidate: (query, options) => resolveCandidate(query, { ...options, openContext }),
    }),
    savePlace: async (args) => savePlace(args, { config: await config(), openContext }),
    unsavePlace: async (args) => unsavePlace(args, { config: await config(), openContext }),
    listRegions: () => loadRegions(env),
  });
  server.registerTool('session_status', {
    title: 'Google session status',
    description: 'Whether the Google login stored for this server still works, from the 6-hourly checks: last time it was signed in, first time Google signed it out. Set checkNow to open Maps and check immediately (uses ~15 s of browser time). If signed out, the owner must re-export and upload the session.',
    inputSchema: { checkNow: z.boolean().optional() },
  }, async ({ checkNow }) => run(async () => {
    if (checkNow) await appendSessionLog(env.GMAP_KV, { ...(await checkSession(env, { openContext })), trigger: 'mcp' });
    const log = (await env.GMAP_KV.get(SESSION_LOG_KEY, 'json')) || [];
    return { ...summarizeSessionLog(log), recent: log.slice(-5) };
  }));
  return server;
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (!(await authorized(request, env.API_TOKEN))) return json({ error: 'unauthorized' }, 401);

  if (url.pathname === '/mcp') {
    const server = buildMcpServer(env);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    const state = await env.GMAP_KV.getWithMetadata(STATE_KEY);
    const regions = await env.GMAP_KV.get(REGIONS_KEY, 'json');
    return json({
      ok: Boolean(state.value && regions),
      storageState: state.value ? { present: true, ...state.metadata } : { present: false },
      regions: regions ? Object.keys(regions) : null,
    });
  }

  return json({ error: 'not found', routes: ['POST /mcp', 'GET /health'] }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      return json({ error: error.message }, 500);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      const entry = await checkSession(env);
      await appendSessionLog(env.GMAP_KV, { ...entry, trigger: 'cron' });
      console.log(JSON.stringify({ sessionCheck: entry }));
    })());
  },
};
