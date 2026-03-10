import { SocketModeClient } from "@slack/socket-mode";
import { createSlackWebClient } from "../web-client.js";
import type { Ingestor } from "@/ingestor/ingestor.js";
import { transformSlackEvent } from "./transform.js";
import { fetchSlackThreadContext } from "./context.js";
import { log } from "@/util/logger.js";

interface MessageEvent {
  type: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  user: string;
  text: string;
  bot_id?: string;
  subtype?: string;
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

    this.socketClient.on("message", async ({ event, ack }) => {
      await ack();
      this.handleMessage(event as MessageEvent);
    });
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

  private async handleMessage(event: MessageEvent): Promise<void> {
    if (!this.botUserId || !event.text?.includes(`<@${this.botUserId}>`)) {
      return;
    }

    log.info(
      `Slack mention from ${event.user} in ${event.channel}: "${event.text.slice(0, 80)}"`,
    );

    const trigger = transformSlackEvent(event);
    if (!trigger) return;

    if (event.thread_ts) {
      trigger.context = {
        allThreadMessages: await fetchSlackThreadContext(
          event.channel,
          event.thread_ts,
        ),
      };
    }

    this.ingestor.submit(trigger);
  }
}
