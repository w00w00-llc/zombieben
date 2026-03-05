export interface Trigger {
  source: string;
  id: string;
  timestamp: string;
  raw_payload: unknown;
  context?: unknown;
}
