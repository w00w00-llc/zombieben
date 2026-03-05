export interface IngestorChannel {
  readonly name: string;
  isEnabled(): boolean;
  startListener(): Promise<void>;
  stopListener(): Promise<void>;
}
