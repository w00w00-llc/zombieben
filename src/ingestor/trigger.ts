export interface Trigger {
  source: string;
  id: string;
  groupKeys: string[];
  timestamp: string;
  raw_payload: unknown;
  context?: unknown;
}
