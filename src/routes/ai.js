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
    const accessToken = req.googleAccessToken; // set by requireGoogleAccessToken middleware

    const { chatId, userPrompt, systemPrompt } = req.body || {};

    if (!chatId || typeof chatId !== "string") {
      return res.status(400).json({ error: "chatId is required" });
    }
    if (!userPrompt || typeof userPrompt !== "string" || !userPrompt.trim()) {
      return res.status(400).json({ error: "userPrompt is required" });
    }
    if (!accessToken) {
      return res.status(401).json({
        error:
          "Missing Google access token. Send Authorization: Bearer <google_access_token>",
      });
    }

    // Load chat + files from DB
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, ownerId: userId },
      select: {
        id: true,
        systemPrompt: true,
        name: true,
        filesLocked: true,
        files: {
          select: { driveFileId: true, name: true, mimeType: true },
        },
      },
    });

    if (!chat) return res.status(404).json({ error: "Chat not found" });

    const finalSystemPrompt =
      typeof systemPrompt === "string" && systemPrompt.trim()
        ? systemPrompt.trim()
        : chat.systemPrompt || DEFAULT_SYSTEM_PROMPT;

    // Fetch file contents (Apps Script parity)
    const fileContents = [];
    for (const f of chat.files) {
      try {
        const contentData = await getDriveFileContent({
          accessToken,
          fileId: f.driveFileId,
          mimeType: f.mimeType,
        });

        fileContents.push({
          name: contentData.name || f.name,
          mimeType: contentData.mimeType || f.mimeType,
          content: contentData.content || "",
        });
      } catch (err) {
        const msg =
          err && typeof err === "object" && "message" in err
            ? err.message
            : String(err);

        fileContents.push({
          name: f.name || `File ID: ${f.driveFileId}`,
          mimeType: f.mimeType || "error",
          content: `Error reading file: ${msg}. Content not included.`,
        });
      }
    }

    // Build combined prompt exactly like Apps Script
    let combinedPrompt = `${finalSystemPrompt}\n\n***DOCUMENTS CONTENT***\n\n`;

    fileContents.forEach((file, index) => {
      combinedPrompt += `\n--- START DOCUMENT ${index + 1} (${file.name} - ${file.mimeType}) ---\n`;
      combinedPrompt += file.content || "";
      combinedPrompt += `\n--- END DOCUMENT ${index + 1} ---\n`;
    });

    combinedPrompt +=
      `\n***USER REQUEST***\n\n` +
      `${userPrompt.trim()}\n\n` +
      `***INSTRUCTIONS***\n\n` +
      `Please provide a comprehensive and accurate response based on the document content above. ` +
      `If the information needed to answer the question is not available in the documents, please state that clearly.\n\n` +
      `***AI RESPONSE***\n\n`;

    // Save user message
    await prisma.message.create({
      data: {
        chatId: chat.id,
        sender: "user",
        text: userPrompt.trim(),
        timestamp: BigInt(Date.now()),
        userId,
      },
    });

    // ✅ Post user message to Slack
    if (chat.slackChannelId && accessToken) {
      try {
        const { postMessageToSlack } = await import("../services/slackChannelManager.js");

        await postMessageToSlack(
          chat.slackChannelId,
          `👤 *You*\n${userPrompt.trim()}`,
          accessToken
        );
      } catch (error) {
        console.error("Error posting user message to Slack:", error);
      }
    }


    // Call Gemini
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

    // ✅ Post to Slack if channel exists
    if (chat.slackChannelId && req.user.slackAccessToken) {
      try {
        const { postMessageToSlack } = await import("../services/slackChannelManager.js");

        const slackTs = await postMessageToSlack(
          chat.slackChannelId,
          `🤖 *AI Assistant*\n${aiResponse}`,
          req.user.slackAccessToken
        );

        // Update message with Slack timestamp
        await prisma.message.update({
          where: { id: aiMessage.id },
          data: { slackTs, syncedToSlack: true },
        });
      } catch (error) {
        console.error("Error posting to Slack:", error);
        // Continue without Slack sync
      }
    }

    res.json({ aiResponse });
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e ? e.message : String(e);
    res.status(500).json({ error: message || "prompt error" });
  }
});
