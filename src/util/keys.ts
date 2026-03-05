import fs from "node:fs";
import path from "node:path";
import { zombiebenDir } from "./paths.js";

export type IntegrationKeys = Record<string, Record<string, string>>;

export function keysPath(): string {
  return path.join(zombiebenDir(), "keys.json");
}

export function readKeys(): IntegrationKeys {
  const p = keysPath();
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf-8")) as IntegrationKeys;
}

export function writeKeys(keys: IntegrationKeys): void {
  fs.writeFileSync(keysPath(), JSON.stringify(keys, null, 2));
}

export function getIntegrationKeys(
  id: string,
): Record<string, string> | undefined {
  return readKeys()[id];
}

export function setIntegrationKeys(
  id: string,
  keys: Record<string, string>,
): void {
  const all = readKeys();
  all[id] = { ...all[id], ...keys };
  writeKeys(all);
}
