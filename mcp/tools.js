import { z } from 'zod';
import { actionFailed } from '../src/run-utils.js';

// A save/attach/clear that reports failure in its result fields is an MCP
// error too — an agent must never mistake "didn't save" for "saved".
export const ok = (result) => ({
  content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  ...(actionFailed(result) ? { isError: true } : {}),
});
export const fail = (error) => ({ content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true });
export const run = async (fn) => {
  try { return ok(await fn()); } catch (error) { return fail(error); }
};

// The place tools both MCP servers expose: the local stdio one (mcp/server.js)
// and the Cloudflare Worker (worker/). `core` supplies the implementations, so
// each host decides how a browser is opened and where config comes from.
// core = { resolvePlace(input, opts), savePlace(args), unsavePlace(args), listRegions() }
export function registerPlaceTools(server, core) {
  server.registerTool('resolve_place', {
    title: 'Resolve place',
    description: 'Resolve a social URL, Google Maps URL, or text query into ONE candidate confirmation payload (with saveArgs to pass to save_place unchanged). Does not save anything.',
    inputSchema: {
      input: z.string().describe('Instagram/Threads/Facebook/Google Maps URL or free-text place query'),
      fastSocial: z.boolean().optional().describe('Allow the high-confidence social fast path (default true)'),
      useCache: z.boolean().optional(),
      writeCache: z.boolean().optional(),
    },
  }, async ({ input, fastSocial, useCache, writeCache }) =>
    run(() => core.resolvePlace(input, { fastSocial, useCache, writeCache })));

  server.registerTool('save_place', {
    title: 'Save place',
    description: 'Save a user-confirmed candidate to the EXACT regional Google Maps list. Set dryRun to verify targeting without changing data. Never call without a confirmed candidate.',
    // Strict: every argument that identifies the place is optional, so a
    // misspelled key (place_url, expected_name) would otherwise be dropped in
    // silence and the save would run against a blank map. Rejecting the call
    // names the offending key, which is the only form an agent can act on.
    inputSchema: z.strictObject({
      placeUrl: z.string().optional(),
      placeQuery: z.string().optional(),
      listName: z.string().describe('Exact saved-list name to save into'),
      // Required: the save is confirmed by finding this name on the page, so a
      // call without it can only ever report failure.
      expectedName: z.string().describe('Expected place name; the save is only confirmed by finding it on the page'),
      expectedAddress: z.string().optional(),
      dryRun: z.boolean().optional(),
    }),
  }, async (args) => run(() => core.savePlace(args)));

  server.registerTool('unsave_place', {
    title: 'Unsave place',
    description: 'Remove a place from the EXACT regional Google Maps list it was saved to — the undo for save_place. Never call without knowing which list the place is actually in.',
    // Strict, as for save_place: this one removes a saved place, and every
    // argument that identifies it is what keeps the removal off another place.
    inputSchema: z.strictObject({
      placeUrl: z.string().describe('Google Maps URL of the place to remove'),
      listName: z.string().describe('Exact saved-list name to remove it from'),
      expectedName: z.string().describe('Expected place name; the removal is only confirmed by finding it on the page'),
      expectedAddress: z.string().optional(),
    }),
  }, async (args) => run(() => core.unsavePlace(args)));

  server.registerTool('list_regions', {
    title: 'List regions',
    description: 'Return the configured administrative-region -> Google Maps saved-list mapping.',
    inputSchema: {},
  }, async () => run(() => core.listRegions()));
}
