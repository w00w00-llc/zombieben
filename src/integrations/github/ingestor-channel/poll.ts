import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { IngestorChannel } from "@/ingestor/ingestor-channel.js";
import type { Ingestor } from "@/ingestor/ingestor.js";
import type { Trigger } from "@/ingestor/trigger.js";
import type { TriggerResponder } from "@/responder/responder.js";
import { getIntegrationKeys } from "@/util/keys.js";
import { ingestorDir, reposDir } from "@/util/paths.js";
import { log } from "@/util/logger.js";
import { GithubNoopResponder } from "../trigger-responder/index.js";
import type { GithubRepoEvent, GithubWorkflowRun } from "./types.js";
import { isGithubPollTrigger } from "./types.js";
import {
  repoSlugToOwnerRepo,
  transformGithubPolledEvent,
  transformGithubPolledWorkflowRun,
} from "./transform.js";
import { shouldSuppressGithubTrigger } from "./suppression.js";

interface RepoPollState {
  lastEventId?: string;
  lastWorkflowRunId?: number;
  etag?: string;
  updatedAt?: string;
}

interface PollState {
  repos: Record<string, RepoPollState>;
}

interface FetchResult {
  status: number;
  events: GithubRepoEvent[];
  etag?: string;
  hasNextPage: boolean;
}

interface WorkflowRunsFetchResult {
  status: number;
  runs: GithubWorkflowRun[];
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MAX_EVENT_PAGES = 5;

export function createGithubPollChannel(): IngestorChannel {
  let timer: NodeJS.Timeout | null = null;
  let inFlight = false;
  let running = false;

  return {
    name: "github-poll",

    isEnabled(): boolean {
      const token = getGithubToken();
      if (!token) return false;
      return listRepoSlugs().length > 0;
    },

    async startListener(ingestor: Ingestor): Promise<void> {
      if (running) return;
      running = true;
      const intervalMs = getPollIntervalMs();

      await pollOnce(ingestor, () => inFlight, (v) => { inFlight = v; });
      timer = setInterval(() => {
        void pollOnce(ingestor, () => inFlight, (v) => { inFlight = v; });
      }, intervalMs);
      log.info(`GitHub poll listener started (interval ${Math.round(intervalMs / 1000)}s).`);
    },

    async stopListener(): Promise<void> {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      log.info("GitHub poll listener stopped.");
    },

    getPrimaryResponder(trigger: Trigger): TriggerResponder {
      if (!isGithubPollTrigger(trigger)) {
        throw new Error(`Expected github_poll trigger, got ${trigger.source}`);
      }
      return new GithubNoopResponder();
    },

    getChannelKey(trigger: Trigger): string {
      if (!isGithubPollTrigger(trigger)) {
        throw new Error(`Expected github_poll trigger, got ${trigger.source}`);
      }
      const ownerRepo = trigger.context?.ownerRepo;
      return ownerRepo ? `github:${ownerRepo}` : "github:poll";
    },
  };
}

async function pollOnce(
  ingestor: Ingestor,
  getInFlight: () => boolean,
  setInFlight: (value: boolean) => void,
): Promise<void> {
  if (getInFlight()) return;
  setInFlight(true);
  try {
    const token = getGithubToken();
    if (!token) return;

    const repoSlugs = listRepoSlugs();
    if (repoSlugs.length === 0) return;

    const state = readPollState();
    let emitted = 0;

    for (const repoSlug of repoSlugs) {
      const ownerRepo = readOwnerRepo(repoSlug);
      if (!ownerRepo) {
        log.warn(
          `GitHub poll: skipping repo "${repoSlug}" (missing/invalid github_url in repo-config.yml and could not infer from slug)`,
        );
        continue;
      }
      try {
        emitted += await pollRepo(
          repoSlug,
          ownerRepo,
          token,
          ingestor,
          state,
        );
        emitted += await pollCompletedWorkflowRuns(
          repoSlug,
          ownerRepo,
          token,
          ingestor,
          state,
        );
      } catch (err) {
        log.error(
          `GitHub poll failed for ${repoSlug}: ${(err as Error).message}`,
        );
      }
    }

    writePollState(state);
    if (emitted > 0) {
      log.info(`GitHub poll emitted ${emitted} trigger(s).`);
    }
  } finally {
    setInFlight(false);
  }
}

async function pollRepo(
  repoSlug: string,
  ownerRepo: string,
  token: string,
  ingestor: Ingestor,
  state: PollState,
): Promise<number> {
  const repoState = state.repos[repoSlug] ?? {};
  const firstPage = await fetchRepoEvents(ownerRepo, token, 1, repoState.etag);
  if (firstPage.status === 304) {
    return 0;
  }

  const newestEventId = firstPage.events[0]?.id;
  if (!repoState.lastEventId) {
    if (newestEventId) {
      state.repos[repoSlug] = {
        lastEventId: newestEventId,
        etag: firstPage.etag,
        updatedAt: new Date().toISOString(),
      };
      log.info(
        `GitHub poll bootstrap for ${repoSlug}: checkpointed ${firstPage.events.length} event(s) at id=${newestEventId}`,
      );
    }
    return 0;
  }

  const freshEvents: GithubRepoEvent[] = [];
  let foundCheckpoint = false;
  let page = 1;
  let pageResult = firstPage;
  while (true) {
    for (const ev of pageResult.events) {
      if (ev.id === repoState.lastEventId) {
        foundCheckpoint = true;
        break;
      }
      freshEvents.push(ev);
    }
    if (foundCheckpoint || !pageResult.hasNextPage || page >= MAX_EVENT_PAGES) {
      break;
    }
    page += 1;
    pageResult = await fetchRepoEvents(ownerRepo, token, page);
  }

  let emitted = 0;
  for (const ev of freshEvents.reverse()) {
    const trigger = transformGithubPolledEvent(repoSlug, ownerRepo, ev);
    if (shouldSuppressGithubTrigger(trigger, ev.type)) {
      continue;
    }
    ingestor.submit(trigger);
    emitted += 1;
  }

  if (newestEventId) {
    state.repos[repoSlug] = {
      lastEventId: newestEventId,
      etag: firstPage.etag,
      updatedAt: new Date().toISOString(),
    };
  }
  return emitted;
}

async function pollCompletedWorkflowRuns(
  repoSlug: string,
  ownerRepo: string,
  token: string,
  ingestor: Ingestor,
  state: PollState,
): Promise<number> {
  const repoState = state.repos[repoSlug] ?? {};
  const response = await fetchCompletedWorkflowRuns(ownerRepo, token);
  if (response.status === 304) return 0;

  const newestRunId = response.runs[0]?.id;
  if (!repoState.lastWorkflowRunId) {
    if (typeof newestRunId === "number") {
      state.repos[repoSlug] = {
        ...repoState,
        lastWorkflowRunId: newestRunId,
        updatedAt: new Date().toISOString(),
      };
      log.info(
        `GitHub poll bootstrap workflow runs for ${repoSlug}: checkpointed ${response.runs.length} run(s) at id=${newestRunId}`,
      );
    }
    return 0;
  }

  const freshRuns: GithubWorkflowRun[] = [];
  for (const run of response.runs) {
    if (run.id === repoState.lastWorkflowRunId) break;
    freshRuns.push(run);
  }

  let emitted = 0;
  for (const run of freshRuns.reverse()) {
    const trigger = transformGithubPolledWorkflowRun(repoSlug, ownerRepo, run);
    if (shouldSuppressGithubTrigger(trigger, "workflow_run")) {
      continue;
    }
    ingestor.submit(trigger);
    emitted += 1;
  }

  if (typeof newestRunId === "number") {
    state.repos[repoSlug] = {
      ...state.repos[repoSlug],
      lastWorkflowRunId: newestRunId,
      updatedAt: new Date().toISOString(),
    };
  }
  return emitted;
}

async function fetchRepoEvents(
  ownerRepo: string,
  token: string,
  page: number,
  etag?: string,
): Promise<FetchResult> {
  const url = `https://api.github.com/repos/${ownerRepo}/events?per_page=100&page=${page}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "zombieben-github-poller",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (etag) headers["If-None-Match"] = etag;

  const res = await fetch(url, { headers });
  if (res.status === 304) {
    return { status: 304, events: [], hasNextPage: false, etag };
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} for ${ownerRepo}: ${body.slice(0, 300)}`);
  }

  const events = (await res.json()) as GithubRepoEvent[];
  const link = res.headers.get("link") || "";
  return {
    status: res.status,
    events,
    etag: res.headers.get("etag") || undefined,
    hasNextPage: link.includes('rel="next"'),
  };
}

