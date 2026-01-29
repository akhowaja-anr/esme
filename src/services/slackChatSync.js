// services/slackChatSync.js
import { prisma } from "../db/prisma.js";
import { createSlackClient } from "./slackClient.js";

/**
 * Slack channel name rules:
 * - lowercase
 * - max 80 chars
 * - only letters, numbers, hyphen, underscore
 */
function sanitizeChannelName(name, chatId) {
  let sanitized = (name || "chat")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const suffix = chatId.slice(-8);
  sanitized = `esme-${sanitized}-${suffix}`;

  if (sanitized.length > 80) {
    sanitized = sanitized.substring(0, 72) + "-" + suffix;
  }

  return sanitized;
}

/**
 * Rename the Slack channel when a chat is renamed in the web app.
 * - Only runs if chat has slackChannelId and owner has slackAccessToken.
 * - Updates DB slackChannelName.
 */
export async function renameSlackChannelForChat(chatId) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { owner: true },
  });

  if (!chat) return { ok: false, reason: "chat_not_found" };
  if (!chat.slackChannelId) return { ok: false, reason: "no_slack_channel" };
  if (!chat.owner?.slackAccessToken) return { ok: false, reason: "no_slack_token" };

  const desiredName = sanitizeChannelName(chat.name, chat.id);

  // If already matches, do nothing
  if (chat.slackChannelName === desiredName) {
    return { ok: true, renamed: false, channelName: desiredName };
  }

  const client = createSlackClient(chat.owner.slackAccessToken);

  try {
    const result = await client.conversations.rename({
      channel: chat.slackChannelId,
      name: desiredName,
    });

    const newName = result?.channel?.name || desiredName;

    await prisma.chat.update({
      where: { id: chat.id },
      data: { slackChannelName: newName },
    });

    // Optional: keep topic aligned too
    try {
      await client.conversations.setTopic({
        channel: chat.slackChannelId,
        topic: `e-SME Chat: ${chat.name}`,
      });
    } catch (e) {
      // ignore topic failures
    }

    return { ok: true, renamed: true, channelName: newName };
  } catch (error) {
    const code = error?.data?.error || error?.code || "unknown";

    // Common rename failure: name_taken, invalid_name, restricted_action
    // If name is taken, try a unique variant.
    if (code === "name_taken") {
      const fallback = sanitizeChannelName(`${chat.name}-1`, chat.id);
      try {
        const retry = await client.conversations.rename({
          channel: chat.slackChannelId,
          name: fallback,
        });

        const retryName = retry?.channel?.name || fallback;

        await prisma.chat.update({
          where: { id: chat.id },
          data: { slackChannelName: retryName },
        });

        return { ok: true, renamed: true, channelName: retryName, fallbackUsed: true };
      } catch (e2) {
        return { ok: false, reason: "rename_failed", error: e2?.data?.error || e2?.message || String(e2) };
      }
    }

    return {
      ok: false,
      reason: "rename_failed",
      error: error?.data?.error || error?.message || String(error),
    };
  }
}

/**
 * "Delete" on Slack == archive channel
 * - Archives the channel if it exists.
 * - Safe to call even if already archived or not found.
 */
export async function archiveSlackChannelForChat(chatId) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { owner: true },
  });

  if (!chat) return { ok: false, reason: "chat_not_found" };
  if (!chat.slackChannelId) return { ok: true, archived: false, reason: "no_slack_channel" };
  if (!chat.owner?.slackAccessToken) return { ok: true, archived: false, reason: "no_slack_token" };

  const client = createSlackClient(chat.owner.slackAccessToken);

  try {
    await client.conversations.archive({ channel: chat.slackChannelId });

    // Optional: you can keep these fields, but often nice to clear them
    // so a future chat with same ID doesn't attempt to reuse old channel.
    await prisma.chat.update({
      where: { id: chat.id },
      data: {
        slackChannelId: null,
        slackChannelName: null,
      },
    });

    return { ok: true, archived: true };
  } catch (error) {
    const code = error?.data?.error || "unknown";

    // These are "fine"
    if (code === "already_archived" || code === "channel_not_found") {
      await prisma.chat.update({
        where: { id: chat.id },
        data: {
          slackChannelId: null,
          slackChannelName: null,
        },
      });
      return { ok: true, archived: true, reason: code };
    }

    return {
      ok: false,
      reason: "archive_failed",
      error: error?.data?.error || error?.message || String(error),
    };
  }
}
