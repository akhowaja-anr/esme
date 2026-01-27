import { WebClient } from "@slack/web-api";

export function createSlackClient(accessToken) {
  return new WebClient(accessToken);
}

export async function sendSlackMessage(client, channel, text, blocks = null) {
  try {
    const payload = {
      channel,
      text,
    };
    
    if (blocks) {
      payload.blocks = blocks;
    }
    
    return await client.chat.postMessage(payload);
  } catch (error) {
    console.error("Error sending Slack message:", error);
    throw error;
  }
}

export async function getUserInfo(client, userId) {
  try {
    const result = await client.users.info({ user: userId });
    return result.user;
  } catch (error) {
    console.error("Error getting user info:", error);
    throw error;
  }
}