import fs from "node:fs";
import path from "node:path";

export interface DedupStore {
  has(triggerId: string): boolean;
  add(triggerId: string): void;
}

export class InMemoryDedupStore implements DedupStore {
  private seen = new Set<string>();

  has(triggerId: string): boolean {
    return this.seen.has(triggerId);
  }

  add(triggerId: string): void {
    this.seen.add(triggerId);
  }
}

export class FileDedupStore implements DedupStore {
  private seen: Set<string>;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.seen = new Set<string>();

    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as string[];
        for (const id of data) {
          this.seen.add(id);
        }
      } catch {
        // Corrupt file — start fresh
      }
    }
  }

  has(triggerId: string): boolean {
    return this.seen.has(triggerId);
  }

  add(triggerId: string): void {
    this.seen.add(triggerId);
    this.flush();
  }

  private flush(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify([...this.seen], null, 2));
  }
}