async function fetchCompletedWorkflowRuns(
  ownerRepo: string,
  token: string,
): Promise<WorkflowRunsFetchResult> {
  const url = `https://api.github.com/repos/${ownerRepo}/actions/runs?status=completed&per_page=100`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "zombieben-github-poller",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} workflow runs for ${ownerRepo}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { workflow_runs?: GithubWorkflowRun[] };
  return {
    status: res.status,
    runs: Array.isArray(data.workflow_runs) ? data.workflow_runs : [],
  };
}

function getGithubToken(): string | undefined {
  const keys = getIntegrationKeys("github");
  return keys?.pat ?? keys?.token ?? keys?.api_key;
}

function getPollIntervalMs(): number {
  const raw = process.env.ZOMBIEBEN_GITHUB_POLL_INTERVAL_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 5000) {
    return parsed;
  }
  return DEFAULT_POLL_INTERVAL_MS;
}

function listRepoSlugs(): string[] {
  const root = reposDir();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function readOwnerRepo(repoSlug: string): string | null {
  const configPath = path.join(reposDir(), repoSlug, "repo-config.yml");
  if (fs.existsSync(configPath)) {
    try {
      const raw = yaml.load(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown> | null;
      const githubUrl = raw?.github_url;
      if (typeof githubUrl === "string") {
        const parsed = parseGithubOwnerRepoFromUrl(githubUrl);
        if (parsed) return parsed;
      }
    } catch {
      // Fall through to slug inference.
    }
  }

  const inferred = repoSlugToOwnerRepo(repoSlug);
  return inferred ? `${inferred.owner}/${inferred.repo}` : null;
}

function parseGithubOwnerRepoFromUrl(url: string): string | null {
  const normalized = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const match = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

function pollStatePath(): string {
  return path.join(ingestorDir(), "github_poll_state.json");
}

function readPollState(): PollState {
  const file = pollStatePath();
  if (!fs.existsSync(file)) return { repos: {} };
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as PollState;
  } catch {
    return { repos: {} };
  }
}

function writePollState(state: PollState): void {
  const file = pollStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}
