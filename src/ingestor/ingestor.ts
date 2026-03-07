import type { Trigger } from "./trigger.js";
import type { DedupStore } from "./dedup-store.js";
import type { IngestorChannel } from "./ingestor-channel.js";
import type { ResponderSet } from "@/responder/types.js";
import { resolveResponders } from "@/responder/resolve.js";
import { log } from "@/util/logger.js";

export interface IngestorOptions {
  dedupStore: DedupStore;
  channels: readonly IngestorChannel[];
  onTrigger: (result: ResponderSet) => void;
}

export class Ingestor {
  private dedupStore: DedupStore;
  private channels: readonly IngestorChannel[];
  private onTrigger: (result: ResponderSet) => void;

  constructor(opts: IngestorOptions) {
    this.dedupStore = opts.dedupStore;
    this.channels = opts.channels;
    this.onTrigger = opts.onTrigger;
  }

  submit(trigger: Trigger): void {
    if (this.dedupStore.has(trigger.id)) {
      log.info(`Duplicate trigger skipped: ${trigger.id}`);
      return;
    }

    this.dedupStore.add(trigger.id);
    const result = resolveResponders(trigger, this.channels);
    this.onTrigger(result);
  }
}
