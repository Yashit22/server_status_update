/**
 * Persistent per-target up/down state, stored in Upstash Redis (Vercel KV).
 *
 * Serverless cron runs are stateless, so to send alerts only on the
 * healthy -> down EDGE (and again only after a recovery), we must remember
 * each target's last observed state between runs.
 *
 * Storage: one Redis hash key `health:state` mapping
 *   <target url> -> "up" | "down".
 *
 * Configuration is auto-injected by the Vercel Upstash (KV) integration as
 * either KV_REST_API_URL / KV_REST_API_TOKEN or
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. If neither is set, state
 * tracking is disabled and every run alerts on every down target (the original
 * behavior) — so a missing integration degrades loudly, not silently.
 */

import { Redis } from "@upstash/redis";

export type TargetState = "up" | "down";

const STATE_KEY = "health:state";

function getRedis(): Redis | null {
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export interface StateStore {
  /** Whether persistent state is actually available. */
  enabled: boolean;
  /** Last known state for every tracked target. */
  read(): Promise<Record<string, TargetState>>;
  /** Persist the new state for the given targets. */
  write(states: Record<string, TargetState>): Promise<void>;
}

export function getStateStore(): StateStore {
  const redis = getRedis();

  if (!redis) {
    return {
      enabled: false,
      async read() {
        return {};
      },
      async write() {
        /* no-op */
      },
    };
  }

  return {
    enabled: true,
    async read() {
      const raw =
        (await redis.hgetall<Record<string, TargetState>>(STATE_KEY)) ?? {};
      return raw;
    },
    async write(states) {
      const entries = Object.entries(states);
      if (entries.length === 0) return;
      await redis.hset(STATE_KEY, states);
    },
  };
}
