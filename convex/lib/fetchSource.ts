// Shared fetch wrapper for all feed modules (ARCHITECTURE §5.2):
// 20s timeout, one retry with jitter, descriptive UA, optional conditional GET.
const UA = 'BlindSpot/1.0 (personal OSINT console; samuel.putra101@gmail.com)';

export interface FetchSourceOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

export async function fetchSource(url: string, opts: FetchSourceOptions = {}): Promise<Response> {
  const { headers = {}, timeoutMs = 20_000, retries = 1 } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 + Math.random() * 1500);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        signal: controller.signal,
      });
      if (res.status === 429) {
        // back off, let the caller's health row record the throttle
        lastError = new Error(`429 rate limited: ${url}`);
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
