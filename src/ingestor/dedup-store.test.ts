import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryDedupStore, FileDedupStore } from "./dedup-store.js";

describe("InMemoryDedupStore", () => {
  it("returns false for unseen IDs", () => {
    const store = new InMemoryDedupStore();
    expect(store.has("abc")).toBe(false);
  });

  it("returns true after adding an ID", () => {
    const store = new InMemoryDedupStore();
    store.add("abc");
    expect(store.has("abc")).toBe(true);
  });

  it("handles multiple IDs independently", () => {
    const store = new InMemoryDedupStore();
    store.add("a");
    expect(store.has("a")).toBe(true);
    expect(store.has("b")).toBe(false);
  });
});

describe("FileDedupStore", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dedup-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists IDs to disk", () => {
    const filePath = path.join(tmpDir, "seen.json");
    const store = new FileDedupStore(filePath);
    store.add("trigger-1");

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as string[];
    expect(data).toContain("trigger-1");
  });

  it("loads existing IDs from disk", () => {
    const filePath = path.join(tmpDir, "seen.json");
    fs.writeFileSync(filePath, JSON.stringify(["existing-1"]));

    const store = new FileDedupStore(filePath);
    expect(store.has("existing-1")).toBe(true);
    expect(store.has("new-1")).toBe(false);
  });

  it("creates parent directories if needed", () => {
    const filePath = path.join(tmpDir, "nested", "dir", "seen.json");
    const store = new FileDedupStore(filePath);
    store.add("trigger-1");

    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("handles corrupt file gracefully", () => {
    const filePath = path.join(tmpDir, "seen.json");
    fs.writeFileSync(filePath, "not json");

    const store = new FileDedupStore(filePath);
    expect(store.has("anything")).toBe(false);
  });
});
