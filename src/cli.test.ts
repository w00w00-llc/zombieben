import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { createProgram, getCliVersion } from "./cli.js";

const require = createRequire(import.meta.url);

type PackageJson = {
  version: string;
};

describe("cli", () => {
  it("uses the package version for the CLI version", () => {
    const { version } = require("../package.json") as PackageJson;

    expect(getCliVersion()).toBe(version);
    expect(createProgram().version()).toBe(version);
  });
});
