/**
 * Vercel Cron entrypoint.
 *
 * Scheduled by vercel.json ("* /2 * * * *" -> every 2 minutes). On each run it:
 *   1. Pings every configured HTTPS tunnel target.
 *   2. Retries failing targets 5x at 1s intervals (configurable).
 *   3. Emails the alert recipients if any target is still down.
 *
 * Vercel automatically protects cron routes with the CRON_SECRET bearer token;
 * we additionally verify it so the route can't be triggered by random callers.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadConfig } from "../lib/config.js";
import { checkAll } from "../lib/health.js";
import { sendDownAlert } from "../lib/notify.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Authenticate the invocation. The external scheduler (cron-job.org) sends
  // a bearer token via the Authorization header. We accept either
  // HEALTH_CHECK_SECRET or CRON_SECRET (Vercel's convention), whichever is set.
  const expectedSecret =
    process.env.HEALTH_CHECK_SECRET ?? process.env.CRON_SECRET;
  if (expectedSecret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${expectedSecret}`) {
      res.status(401).json({
        ok: false,
        error: "Unauthorized",
        debug: {
          receivedAuth: auth,
          expectedPrefix: `Bearer ${expectedSecret?.slice(0, 5)}...`,
          secretLength: expectedSecret?.length,
          receivedLength: auth?.length,
        },
      });
      return;
    }
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Config error:", msg);
    res.status(500).json({ ok: false, error: msg });
    return;
  }

  const results = await checkAll(config.targets, {
    retries: config.retries,
    retryDelayMs: config.retryDelayMs,
    timeoutMs: config.timeoutMs,
  });

  const down = results.filter((r) => !r.healthy);

  if (down.length > 0) {
    try {
      await sendDownAlert(down, {
        apiKey: config.resendApiKey,
        from: config.alertFrom,
        to: config.alertTo,
      });
      console.error(`ALERT sent for ${down.length} down target(s).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Failed to send alert:", msg);
      res.status(500).json({
        ok: false,
        alerted: false,
        error: msg,
        results,
      });
      return;
    }
  }

  res.status(200).json({
    ok: down.length === 0,
    checked: results.length,
    down: down.length,
    alerted: down.length > 0,
    results,
  });
}
