import express from "express";
import { prisma } from "../db/prisma.js";
import {
  renameSlackChannelForChat,
  archiveSlackChannelForChat,
} from "../services/slackChatSync.js";

export const chatsRouter = express.Router();

/**
 * POST /chats
 * body: { name?: string, systemPrompt?: string }
 */
chatsRouter.post("/", async (req, res) => {
  const userId = req.user.id;
  const nameRaw = req.body?.name;
  const systemPromptRaw = req.body?.systemPrompt;

  const name =
    typeof nameRaw === "string" && nameRaw.trim()
      ? nameRaw.trim()
      : "Untitled chat";

  const systemPrompt =
    typeof systemPromptRaw === "string" && systemPromptRaw.trim()
      ? systemPromptRaw.trim()
      : null;

  const chat = await prisma.chat.create({
    data: {
      ownerId: userId,
      name,
      systemPrompt,
      scope: "PERSONAL",
      filesLocked: false,
    },
    select: {
      id: true,
      name: true,
      systemPrompt: true,
      filesLocked: true,
      scope: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res.status(201).json({ chat });
});

/**
 * GET /chats
 * returns my chats, newest first
 */
chatsRouter.get("/", async (req, res) => {
  const userId = req.user.id;

  const chats = await prisma.chat.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      filesLocked: true,
      scope: true,
      updatedAt: true,
      createdAt: true,
      slackChannelId: true,
      slackChannelName: true,
    },
  });

  res.json({ chats });
});

/**
 * GET /chats/:id
 * loads a chat with messages + files
 */
chatsRouter.get("/:id", async (req, res) => {
  const userId = req.user.id;
  const chatId = req.params.id;

  let chat = await prisma.chat.findFirst({
    where: { id: chatId, ownerId: userId },
    include: {
      files: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          driveFileId: true,
          name: true,
          mimeType: true,
          createdAt: true,
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          sender: true,
          text: true,
          timestamp: true,
          createdAt: true,
          userId: true,
          slackTs: true,
        },
      },
    },
  });

  if (!chat) return res.status(404).json({ error: "Chat not found" });

  // Create Slack channel if user has Slack connected and channel doesn't exist
  if (req.user.slackAccessToken && !chat.slackChannelId) {
    try {
      console.log("🚀 Creating Slack channel for chat:", chat.id);

      const { getOrCreateSlackChannel, syncMessagesToSlack } = await import(
        "../services/slackChannelManager.js"
      );

      await getOrCreateSlackChannel(chat, req.user.slackAccessToken);

      // Reload chat to get slackChannelId
      chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: {
          files: { orderBy: { createdAt: "asc" } },
          messages: { orderBy: { createdAt: "asc" } },
          owner: true,
        },
      });

      console.log("✅ Chat reloaded with channel ID:", chat.slackChannelId);

      // Sync existing messages
      if (chat.messages.length > 0) {
        await syncMessagesToSlack(chat, req.user.slackAccessToken);
      }
    } catch (error) {
      console.error("❌ Slack error:", error);
      // Continue without Slack
    }
  }

  // Fix BigInt JSON serialization
  const safeChat = {
    ...chat,
    messages: chat.messages.map((m) => ({
      ...m,
      timestamp: m.timestamp != null ? m.timestamp.toString() : null,
    })),
  };

  res.json({ chat: safeChat });
});

/**
 * PATCH /chats/:id
 * body can include: { name?, systemPrompt?, filesLocked? }
 *
 * NEW: If name changes and Slack channel exists, rename Slack channel too.
 */
chatsRouter.patch("/:id", async (req, res) => {
  const userId = req.user.id;
  const chatId = req.params.id;

  // ownership check + get current name/slack info for rename detection
  const existing = await prisma.chat.findFirst({
    where: { id: chatId, ownerId: userId },
    select: {
      id: true,
      name: true,
      slackChannelId: true,
    },
  });
  if (!existing) return res.status(404).json({ error: "Chat not found" });

  const data = {};
  let nameChanged = false;

  if (typeof req.body?.name === "string") {
    const trimmed = req.body.name.trim();
    if (!trimmed) return res.status(400).json({ error: "name cannot be empty" });
    data.name = trimmed;
    nameChanged = trimmed !== existing.name;
  }

  if (typeof req.body?.systemPrompt === "string") {
    const trimmed = req.body.systemPrompt.trim();
    data.systemPrompt = trimmed ? trimmed : null; // allow empty => clear
  }

  if (typeof req.body?.filesLocked === "boolean") {
    data.filesLocked = req.body.filesLocked;
  }

  const chat = await prisma.chat.update({
    where: { id: chatId },
    data,
    select: {
      id: true,
      name: true,
      systemPrompt: true,
      filesLocked: true,
      scope: true,
      createdAt: true,
      updatedAt: true,
      slackChannelId: true,
      slackChannelName: true,
    },
  });

  // 🔁 Slack rename sync (best-effort, never block API response)
  if (nameChanged && existing.slackChannelId) {
    try {
      await renameSlackChannelForChat(chatId);
    } catch (e) {
      console.error("Slack rename sync failed:", e);
    }
  }

  res.json({ chat });
});

/**
 * DELETE /chats/:id
 *
 * NEW: Archive Slack channel (Slack doesn't "delete" channels) before deleting DB row.
 */
chatsRouter.delete("/:id", async (req, res) => {
  const userId = req.user.id;
  const chatId = req.params.id;

  const existing = await prisma.chat.findFirst({
    where: { id: chatId, ownerId: userId },
    select: { id: true, slackChannelId: true },
  });
  if (!existing) return res.status(404).json({ error: "Chat not found" });

  // 🔁 Slack archive sync (best-effort)
  if (existing.slackChannelId) {
    try {
      await archiveSlackChannelForChat(chatId);
    } catch (e) {
      console.error("Slack archive sync failed:", e);
    }
  }

  await prisma.chat.delete({ where: { id: chatId } });

  res.json({ ok: true });
});
