export interface TriggerResponder {
  send(message: string): Promise<void>;
  promptChoice(message: string, options: string[]): Promise<number>;
  waitForReply(prompt: string): Promise<string>;
}
