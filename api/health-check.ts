/**
 * Vercel Cron entrypoint.
 *
 * Triggered every minute by the external cron-job.org scheduler. On each run it:
 *   1. Pings every configured HTTPS tunnel target.
 *   2. Retries failing targets at 1s intervals (configurable).
 *   3. Emails a DOWN alert only for targets that just transitioned up -> down,
 *      and a RECOVERED alert only for targets that just transitioned
 *      down -> up (both edge-triggered). A target that is still down from a
 *      previous run does not re-alert; it must recover and fail again before
 *      another down email is sent.
 *
 * The up/down edge detection relies on persistent state in Upstash Redis
 * (Vercel KV); see lib/state.ts. If KV is not configured it falls back to
 * alerting on every down target each run.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadConfig } from "../lib/config.js";
import { checkAll } from "../lib/health.js";
import { sendDownAlert, sendRecoveryAlert } from "../lib/notify.js";
import { getStateStore, type TargetState } from "../lib/state.js";

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

  // Edge-triggered alerting: compare against the last persisted state so we
  // only email for targets that JUST went down. A target that was already
  // "down" last run is suppressed until it recovers and fails again.
  const store = getStateStore();
  const previous = await store.read();

  // Targets to alert on = currently down AND not already known-down.
  const newlyDown = down.filter((r) => previous[r.url] !== "down");

  // Recovered = currently healthy AND previously known-down. (A target with no
  // prior state was never alerted as down, so coming up isn't a "recovery".)
  const recovered = results.filter(
    (r) => r.healthy && previous[r.url] === "down",
  );

  // Compute the new state for every target we checked, then persist it. This
  // records recoveries (down -> up) so the next failure re-alerts.
  const nextState: Record<string, TargetState> = {};
  for (const r of results) {
    nextState[r.url] = r.healthy ? "up" : "down";
  }

  // If an email fails, drop the affected targets from the state we persist so
  // their transition isn't recorded — the next run will retry that alert
  // rather than silently swallow it. Each direction is handled independently.
  const emailOpts = {
    apiKey: config.resendApiKey,
    from: config.alertFrom,
    to: config.alertTo,
  };
  const errors: string[] = [];
  let alerted = false;
  let recoveryAlerted = false;

  if (newlyDown.length > 0) {
    try {
      await sendDownAlert(newlyDown, emailOpts);
      alerted = true;
      console.error(`ALERT sent for ${newlyDown.length} newly-down target(s).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Failed to send down alert:", msg);
      errors.push(`down: ${msg}`);
      for (const r of newlyDown) delete nextState[r.url];
    }
  }

  if (recovered.length > 0) {
    try {
      await sendRecoveryAlert(recovered, emailOpts);
      recoveryAlerted = true;
      console.error(`RECOVERY sent for ${recovered.length} target(s).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Failed to send recovery alert:", msg);
      errors.push(`recovery: ${msg}`);
      for (const r of recovered) delete nextState[r.url];
    }
  }

  // Persist the (possibly reduced) state. Targets whose alert failed keep their
  // previous stored state, so the transition is re-detected next run.
  try {
    await store.write(nextState);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to persist state:", msg);
    errors.push(`persist: ${msg}`);
  }

  if (errors.length > 0) {
    res.status(500).json({
      ok: false,
      alerted,
      recoveryAlerted,
      error: errors.join("; "),
      results,
    });
    return;
  }

  res.status(200).json({
    ok: down.length === 0,
    checked: results.length,
    down: down.length,
    newlyDown: newlyDown.length,
    recovered: recovered.length,
    alerted,
    recoveryAlerted,
    stateTracking: store.enabled,
    results,
  });
}
