# Server Status Update

A Vercel Cron job that monitors a production Linux server's HTTPS tunnel
endpoints and emails an alert (via [Resend](https://resend.com)) when any of
them goes down.

## How it works

- **[cron-job.org](https://cron-job.org)** is the scheduler. Its free tier
  allows jobs **every 1 minute**, and it sends an authenticated request to the
  Vercel endpoint on that cadence.
- **`api/health-check.ts`** (on Vercel) is the entrypoint. For each configured
  target it sends an HTTPS request. If a target fails, it retries **5 times at
  1-second intervals** before declaring it down (this absorbs transient blips).
- If any target is still down after retries, it emails the configured
  recipients via Resend.

```
cron-job.org (every 1 min)  ──HTTPS+Bearer──▶  Vercel /api/health-check  ──▶  pings tunnels (5 retries @1s)  ──▶  Resend email on failure
```

> **Why cron-job.org?** Vercel serverless functions can't run a persistent
> loop, and Hobby-plan crons run at most once/day. cron-job.org is the only
> free scheduler that allows a true **1-minute** interval. (UptimeRobot's free
> tier is limited to 5-minute checks; its 1-minute checks are a paid feature.)
> ICMP `ping` isn't available in serverless, so health is checked over HTTPS.

## Setup

1. Install deps:
   ```bash
   npm install
   ```
2. Configure environment variables (see `.env.example`). In production set them
   in **Vercel → Project → Settings → Environment Variables**:
   - `HEALTH_CHECK_TARGETS` — comma-separated tunnel URLs to check.
   - `RESEND_API_KEY` — from your Resend dashboard.
   - `ALERT_FROM` — a sender verified in Resend (e.g. `alerts@yourdomain.com`).
   - `ALERT_TO` — optional; defaults to the three project recipients.
   - `HEALTH_CHECK_SECRET` — a long random string (e.g. `openssl rand -hex 32`)
     that authenticates the scheduler. Use the same value in step 4.
3. Deploy:
   ```bash
   npm run deploy   # vercel --prod
   ```
   Note your deployed URL, e.g. `https://your-project.vercel.app`.

4. **Set up the cron-job.org scheduler.** Create a free account at
   [cron-job.org](https://cron-job.org), then **Create cronjob** with:
   - **Title:** `Server health check`
   - **URL:** `https://your-project.vercel.app/api/health-check`
   - **Schedule:** Every 1 minute (select "Every 1 minute(s)").
   - **Request method:** `GET`
   - Under **Advanced → Headers**, add one header:
     - Key: `Authorization`
     - Value: `Bearer <your HEALTH_CHECK_SECRET>` (same value as in Vercel).
   - (Optional) Enable "Notify me when the job fails" so you also get an alert
     if the checker endpoint itself becomes unreachable.

   Save and enable. It will start hitting the endpoint every minute.

## Local testing

```bash
npm run typecheck          # tsc --noEmit
vercel dev                 # then hit http://localhost:3000/api/health-check
```

To force an alert locally, point `HEALTH_CHECK_TARGETS` at a URL that returns
non-2xx (e.g. `https://httpstat.us/500`).

## Configuration reference

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HEALTH_CHECK_TARGETS` | yes | — | Comma-separated HTTPS URLs to check |
| `RESEND_API_KEY` | yes | — | Resend API key |
| `ALERT_FROM` | yes | — | Verified Resend sender |
| `ALERT_TO` | no | 3 project IDs | Comma-separated recipients |
| `HEALTH_RETRIES` | no | `4` | Retries after first failure |
| `HEALTH_RETRY_DELAY_MS` | no | `1000` | Delay between retries (ms) |
| `HEALTH_TIMEOUT_MS` | no | `5000` | Per-request timeout (ms) |
| `HEALTH_CHECK_SECRET` | recommended | — | Shared bearer token; the cron-job.org `Authorization` header must match it |

### Adjusting the interval

cron-job.org's free tier supports **1-minute** intervals. To change cadence,
edit the job's schedule in the cron-job.org dashboard — no code change needed.
