import express from "express";
import { prisma } from "../db/prisma.js";

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

  const chat = await prisma.chat.findFirst({
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
        },
      },
    },
  });

  if (!chat) return res.status(404).json({ error: "Chat not found" });

  // ✅ Fix BigInt JSON serialization
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
 */
chatsRouter.patch("/:id", async (req, res) => {
  const userId = req.user.id;
  const chatId = req.params.id;

  // ownership check
  const existing = await prisma.chat.findFirst({
    where: { id: chatId, ownerId: userId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Chat not found" });

  const data = {};

  if (typeof req.body?.name === "string") {
    const trimmed = req.body.name.trim();
    if (!trimmed) return res.status(400).json({ error: "name cannot be empty" });
    data.name = trimmed;
  }

  if (typeof req.body?.systemPrompt === "string") {
    const trimmed = req.body.systemPrompt.trim();
    // allow empty => clear
    data.systemPrompt = trimmed ? trimmed : null;
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
    },
  });

  res.json({ chat });
});

/**
 * DELETE /chats/:id
 */
chatsRouter.delete("/:id", async (req, res) => {
  const userId = req.user.id;
  const chatId = req.params.id;

  const existing = await prisma.chat.findFirst({
    where: { id: chatId, ownerId: userId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Chat not found" });

  await prisma.chat.delete({ where: { id: chatId } });
  res.json({ ok: true });
});