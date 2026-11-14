// The shared src/ modules read files for config, caches and failure
// artifacts. None of that exists here: regions come from KV, caches are off,
// failure screenshots are skipped, and yt-dlp (a Python binary) is not run.
export function workerConfig(regions) {
  return {
    regions,
    headless: true,
    fastSocial: true,
    useYtDlp: false,
    retries: 2,
    retryMinTimeoutMs: 750,
    failureDir: '',
    socialCache: '',
    candidateCache: '',
  };
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Hashing both sides first makes the comparison length-independent, so
// timingSafeEqual never throws on a wrong-length token.
export async function authorized(request, token) {
  if (!token) return false;
  const header = request.headers.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [a, b] = await Promise.all([sha256(given), sha256(token)]);
  return crypto.subtle.timingSafeEqual(a, b);
}
