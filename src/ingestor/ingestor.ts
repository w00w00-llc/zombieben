import type { Trigger } from "./trigger.js";
import type { DedupStore } from "./dedup-store.js";
import type { ResponderSet } from "@/responder/types.js";
import { resolveResponders } from "@/responder/resolve.js";
import { log } from "@/util/logger.js";

export interface IngestorOptions {
  dedupStore: DedupStore;
  onTrigger: (result: ResponderSet) => Promise<void>;
}

export class Ingestor {
  private dedupStore: DedupStore;
  private onTrigger: (result: ResponderSet) => Promise<void>;

  constructor(opts: IngestorOptions) {
    this.dedupStore = opts.dedupStore;
    this.onTrigger = opts.onTrigger;
  }

  async submit(trigger: Trigger): Promise<void> {
    if (this.dedupStore.has(trigger.id)) {
      log.info(`Duplicate trigger skipped: ${trigger.id}`);
      return;
    }

    this.dedupStore.add(trigger.id);
    const result = resolveResponders(trigger);
    await this.onTrigger(result);
  }
}
