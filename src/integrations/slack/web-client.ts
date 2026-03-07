import { WebClient } from "@slack/web-api";
import { getIntegrationKeys } from "@/util/keys.js";

export function createSlackWebClient(): WebClient {
  const keys = getIntegrationKeys("slack");
  const token = keys?.bot_token;
  if (!token) {
    throw new Error(
      "Slack bot token not configured. See src/integrations/slack/INTEGRATION.md for setup instructions.",
    );
  }
  return new WebClient(token);
}
