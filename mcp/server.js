#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolvePlace } from '../src/resolve/wrapper.js';
import { savePlace } from '../src/maps/save.js';
import { unsavePlace } from '../src/maps/unsave.js';
import { attachNote, clearNote } from '../src/maps/note.js';
import { listRegions } from '../src/index.js';
import { benchmarkSummary } from '../src/storage/benchmark.js';
import { smokeCheck } from '../src/smoke.js';
import { registerPlaceTools, run } from './tools.js';

const server = new McpServer({ name: 'gmap', version: '0.1.0' });

registerPlaceTools(server, {
  resolvePlace: (input, opts) => resolvePlace(input, opts),
  savePlace: (args) => savePlace(args, {}),
  unsavePlace: (args) => unsavePlace(args, {}),
  listRegions: () => listRegions({}),
});

server.registerTool('attach_note', {
  title: 'Attach note',
  description: 'Attach a source/recommendation note to the EXACT saved place, opened via its saved list. If exact targeting is not provably safe (the note field cannot be matched to the place by nearest-ancestor name), write a local sidecar record instead (mode safeAttachOrSidecar) or refuse. A non-empty existing note is never replaced unless overwrite is true; previousText is always returned.',
  // Strict, as for save_place: a dropped negativeNames weakens the guard that
  // keeps the note off a sibling place, and a dropped overwrite silently
  // reverses the caller's decision about an existing note.
  inputSchema: z.strictObject({
    expectedName: z.string().describe('Expected place name; must appear on the saved place card in the list'),
    listName: z.string().describe('The saved list the place is in; the note is opened through this list'),
    expectedAddress: z.string().optional(),
    sourceUrl: z.string().optional(),
    recommendationSummary: z.string().optional(),
    noteText: z.string().optional().describe('Explicit note text override'),
    negativeNames: z.array(z.string()).optional(),
    overwrite: z.boolean().optional().describe('Replace a non-empty existing note (default false: preserved, new note goes to sidecar/refused)'),
    mode: z.enum(['safeAttachOrSidecar', 'attachOnly']).optional(),
  }),
}, async ({ mode, ...payload }) => run(() => attachNote(payload, { mode })));

server.registerTool('clear_note', {
  title: 'Clear note',
  description: 'Clear (remove) the note on the EXACT saved place, opened via its saved list. Uses the same nearest-ancestor safety guard as attach_note and returns previousText so the change can be undone. Never clears a sibling place.',
  // Strict for the same reason, and this one removes text: expectedAddress and
  // negativeNames are the whole of its aim.
  inputSchema: z.strictObject({
    expectedName: z.string().describe('Expected place name; must appear on the saved place card in the list'),
    listName: z.string().describe('The saved list the place is in'),
    expectedAddress: z.string().optional(),
    negativeNames: z.array(z.string()).optional(),
  }),
}, async (payload) => run(() => clearNote(payload, {})));

server.registerTool('benchmark_summary', {
  title: 'Benchmark summary',
  description: 'Summarize resolver/candidate/save performance from the benchmark log.',
  inputSchema: {
    limit: z.number().optional().describe('How many recent rows to summarize (default 100)'),
  },
}, async ({ limit }) => run(() => benchmarkSummary(limit ?? 100, {})));

server.registerTool('smoke_check', {
  title: 'Smoke check',
  description: 'Safe diagnostics: node version, Playwright availability, browser-profile existence, and region-config readability. Changes nothing.',
  inputSchema: {},
}, async () => run(() => smokeCheck({})));

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('gmap MCP server running on stdio');
