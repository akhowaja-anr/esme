import express from "express";
import { prisma } from "../db/prisma.js";
import { callGemini } from "../services/gemini.js";
import { getDriveFileContent } from "../services/driveContent.js";

export const aiRouter = express.Router();

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful AI assistant that analyzes documents and answers questions based on their content.";

aiRouter.post("/prompt", async (req, res) => {
  try {
    const userId = req.user.id;
    const accessToken = req.googleAccessToken;
    const { chatId, userPrompt, systemPrompt } = req.body;

    if (!chatId || !userPrompt) {
      return res.status(400).json({ error: "Missing chatId or userPrompt" });
    }

    // Get chat
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, ownerId: userId },
      include: { files: true },
    });

    if (!chat) {
      return res.status(404).json({ error: "Chat not found or access denied" });
    }

    if (!chat.files || chat.files.length === 0) {
      return res.status(400).json({
        error: "No files attached to this chat. Please attach files first.",
      });
    }

    // Save user message
    const userMessage = await prisma.message.create({
      data: {
        chatId: chat.id,
        sender: "user",
        text: userPrompt.trim(),
        timestamp: BigInt(Date.now()),
        userId,
      },
    });

    // Post user message to Slack if channel exists
    if (chat.slackChannelId && req.user.slackAccessToken) {
      try {
        const { postMessageToSlack } = await import("../services/slackChannelManager.js");
        
        const slackTs = await postMessageToSlack(
          chat.slackChannelId,
          `👤 *You*\n${userPrompt.trim()}`,
          req.user.slackAccessToken
        );
        
        await prisma.message.update({
          where: { id: userMessage.id },
          data: { slackTs, syncedToSlack: true },
        });
      } catch (error) {
        console.error("Error posting user message to Slack:", error);
      }
    }

    // Get file contents
    const fileContents = [];
    for (const f of chat.files) {
      try {
        const contentData = await getDriveFileContent({
          accessToken,
          fileId: f.driveFileId,
          mimeType: f.mimeType,
        });
        fileContents.push(contentData);
      } catch (err) {
        const msg =
          err && typeof err === "object" && "message" in err
            ? err.message
            : String(err);

        fileContents.push({
          name: f.name || `File ID: ${f.driveFileId}`,
          mimeType: f.mimeType || "error",
          content: `Error reading file: ${msg}`,
          note: "Error",
        });
      }
    }

    // Build prompt
    const effectiveSystemPrompt =
      systemPrompt && systemPrompt.trim()
        ? systemPrompt.trim()
        : chat.systemPrompt || "You are a helpful AI assistant.";

    let combinedPrompt = `${effectiveSystemPrompt}\n\n***DOCUMENTS CONTENT***\n\n`;

    fileContents.forEach((file, index) => {
      combinedPrompt += `\n--- START DOCUMENT ${index + 1} (${file.name} - ${file.mimeType}) ---\n`;
      combinedPrompt += file.content || "";
      if (file.note) {
        combinedPrompt += `\n[Note: ${file.note}]`;
      }
      combinedPrompt += `\n--- END DOCUMENT ${index + 1} ---\n`;
    });

    combinedPrompt +=
      `\n***USER REQUEST***\n\n` +
      `${userPrompt.trim()}\n\n` +
      `***INSTRUCTIONS***\n\n` +
      `Please provide a comprehensive and accurate response based on the document content above. ` +
      `If the information needed to answer the question is not available in the documents, please state that clearly.\n\n` +
      `***AI RESPONSE***\n\n`;

    // Call AI
    const aiResponse = await callGemini(combinedPrompt);

    // Save AI message
    const aiMessage = await prisma.message.create({
      data: {
        chatId: chat.id,
        sender: "ai",
        text: aiResponse,
        timestamp: BigInt(Date.now()),
      },
    });

    // Post AI response to Slack
    if (chat.slackChannelId && req.user.slackAccessToken) {
      try {
        const { postMessageToSlack } = await import("../services/slackChannelManager.js");
        
        const slackTs = await postMessageToSlack(
          chat.slackChannelId,
          `🤖 *AI Assistant*\n${aiResponse}`,
          req.user.slackAccessToken
        );
        
        await prisma.message.update({
          where: { id: aiMessage.id },
          data: { slackTs, syncedToSlack: true },
        });
      } catch (error) {
        console.error("Error posting AI response to Slack:", error);
      }
    }

    res.json({ aiResponse });
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e ? e.message : String(e);
    res.status(500).json({ error: message || "ai prompt error" });
  }
});