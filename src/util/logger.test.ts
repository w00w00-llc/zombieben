import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger } from "./logger.js";

describe("createLogger", () => {
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-test-"));
    logFile = path.join(tmpDir, "test.log");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not create the file until first write", () => {
    createLogger({ logFile });
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it("writes INFO lines with timestamp and level", () => {
    const logger = createLogger({ logFile });
    logger.info("hello world");

    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toMatch(
      /^\[INFO\] \[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\] hello world\n$/,
    );
  });

  it("writes WARN lines", () => {
    const logger = createLogger({ logFile });
    logger.warn("something fishy");

    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("[WARN]");
    expect(content).toContain("something fishy");
  });

  it("writes ERROR lines", () => {
    const logger = createLogger({ logFile });
    logger.error("boom");

    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("[ERROR]");
    expect(content).toContain("boom");
  });

  it("appends multiple lines", () => {
    const logger = createLogger({ logFile });
    logger.info("first");
    logger.error("second");

    const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("second");
  });

  it("tee writes to stdout/stderr when enabled", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const logger = createLogger({ logFile, tee: true });
    logger.info("out");
    logger.error("err");

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("[INFO]"));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("out"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("[ERROR]"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("err"));

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
