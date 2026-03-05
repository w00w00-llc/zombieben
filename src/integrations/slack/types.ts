export interface SlackPayload {
  channel: string;
  ts: string;
  thread_ts?: string;
  user: string;
  text: string;
}
