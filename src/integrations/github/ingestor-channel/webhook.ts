import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";
import type { Ingestor } from "@/ingestor/ingestor.js";
import type { Trigger } from "@/ingestor/trigger.js";
import type { TriggerResponder } from "@/responder/responder.js";
import { getIntegrationKeys } from "@/util/keys.js";
import { log } from "@/util/logger.js";
import { GithubNoopResponder } from "../trigger-responder/index.js";
import { transformGithubWebhookEvent } from "./transform.js";
import { isGithubWebhookTrigger } from "./types.js";
import { shouldSuppressGithubTrigger } from "./suppression.js";

const DEFAULT_PORT = 8787;
const DEFAULT_PATH = "/integrations/github/webhook";
const SUPPORTED_EVENTS = new Set([
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
]);

export function createGithubWebhookChannel(): IngestorChannel {
  let server: http.Server | null = null;

  return {
    name: "github-webhook",
    isEnabled(): boolean {
      const cfg = getConfig();
      return cfg.enabled && !!cfg.secret;
    },

    async startListener(ingestor: Ingestor): Promise<void> {
      if (server) return;
      const cfg = getConfig();
      const secret = cfg.secret;
      if (!cfg.enabled || !secret) return;
      const endpointPath = normalizePath(cfg.path);

      server = http.createServer(async (req, res) => {
        await handleRequest(req, res, ingestor, secret, endpointPath);
      });

      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(cfg.port, "127.0.0.1", () => {
          server!.off("error", reject);
          resolve();
        });
      });

      log.info(
        `GitHub webhook listener started on http://127.0.0.1:${cfg.port}${endpointPath}`,
      );
    },

    async stopListener(): Promise<void> {
      if (!server) return;
      const active = server;
      server = null;
      await new Promise<void>((resolve, reject) => {
        active.close((err) => (err ? reject(err) : resolve()));
      });
      log.info("GitHub webhook listener stopped.");
    },

    getPrimaryResponder(trigger: Trigger): TriggerResponder {
      if (!isGithubWebhookTrigger(trigger)) {
        throw new Error(`Expected github_webhook trigger, got ${trigger.source}`);
      }
      return new GithubNoopResponder();
    },

    getChannelKey(trigger: Trigger): string {
      if (!isGithubWebhookTrigger(trigger)) {
        throw new Error(`Expected github_webhook trigger, got ${trigger.source}`);
      }
      const ownerRepo = trigger.context?.ownerRepo;
      return ownerRepo ? `github:${ownerRepo}` : "github:webhook";
    },
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ingestor: Ingestor,
  secret: string,
  endpointPath: string,
): Promise<void> {
  if (req.method !== "POST") {
    send(res, 405, "method not allowed");
    return;
  }
  const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";
  if (pathname !== endpointPath) {
    send(res, 404, "not found");
    return;
  }

  const deliveryId = getHeader(req, "x-github-delivery");
  const eventType = getHeader(req, "x-github-event");
  const signature = getHeader(req, "x-hub-signature-256");
  if (!deliveryId || !eventType || !signature) {
    send(res, 400, "missing required github headers");
    return;
  }

  const body = await readRawBody(req);
  if (!isValidSignature(body, signature, secret)) {
    send(res, 401, "invalid signature");
    return;
  }

  if (!SUPPORTED_EVENTS.has(eventType)) {
    send(res, 200, "ignored event");
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body.toString("utf-8")) as Record<string, unknown>;
  } catch {
    send(res, 400, "invalid json");
    return;
  }

  try {
    const trigger = transformGithubWebhookEvent(eventType, deliveryId, payload);
    if (!shouldSuppressGithubTrigger(trigger, eventType)) {
      ingestor.submit(trigger);
    }
    send(res, 200, "ok");
  } catch (err) {
    send(res, 400, (err as Error).message);
  }
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function isValidSignature(
  body: Buffer,
  header: string,
  secret: string,
): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const actual = header.trim();
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(body);
}

function normalizePath(p: string): string {
  if (!p) return DEFAULT_PATH;
  return p.startsWith("/") ? p : `/${p}`;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parsePort(value: string | undefined): number {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0 && n <= 65535) return n;
  return DEFAULT_PORT;
}

function getConfig(): { enabled: boolean; secret?: string; port: number; path: string } {
  const keys = getIntegrationKeys("github");
  return {
    enabled: parseBoolean(keys?.webhook_enabled),
    secret: keys?.webhook_secret,
    port: parsePort(keys?.webhook_port),
    path: normalizePath(keys?.webhook_path ?? DEFAULT_PATH),
  };
}
