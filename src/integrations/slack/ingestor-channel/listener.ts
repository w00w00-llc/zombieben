import { SocketModeClient } from "@slack/socket-mode";
import { createSlackWebClient } from "../web-client.js";
import type { Ingestor } from "@/ingestor/ingestor.js";
import { normalizeSlackEvent, transformSlackEvent } from "./transform.js";
import { fetchSlackThreadContext } from "./context.js";
import { log } from "@/util/logger.js";

interface SocketModeEventArgs {
  event: unknown;
  ack: () => Promise<void>;
}

export class SlackSocketListener {
  private socketClient: SocketModeClient;
  private ingestor: Ingestor;
  private botUserId: string | null = null;

  constructor(appToken: string, ingestor: Ingestor) {
    this.socketClient = new SocketModeClient({
      appToken,
      autoReconnectEnabled: true,
      clientPingTimeout: 20_000,
      serverPingTimeout: 60_000,
      pingPongLoggingEnabled: false,
    });
    this.ingestor = ingestor;

    const registerSlackEvent = (eventName: "message" | "app_mention") => this.socketClient.on(eventName, async ({ event, ack }: SocketModeEventArgs) => {
      await ack();
      this.handleMessage(event, eventName);
    });
    registerSlackEvent("message");
    registerSlackEvent("app_mention");
    this.socketClient.on("connected", () => {
      log.info("Slack Socket Mode connected.");
    });
    this.socketClient.on("reconnecting", () => {
      log.warn("Slack Socket Mode reconnecting...");
    });
    this.socketClient.on("disconnected", (err?: Error) => {
      if (err) {
        log.warn(`Slack Socket Mode disconnected: ${err.message}`);
      } else {
        log.warn("Slack Socket Mode disconnected.");
      }
    });
    this.socketClient.on("error", (err: Error) => {
      log.warn(`Slack Socket Mode error: ${err.message}`);
    });
  }

  async start(): Promise<void> {
    try {
      const client = createSlackWebClient();
      const auth = await client.auth.test();
      this.botUserId = auth.user_id as string;
      log.info(`Slack bot user ID: ${this.botUserId}`);
    } catch (err) {
      log.error(`Failed to resolve bot user ID: ${(err as Error).message}`);
    }

    await this.socketClient.start();
    log.info("Slack Socket Mode listener started.");
  }

  async stop(): Promise<void> {
    await this.socketClient.disconnect();
    log.info("Slack Socket Mode listener stopped.");
  }

  private async handleMessage(
    event: unknown,
    eventType: "message" | "app_mention",
  ): Promise<void> {
    const normalizedEvent = normalizeSlackEvent(event);
    if (!normalizedEvent) return;

    const isDirectMention = this.botUserId != null
      && normalizedEvent.text.includes(`<@${this.botUserId}>`);
    if (eventType !== "app_mention" && !isDirectMention) {
      return;
    }

    log.info(
      `Slack mention from ${normalizedEvent.user} in ${normalizedEvent.channel}: "${normalizedEvent.text.slice(0, 80)}"`,
    );

    const trigger = transformSlackEvent(normalizedEvent);
    if (!trigger) return;

    if (normalizedEvent.thread_ts) {
      trigger.context = {
        allThreadMessages: await fetchSlackThreadContext(
          normalizedEvent.channel,
          normalizedEvent.thread_ts,
        ),
      };
    }

    this.ingestor.submit(trigger);
  }
}
