/**
 * Health-checking logic for HTTPS tunnel targets.
 *
 * A target is considered healthy when an HTTP request to it resolves with a
 * 2xx or 3xx status before the timeout. To avoid alerting on a transient blip,
 * a failing target is retried `retries` times at `retryDelayMs` intervals
 * before it is declared down.
 */

export interface TargetResult {
  url: string;
  healthy: boolean;
  /** Last observed HTTP status, or null if the request never completed. */
  status: number | null;
  /** Human-readable reason for the final state (last error / status). */
  detail: string;
  /** Number of attempts made (1 = passed on first try). */
  attempts: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Perform a single HTTP probe with a hard timeout. */
async function probe(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number | null; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "vercel-health-check/1.0" },
    });
    const ok = res.status >= 200 && res.status < 400;
    return {
      ok,
      status: res.status,
      detail: ok ? `HTTP ${res.status}` : `Unexpected HTTP ${res.status}`,
    };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? `Timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : "Unknown network error";
    return { ok: false, status: null, detail: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check a single target. Tries once; on failure, retries `retries` more times
 * with `retryDelayMs` between attempts. Returns as soon as any attempt succeeds.
 */
export async function checkTarget(
  url: string,
  opts: { retries: number; retryDelayMs: number; timeoutMs: number },
): Promise<TargetResult> {
  const totalAttempts = opts.retries + 1; // first try + retries
  let last = { ok: false, status: null as number | null, detail: "not attempted" };

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    last = await probe(url, opts.timeoutMs);
    if (last.ok) {
      return {
        url,
        healthy: true,
        status: last.status,
        detail: last.detail,
        attempts: attempt,
      };
    }
    if (attempt < totalAttempts) {
      await sleep(opts.retryDelayMs);
    }
  }

  return {
    url,
    healthy: false,
    status: last.status,
    detail: last.detail,
    attempts: totalAttempts,
  };
}

/** Check all targets concurrently. */
export async function checkAll(
  urls: string[],
  opts: { retries: number; retryDelayMs: number; timeoutMs: number },
): Promise<TargetResult[]> {
  return Promise.all(urls.map((url) => checkTarget(url, opts)));
}
