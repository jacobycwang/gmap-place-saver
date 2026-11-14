// Stands in for the Node `playwright` package inside the Worker bundle (see the
// [alias] in wrangler.toml). The Worker always injects its own browser context,
// so reaching this means a code path that needs a local Chromium profile.
const unavailable = () => {
  throw new Error('Local Playwright is not available in the Cloudflare Worker; inject openContext instead');
};

export const chromium = {
  launch: unavailable,
  launchPersistentContext: unavailable,
  executablePath: unavailable,
};

export default { chromium };
