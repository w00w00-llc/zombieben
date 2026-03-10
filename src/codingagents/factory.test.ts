import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runnerConfigPath } from "@/util/runner-config.js";
import { ClaudeCodingAgent } from "./claude.js";
import { CodexCodingAgent } from "./codex.js";
import { createCodingAgent, resolveDefaultCodingAgent } from "./factory.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-codingagent-factory-test");

describe("coding agent factory", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("defaults to claude when config.json is absent", () => {
    expect(resolveDefaultCodingAgent()).toBe("claude");
    expect(createCodingAgent()).toBeInstanceOf(ClaudeCodingAgent);
  });

  it("uses codex from config.json", () => {
    fs.writeFileSync(
      runnerConfigPath(),
      JSON.stringify({ default_coding_agent: "codex" }),
    );

    expect(resolveDefaultCodingAgent()).toBe("codex");
    expect(createCodingAgent()).toBeInstanceOf(CodexCodingAgent);
  });

  it("falls back to claude for invalid configured agent", () => {
    fs.writeFileSync(
      runnerConfigPath(),
      JSON.stringify({ default_coding_agent: "bad-agent" }),
    );

    expect(resolveDefaultCodingAgent()).toBe("claude");
    expect(createCodingAgent()).toBeInstanceOf(ClaudeCodingAgent);
  });

  it("honors explicit selection over config", () => {
    fs.writeFileSync(
      runnerConfigPath(),
      JSON.stringify({ default_coding_agent: "claude" }),
    );

    expect(createCodingAgent("codex")).toBeInstanceOf(CodexCodingAgent);
  });
});
