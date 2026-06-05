/** Email alerting via Resend. */

import { Resend } from "resend";
import type { TargetResult } from "./health.js";

export interface AlertOptions {
  apiKey: string;
  from: string;
  to: string[];
}

/** Send a "server down" alert email listing the failed targets. */
export async function sendDownAlert(
  down: TargetResult[],
  opts: AlertOptions,
): Promise<void> {
  const resend = new Resend(opts.apiKey);
  const when = new Date().toISOString();

  const rows = down
    .map(
      (d) =>
        `  • ${d.url}\n      status: ${d.status ?? "no response"}\n      reason: ${d.detail}\n      attempts: ${d.attempts}`,
    )
    .join("\n\n");

  const text = [
    `🚨 Production server health check FAILED`,
    ``,
    `Time (UTC): ${when}`,
    `Down targets (${down.length}):`,
    ``,
    rows,
    ``,
    `Each target was retried before alerting. Please investigate the server / tunnels.`,
  ].join("\n");

  const htmlRows = down
    .map(
      (d) =>
        `<li><strong>${escapeHtml(d.url)}</strong><br/>` +
        `status: ${d.status ?? "no response"}<br/>` +
        `reason: ${escapeHtml(d.detail)}<br/>` +
        `attempts: ${d.attempts}</li>`,
    )
    .join("");

  const html = [
    `<h2 style="color:#b00020;">🚨 Production server health check FAILED</h2>`,
    `<p><strong>Time (UTC):</strong> ${when}</p>`,
    `<p><strong>Down targets (${down.length}):</strong></p>`,
    `<ul>${htmlRows}</ul>`,
    `<p>Each target was retried before alerting. Please investigate the server / tunnels.</p>`,
  ].join("");

  const { error } = await resend.emails.send({
    from: opts.from,
    to: opts.to,
    subject: `🚨 Server DOWN: ${down.length} target(s) failing`,
    text,
    html,
  });

  if (error) {
    throw new Error(`Resend failed to send alert: ${JSON.stringify(error)}`);
  }
}

/** Send a "server recovered" alert listing targets that came back up. */
export async function sendRecoveryAlert(
  recovered: TargetResult[],
  opts: AlertOptions,
): Promise<void> {
  const resend = new Resend(opts.apiKey);
  const when = new Date().toISOString();

  const rows = recovered
    .map(
      (r) =>
        `  • ${r.url}\n      status: ${r.status ?? "no response"}\n      detail: ${r.detail}`,
    )
    .join("\n\n");

  const text = [
    `✅ Production server health check RECOVERED`,
    ``,
    `Time (UTC): ${when}`,
    `Recovered targets (${recovered.length}):`,
    ``,
    rows,
    ``,
    `These targets are responding again.`,
  ].join("\n");

  const htmlRows = recovered
    .map(
      (r) =>
        `<li><strong>${escapeHtml(r.url)}</strong><br/>` +
        `status: ${r.status ?? "no response"}<br/>` +
        `detail: ${escapeHtml(r.detail)}</li>`,
    )
    .join("");

  const html = [
    `<h2 style="color:#0a7d28;">✅ Production server health check RECOVERED</h2>`,
    `<p><strong>Time (UTC):</strong> ${when}</p>`,
    `<p><strong>Recovered targets (${recovered.length}):</strong></p>`,
    `<ul>${htmlRows}</ul>`,
    `<p>These targets are responding again.</p>`,
  ].join("");

  const { error } = await resend.emails.send({
    from: opts.from,
    to: opts.to,
    subject: `✅ Server RECOVERED: ${recovered.length} target(s) back up`,
    text,
    html,
  });

  if (error) {
    throw new Error(`Resend failed to send recovery alert: ${JSON.stringify(error)}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
