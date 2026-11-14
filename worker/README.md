# gmap MCP server on Cloudflare

The `gmap` MCP server as a remote server on a Cloudflare Worker, using
Browser Rendering (`@cloudflare/playwright`) for Google Maps. Nothing runs on
your machine after setup: point an MCP client at `https://<worker>/mcp`.

Tools (same schemas as the local stdio server, defined once in `mcp/tools.js`):

| Tool | |
|---|---|
| `resolve_place` | social / Maps URL or text → one candidate + `saveArgs` |
| `save_place` | save to the exact regional list (`dryRun` supported) |
| `unsave_place` | undo a save |
| `list_regions` | the region → list mapping |
| `session_status` | is the stored Google login still accepted (`checkNow` to test now) |

What differs from running locally:

| Local | Worker |
|---|---|
| `chromium.launchPersistentContext(GOOGLE_MAPS_PROFILE)` | `launch(env.BROWSER)` + `newContext({ storageState })` |
| Login lives in the profile directory | Login is a Playwright storageState in KV (`storage-state`), written back after every run so rotated cookies stay current; never overwritten with a signed-out state |
| `config/region-lists.json` | KV key `regions` |
| yt-dlp + page meta for captions | page meta only (yt-dlp is Python) |
| caches, failure screenshots | off |

Not on the Worker: `attach_note` / `clear_note` (their sidecar fallback writes
local files), `benchmark_summary`, `smoke_check`, the LINE bot.

A cron (`17 */6 * * *`) checks the session every 6 hours, so `session_status`
answers the open question for this deployment: does a cookie from your home IP
survive being used from Cloudflare's datacenter IPs, and for how long?

## Deploy

Use a dedicated Google account, not your main one: Google may challenge or
revoke a session that moves to a datacenter IP.

```bash
npm install                      # repo root: the shared src/ needs p-retry
cd worker && npm install
npx wrangler login
npx wrangler kv namespace create GMAP_KV     # paste the id into wrangler.toml
npx wrangler secret put API_TOKEN            # any long random string

# Google session: from your existing GOOGLE_MAPS_PROFILE, or sign in fresh.
cd .. && node scripts/export-state.js          # or: node scripts/export-state.js --login
cd worker && npm run push-state && rm ../google-state.json
npm run push-regions                           # uploads ../config/region-lists.json

npm run deploy
```

Connect a client (every request needs `Authorization: Bearer $API_TOKEN`):

```bash
claude mcp add --transport http gmap https://gmap-place-saver.<your-subdomain>.workers.dev/mcp \
  --header "Authorization: Bearer $API_TOKEN"
```

Any MCP client that speaks Streamable HTTP and can send a header works.
claude.ai / Claude Desktop custom connectors expect OAuth instead of a static
header, which this Worker does not implement.

`GET /health` (same header) shows whether the session and regions are uploaded.

When `session_status` starts reporting signed out, Google has dropped the
session: run `export-state.js --login` and `npm run push-state` again. The
Worker never overwrites the stored state with a signed-out one.

## Limits

- Workers Free: 10 browser-minutes a day, 3 concurrent browsers. A resolve that
  needs Maps is ~15 s, a save ~20–40 s, a session check ~15 s (the cron alone is
  about 1 minute a day). Workers Paid ($5/month) for regular use.
- Instagram often serves datacenter IPs a login wall instead of the caption, and
  without yt-dlp there is no fallback: expect more `needsBrowserSnapshot: true`
  for IG links than locally.

## Develop

```bash
cd worker
printf 'API_TOKEN=dev\n' > .dev.vars
npx wrangler kv key put regions --path ../config/region-lists.json --binding GMAP_KV --local
npx wrangler kv key put storage-state --path ../google-state.json --binding GMAP_KV --local
npx wrangler dev          # Browser Rendering runs against a local Chromium; MCP at http://127.0.0.1:8787/mcp
npm test                  # unit tests (Node)
npm run check             # bundle without deploying
```
