import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CodingAgent, CodingAgentHandle, SpawnOptions } from "./types.js";

let counter = 0;

export class CodexCodingAgent implements CodingAgent {
  private command: string;

  constructor(command?: string) {
    this.command = command ?? "codex";
  }

  spawn(options: SpawnOptions): CodingAgentHandle {
    const args = this.buildArgs(options);
    const prompt = this.buildPrompt(options);

    if (options.interactive) {
      return this.spawnInteractive(args, options);
    }

    return this.spawnPiped(args, prompt, options);
  }

  private buildArgs(options: SpawnOptions): string[] {
    const args: string[] = [];

    if (options.interactive) {
      args.push(this.buildPrompt(options));
    } else {
      args.push("exec", "-");
      if (options.outputFormat === "stream-json") {
        args.push("--json");
      }
    }

    if (options.readonly) {
      args.push("--sandbox", "read-only");
    } else {
      args.push("--sandbox", "workspace-write");
    }
    // Equivalent behavior to Claude's skip-permissions mode:
    // run non-interactively without approval prompts.
    args.push("--ask-for-approval", "never");

    if (options.addDirs) {
      for (const dir of options.addDirs) {
        args.push("--add-dir", dir);
      }
    }

    return args;
  }

  private buildPrompt(options: SpawnOptions): string {
    if (!options.systemPrompt) {
      return options.prompt;
    }
    return [
      "SYSTEM INSTRUCTIONS:",
      options.systemPrompt,
      "",
      "USER PROMPT:",
      options.prompt,
    ].join("\n");
  }

  private spawnInteractive(
    args: string[],
    options: SpawnOptions,
  ): CodingAgentHandle {
    const processEnv = options.env
      ? { ...process.env, ...options.env }
      : undefined;

    let child: ChildProcess;
    try {
      child = spawn(this.command, args, {
        cwd: options.cwd,
        stdio: "inherit",
        env: processEnv,
      });
    } catch (err) {
      throw new Error(
        `Failed to spawn ${this.command}: ${(err as Error).message}`,
        { cause: err },
      );
    }

    let killed = false;
    const kill = () => {
      if (killed) return;
      killed = true;
      child.kill("SIGTERM");
    };

    const done = new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        child.on("error", (err) => {
          reject(new Error(`${this.command} process error: ${err.message}`));
        });
        child.on("exit", (code) => {
          if (killed) {
            reject(new Error("Process was killed"));
            return;
          }
          if (code !== 0 && code !== null) {
            reject(new Error(`${this.command} exited with code ${code}`));
            return;
          }
          resolve({ stdout: "", stderr: "" });
        });
      },
    );

    return { done, kill };
  }

  private spawnPiped(
    args: string[],
    prompt: string,
    options: SpawnOptions,
  ): CodingAgentHandle {
    const id = `zb-agent-${Date.now()}-${counter++}`;
    const fallbackDir = join(tmpdir(), "zombieben-agent");
    mkdirSync(fallbackDir, { recursive: true });

    const stdoutLogPath = options.stdoutLogPath ?? join(fallbackDir, `${id}-stdout.log`);
    const stderrLogPath = options.stderrLogPath ?? join(fallbackDir, `${id}-stderr.log`);
    mkdirSync(dirname(stdoutLogPath), { recursive: true });
    mkdirSync(dirname(stderrLogPath), { recursive: true });
    const stdoutStream = createWriteStream(stdoutLogPath);
    const stderrStream = createWriteStream(stderrLogPath);

    options.log?.debug(`Agent stdout log: tail -f ${stdoutLogPath}`);
    options.log?.debug(`Agent stderr log: tail -f ${stderrLogPath}`);

    const processEnv = options.env
      ? { ...process.env, ...options.env }
      : undefined;

    let child: ChildProcess;
    try {
      child = spawn(this.command, args, {
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: processEnv,
      });
    } catch (err) {
      stdoutStream.end();
      stderrStream.end();
      throw new Error(
        `Failed to spawn ${this.command}: ${(err as Error).message}`,
        { cause: err },
      );
    }

    let killed = false;
    const kill = () => {
      if (killed) return;
      killed = true;
      child.kill("SIGTERM");
    };

    const done = new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        const stdoutChunks: Buffer[] = [];
        let stderrText = "";

        child.stdin!.write(prompt);
        child.stdin!.end();

        child.stdout!.on("data", (chunk: Buffer) => {
          stdoutChunks.push(chunk);
          stdoutStream.write(chunk);
        });

        child.stderr!.on("data", (chunk: Buffer) => {
          stderrText += chunk.toString();
          stderrStream.write(chunk);
        });

        child.on("error", (err) => {
          stdoutStream.end();
          stderrStream.end();
          reject(new Error(`${this.command} process error: ${err.message}`));
        });

        child.on("close", (code) => {
          stdoutStream.end();
          stderrStream.end();
          const stdout = Buffer.concat(stdoutChunks).toString();

          if (killed) {
            reject(new Error("Process was killed"));
            return;
          }

          if (code !== 0 && code !== null) {
            reject(
              new Error(
                `${this.command} exited with code ${code}. stderr: ${stderrText.slice(0, 500)}`,
              ),
            );
            return;
          }

          resolve({ stdout, stderr: stderrText });
        });
      },
    );

    return { done, kill };
  }
}
