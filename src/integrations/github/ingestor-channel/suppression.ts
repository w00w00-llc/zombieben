import type { Trigger } from "@/ingestor/trigger.js";

const TTL_MS = 45_000;
const recent = new Map<string, number>();

export function shouldSuppressGithubTrigger(
  trigger: Trigger,
  eventType: string,
  nowMs = Date.now(),
): boolean {
  const key = `${eventType}|${[...trigger.groupKeys].sort().join(",")}`;
  prune(nowMs);
  const seenAt = recent.get(key);
  if (seenAt != null && nowMs - seenAt <= TTL_MS) {
    return true;
  }
  recent.set(key, nowMs);
  return false;
}

function prune(nowMs: number): void {
  for (const [key, ts] of recent) {
    if (nowMs - ts > TTL_MS) {
      recent.delete(key);
    }
  }
}
