import express from "express";
import { prisma } from "../db/prisma.js";

const router = express.Router();

/**
 * POST /chats/:id/files
 * Attach a single file to chat
 * body: { driveFileId, name, mimeType }
 */
router.post("/:id/files", async (req, res) => {
  const { id: chatId } = req.params;
  const { driveFileId, name, mimeType } = req.body;
  const userId = req.user.id;

  if (!driveFileId || !name || !mimeType) {
    return res.status(400).json({ 
      error: "driveFileId, name, and mimeType are required" 
    });
  }

  const chat = await prisma.chat.findFirst({
    where: { id: chatId, ownerId: userId },
  });

  if (!chat) return res.status(404).json({ error: "Chat not found" });
  if (chat.filesLocked) {
    return res.status(403).json({ error: "Files are locked" });
  }

  // Check if file already attached
  const existing = await prisma.chatFile.findFirst({
    where: { chatId, driveFileId },
  });

  if (existing) {
    return res.json({ file: existing, note: "File already attached" });
  }

  const file = await prisma.chatFile.create({
    data: {
      chatId,
      driveFileId,
      name,
      mimeType,
    },
  });

  res.status(201).json({ file });
});

/**
 * DELETE /chats/:id/files/:driveFileId
 * Remove a file from chat
 */
router.delete("/:id/files/:driveFileId", async (req, res) => {
  const { id: chatId, driveFileId } = req.params;
  const userId = req.user.id;

  const chat = await prisma.chat.findFirst({
    where: { id: chatId, ownerId: userId },
  });

  if (!chat) return res.status(404).json({ error: "Chat not found" });
  if (chat.filesLocked) {
    return res.status(403).json({ error: "Files are locked" });
  }

  await prisma.chatFile.deleteMany({
    where: { chatId, driveFileId },
  });

  res.json({ ok: true });
});

export { router as chatFilesRouter };