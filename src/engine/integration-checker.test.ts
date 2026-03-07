import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  collectRequiredIntegrations,
  checkRequiredIntegrations,
} from "./integration-checker.js";
import type { WorkflowDef } from "./workflow-types.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-integration-checker-test");

vi.mock("../util/logger.js", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

describe("collectRequiredIntegrations", () => {
  it("returns empty set for workflow with no required integrations", () => {
    const workflow: WorkflowDef = {
      name: "Simple",
      steps: [{ kind: "prompt", name: "do-it", prompt: "hello" }],
    };
    expect(collectRequiredIntegrations(workflow)).toEqual(new Set());
  });

  it("collects integration names from prompt steps", () => {
    const workflow: WorkflowDef = {
      name: "Complex",
      steps: [
        {
          kind: "prompt",
          name: "step-1",
          prompt: "fetch issues",
          required_integrations: [{ linear: { permissions: [] } }],
        },
        {
          kind: "prompt",
          name: "step-2",
          prompt: "publish PR",
          required_integrations: [
            { github: { permissions: [{ "pull-requests": "write" }] } },
          ],
        },
      ],
    };
    const result = collectRequiredIntegrations(workflow);
    expect(result).toEqual(new Set(["linear", "github"]));
  });

  it("deduplicates integrations across steps", () => {
    const workflow: WorkflowDef = {
      name: "Dedup",
      steps: [
        {
          kind: "prompt",
          name: "s1",
          prompt: "a",
          required_integrations: [{ linear: { permissions: [] } }],
        },
        {
          kind: "prompt",
          name: "s2",
          prompt: "b",
          required_integrations: [{ linear: { permissions: [] } }],
        },
      ],
    };
    expect(collectRequiredIntegrations(workflow)).toEqual(new Set(["linear"]));
  });

  it("handles steps with empty required_integrations objects", () => {
    const workflow: WorkflowDef = {
      name: "Empty",
      steps: [
        {
          kind: "prompt",
          name: "s1",
          prompt: "a",
          required_integrations: [{ linear: { permissions: [] } }, { figma: { permissions: [] } }],
        },
      ],
    };
    expect(collectRequiredIntegrations(workflow)).toEqual(new Set(["linear", "figma"]));
  });
});

describe("checkRequiredIntegrations", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns no missing integrations when all are configured", () => {
    fs.writeFileSync(
      path.join(TEST_DIR, "keys.json"),
      JSON.stringify({ linear: { api_key: "test" }, github: { token: "test" } }),
    );
    const result = checkRequiredIntegrations(new Set(["linear", "github"]));
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("returns missing integrations when keys are not configured", () => {
    fs.writeFileSync(
      path.join(TEST_DIR, "keys.json"),
      JSON.stringify({ slack: { bot_token: "test" } }),
    );
    const result = checkRequiredIntegrations(new Set(["linear", "github"]));
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["linear", "github"]);
  });

  it("returns missing when keys.json does not exist", () => {
    const result = checkRequiredIntegrations(new Set(["linear"]));
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["linear"]);
  });

  it("returns ok for empty required set", () => {
    const result = checkRequiredIntegrations(new Set());
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
