import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readIntegrationsConfig, getIntegrationConfig } from "./integrations-config.js";

const TEST_DIR = path.join(os.tmpdir(), "zombieben-integrations-config-test");

describe("integrations-config", () => {
  beforeEach(() => {
    process.env.ZOMBIEBEN_RUNNER_DIR = TEST_DIR;
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    delete process.env.ZOMBIEBEN_RUNNER_DIR;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("readIntegrationsConfig", () => {
    it("returns empty object when file does not exist", () => {
      expect(readIntegrationsConfig()).toEqual({});
    });

    it("reads and parses integrations.json", () => {
      fs.writeFileSync(
        path.join(TEST_DIR, "integrations.json"),
        JSON.stringify({
          linear: {
            mcp: { command: "npx", args: ["-y", "@linear/mcp-server"] },
            env_var: "LINEAR_API_KEY",
          },
        }),
      );
      const config = readIntegrationsConfig();
      expect(config.linear).toBeDefined();
      expect(config.linear!.mcp!.command).toBe("npx");
      expect(config.linear!.env_var).toBe("LINEAR_API_KEY");
    });
  });

  describe("getIntegrationConfig", () => {
    it("returns undefined for unconfigured integration", () => {
      expect(getIntegrationConfig("linear")).toBeUndefined();
    });

    it("returns built-in config for aws", () => {
      const config = getIntegrationConfig("aws");
      expect(config).toBeDefined();
      expect(config!.env).toMatchObject({
        AWS_ACCESS_KEY_ID: "$access_key_id",
        AWS_SECRET_ACCESS_KEY: "$secret_access_key",
        AWS_REGION: "$region",
        AWS_CLOUDFRONT_DISTRIBUTION_URL: "$cloudfront_distribution_url",
        AWS_BUCKET_NAME: "$bucket_name",
      });
      expect(config!.required_keys).toEqual([
        "access_key_id",
        "secret_access_key",
        "region",
        "cloudfront_distribution_url",
        "bucket_name",
      ]);
    });

    it("returns config for configured integration", () => {
      fs.writeFileSync(
        path.join(TEST_DIR, "integrations.json"),
        JSON.stringify({
          linear: { env_var: "LINEAR_API_KEY" },
        }),
      );
      const config = getIntegrationConfig("linear");
      expect(config).toBeDefined();
      expect(config!.env_var).toBe("LINEAR_API_KEY");
    });

    it("merges configured integration fields with aws defaults", () => {
      fs.writeFileSync(
        path.join(TEST_DIR, "integrations.json"),
        JSON.stringify({
          aws: {
            env: { AWS_BUCKET_NAME: "$custom_bucket" },
          },
        }),
      );

      const config = getIntegrationConfig("aws");
      expect(config!.env).toMatchObject({
        AWS_ACCESS_KEY_ID: "$access_key_id",
        AWS_BUCKET_NAME: "$custom_bucket",
      });
    });
  });
});
