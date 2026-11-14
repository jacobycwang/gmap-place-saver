import { chromium } from 'playwright';

export function isMissingBrowserError(error) {
  return /Executable doesn'?t exist|playwright install|please run the following command/i.test(error?.message || '');
}

// The default way every browser step gets its context: the persistent,
// logged-in Chromium profile at GOOGLE_MAPS_PROFILE. Callers that have no
// profile directory (the Cloudflare Worker) inject their own `openContext`
// returning anything with pages() / newPage() / close().
export async function launchProfileContext(config) {
  if (!config.profile) throw new Error('GOOGLE_MAPS_PROFILE not set');
  try {
    return await chromium.launchPersistentContext(config.profile, {
      headless: config.headless,
      viewport: { width: 1366, height: 900 },
      locale: 'zh-TW',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=zh-TW', '--window-size=1366,900'],
    });
  } catch (error) {
    if (isMissingBrowserError(error)) {
      throw new Error(`Playwright Chromium is not installed. Run: npx playwright install chromium\n(${error.message})`);
    }
    throw error;
  }
}
