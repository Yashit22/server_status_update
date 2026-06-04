/**
 * Configuration loaded from environment variables.
 *
 * Required env vars (set in Vercel project settings):
 *   - HEALTH_CHECK_TARGETS : comma-separated list of HTTPS tunnel URLs to ping.
 *                            Example: "https://api.example.com/health,https://worker.example.com/"
 *   - RESEND_API_KEY       : Resend API key for sending alert emails.
 *   - ALERT_FROM           : verified Resend sender, e.g. "Server Monitor <alerts@yourdomain.com>"
 *   - CRON_SECRET          : (auto-provided by Vercel) used to authenticate cron invocations.
 *
 * Optional env vars (have sensible defaults):
 *   - ALERT_TO             : comma-separated recipient list. Defaults to the three hard-coded IDs.
 *   - HEALTH_RETRIES       : number of retry attempts after first failure (default 5).
 *   - HEALTH_RETRY_DELAY_MS: delay between retries in ms (default 1000).
 *   - HEALTH_TIMEOUT_MS    : per-request timeout in ms (default 8000).
 */

const DEFAULT_RECIPIENTS = [
  "connectgenai@gmail.com",
  "yashit.foruppo@gmail.com",
  "avtanshg919@gmail.com",
];

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface AppConfig {
  targets: string[];
  resendApiKey: string;
  alertFrom: string;
  alertTo: string[];
  retries: number;
  retryDelayMs: number;
  timeoutMs: number;
}

export function loadConfig(): AppConfig {
  const targets = parseList(process.env.HEALTH_CHECK_TARGETS);
  const resendApiKey = process.env.RESEND_API_KEY ?? "";
  const alertFrom = process.env.ALERT_FROM ?? "";

  const missing: string[] = [];
  if (targets.length === 0) missing.push("HEALTH_CHECK_TARGETS");
  if (!resendApiKey) missing.push("RESEND_API_KEY");
  if (!alertFrom) missing.push("ALERT_FROM");
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  const alertTo = parseList(process.env.ALERT_TO);

  return {
    targets,
    resendApiKey,
    alertFrom,
    alertTo: alertTo.length > 0 ? alertTo : DEFAULT_RECIPIENTS,
    retries: parseNumber(process.env.HEALTH_RETRIES, 5),
    retryDelayMs: parseNumber(process.env.HEALTH_RETRY_DELAY_MS, 1000),
    timeoutMs: parseNumber(process.env.HEALTH_TIMEOUT_MS, 8000),
  };
}
