import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveIntegrationsForStep } from "./integration-resolver.js";
import type { PromptStepDef } from "./workflow-types.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-integration-resolver-test");

describe("resolveIntegrationsForStep", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns empty config for step with no required_integrations", () => {
    const step: PromptStepDef = { kind: "prompt", name: "s1", prompt: "hello" };
    const result = resolveIntegrationsForStep(step);
    expect(result.mcpConfigs).toEqual({});
    expect(result.env).toEqual({});
  });

  it("resolves MCP config with $key_name placeholders", () => {
    fs.writeFileSync(
      path.join(TEST_DIR, "keys.json"),
      JSON.stringify({ linear: { api_key: "lin_test_123" } }),
    );
    fs.writeFileSync(
      path.join(TEST_DIR, "integrations.json"),
      JSON.stringify({
        linear: {
          mcp: {
            command: "npx",
            args: ["-y", "@linear/mcp-server"],
            env: { LINEAR_API_KEY: "$api_key" },
          },
          env_var: "LINEAR_API_KEY",
        },
      }),
    );

    const step: PromptStepDef = {
      kind: "prompt",
      name: "s1",
      prompt: "fetch",
      required_integrations: [{ linear: { permissions: [] } }],
    };

    const result = resolveIntegrationsForStep(step);
    expect(result.mcpConfigs.linear).toEqual({
      command: "npx",
      args: ["-y", "@linear/mcp-server"],
      env: { LINEAR_API_KEY: "lin_test_123" },
    });
    expect(result.env.LINEAR_API_KEY).toBe("lin_test_123");
  });

  it("sets default env var name when env_var is not specified", () => {
    fs.writeFileSync(
      path.join(TEST_DIR, "keys.json"),
      JSON.stringify({ linear: { api_key: "lin_test_123" } }),
    );
    fs.writeFileSync(
      path.join(TEST_DIR, "integrations.json"),
      JSON.stringify({ linear: {} }),
    );

    const step: PromptStepDef = {
      kind: "prompt",
      name: "s1",
      prompt: "fetch",
      required_integrations: [{ linear: { permissions: [] } }],
    };

    const result = resolveIntegrationsForStep(step);
    expect(result.env.LINEAR_API_KEY).toBe("lin_test_123");
  });

  it("sets env var even without integrations.json", () => {
    fs.writeFileSync(
      path.join(TEST_DIR, "keys.json"),
      JSON.stringify({ linear: { api_key: "lin_test_123" } }),
    );

    const step: PromptStepDef = {
      kind: "prompt",
      name: "s1",
      prompt: "fetch",
      required_integrations: [{ linear: { permissions: [] } }],
    };

    const result = resolveIntegrationsForStep(step);
    expect(result.mcpConfigs).toEqual({});
    expect(result.env.LINEAR_API_KEY).toBe("lin_test_123");
  });
});
