import { prisma } from "../db/prisma.js";
import { createSlackClient } from "./slackClient.js";

/**
 * Create or get Slack channel for a chat
 */
export async function getOrCreateSlackChannel(chat, ownerSlackToken) {
  // If channel already exists, return it
  if (chat.slackChannelId) {
    return chat.slackChannelId;
  }

  const client = createSlackClient(ownerSlackToken);

  // Create private channel name (Slack has character limits)
  const channelName = sanitizeChannelName(chat.name, chat.id);

  try {
    // Create private channel
    const result = await client.conversations.create({
      name: channelName,
      is_private: true,
    });

    const channelId = result.channel.id;

    // Update chat with channel ID
    await prisma.chat.update({
      where: { id: chat.id },
      data: {
        slackChannelId: channelId,
        slackChannelName: channelName,
      },
    });

    // Set channel topic
    await client.conversations.setTopic({
      channel: channelId,
      topic: `e-SME Chat: ${chat.name}`,
    });

    // Post initial message with file info
    await postChatInitMessage(client, channelId, chat);

    return channelId;
  } catch (error) {
    console.error("Error creating Slack channel:", error);
    throw error;
  }
}

/**
 * Add user to Slack channel
 */
export async function addUserToChannel(channelId, slackUserId, inviterToken) {
  const client = createSlackClient(inviterToken);

  try {
    await client.conversations.invite({
      channel: channelId,
      users: slackUserId,
    });
    return true;
  } catch (error) {
    // User might already be in channel
    if (error.data?.error === "already_in_channel") {
      return true;
    }
    console.error("Error adding user to channel:", error);
    throw error;
  }
}

/**
 * Post message to Slack channel
 */
export async function postMessageToSlack(channelId, text, userToken, threadTs = null) {
  const client = createSlackClient(userToken);

  try {
    const result = await client.chat.postMessage({
      channel: channelId,
      text,
      thread_ts: threadTs, // For threading
    });

    return result.ts; // Slack message timestamp (unique ID)
  } catch (error) {
    console.error("Error posting to Slack:", error);
    throw error;
  }
}

/**
 * Sync message history to Slack
 */
export async function syncMessagesToSlack(chat, userToken) {
  const messages = await prisma.message.findMany({
    where: {
      chatId: chat.id,
      syncedToSlack: false,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!messages.length) return;

  const client = createSlackClient(userToken);

  for (const msg of messages) {
    try {
      const emoji = msg.sender === "user" ? "👤" : "🤖";
      const senderName = msg.sender === "user" ? "You" : "AI Assistant";
      const text = `${emoji} *${senderName}*\n${msg.text}`;

      const result = await client.chat.postMessage({
        channel: chat.slackChannelId,
        text,
        username: senderName,
      });

      // Mark as synced
      await prisma.message.update({
        where: { id: msg.id },
        data: {
          syncedToSlack: true,
          slackTs: result.ts,
        },
      });
    } catch (error) {
      console.error(`Error syncing message ${msg.id}:`, error);
    }
  }
}

/**
 * Post initial chat info message
 */
async function postChatInitMessage(client, channelId, chat) {
  const files = await prisma.chatFile.findMany({
    where: { chatId: chat.id },
    select: { name: true, mimeType: true },
  });

  let text = `📂 *${chat.name}*\n\n`;

  if (files.length > 0) {
    text += `📎 *Attached Documents:*\n`;
    files.forEach((f) => text += `• ${f.name}\n`);
    text += `\n`;
  }

  text += `💬 Ask questions about these documents and I'll help you!\n`;
  text += `🌐 View in web app: ${process.env.FRONTEND_URL}`;

  await client.chat.postMessage({
    channel: channelId,
    text,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `📂 ${chat.name}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: files.length > 0
            ? `📎 *${files.length} document(s) attached*`
            : "No documents attached yet",
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "💬 Ask me anything about these documents!",
        },
      },
    ],
  });
}

/**
 * Sanitize channel name for Slack
 */
function sanitizeChannelName(name, chatId) {
  // Slack channel names: lowercase, no spaces, max 80 chars
  let sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Add unique suffix
  const suffix = chatId.slice(-8);
  sanitized = `esme-${sanitized}-${suffix}`;

  // Truncate if needed
  if (sanitized.length > 80) {
    sanitized = sanitized.substring(0, 72) + suffix;
  }

  return sanitized;
}