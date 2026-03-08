import { beforeEach, afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGithubWebhookChannel } from "./webhook.js";
import type { Trigger } from "@/ingestor/trigger.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-github-webhook-test");

describe("createGithubWebhookChannel", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("is disabled by default", () => {
    const channel = createGithubWebhookChannel();
    expect(channel.isEnabled()).toBe(false);
  });

  it("is enabled when webhook_enabled and webhook_secret are configured", () => {
    fs.writeFileSync(
      path.join(TEST_DIR, "keys.json"),
      JSON.stringify({ github: { webhook_enabled: "true", webhook_secret: "secret" } }),
    );
    const channel = createGithubWebhookChannel();
    expect(channel.isEnabled()).toBe(true);
  });

  it("builds channel key from webhook trigger ownerRepo", () => {
    const channel = createGithubWebhookChannel();
    const trigger: Trigger = {
      source: "github_webhook",
      id: "github-webhook-deliv-1",
      groupKeys: ["github:w00w00-llc/ami"],
      timestamp: new Date().toISOString(),
      raw_payload: {},
      context: { ownerRepo: "w00w00-llc/ami", eventType: "pull_request", deliveryId: "deliv-1" },
    };
    expect(channel.getChannelKey(trigger)).toBe("github:w00w00-llc/ami");
  });

  it("returns github noop responder for webhook trigger", () => {
    const channel = createGithubWebhookChannel();
    const trigger: Trigger = {
      source: "github_webhook",
      id: "github-webhook-deliv-2",
      groupKeys: ["github:w00w00-llc/ami"],
      timestamp: new Date().toISOString(),
      raw_payload: {},
      context: { ownerRepo: "w00w00-llc/ami", eventType: "issues", deliveryId: "deliv-2" },
    };
    expect(channel.getPrimaryResponder(trigger)).toBeDefined();
  });
});
