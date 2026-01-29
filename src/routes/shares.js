import express from "express";
import { prisma } from "../db/prisma.js";
import { getDriveFileContent } from "../services/driveContent.js";

export const sharesRouter = express.Router();

/**
 * POST /shares
 * Share a chat with another user (with full file contents)
 * body: { chatId, sharedWithEmail, role }
 */
sharesRouter.post("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const accessToken = req.user.accessToken;
    const { chatId, sharedWithEmail, role } = req.body;

    if (!chatId || !sharedWithEmail) {
      return res.status(400).json({
        error: "chatId and sharedWithEmail are required",
      });
    }

    const shareRole = role === "EDITOR" ? "EDITOR" : "VIEWER";

    // Verify the chat exists and belongs to the user
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, ownerId: userId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            sender: true,
            text: true,
            timestamp: true,
            createdAt: true,
          },
        },
        files: {
          select: {
            driveFileId: true,
            name: true,
            mimeType: true,
          },
        },
      },
    });

    if (!chat) {
      return res.status(404).json({ error: "Chat not found or access denied" });
    }

    // Fetch full file contents
    const filesWithContent = [];
    for (const f of chat.files) {
      try {
        const contentData = await getDriveFileContent({
          accessToken,
          fileId: f.driveFileId,
          mimeType: f.mimeType,
        });

        filesWithContent.push({
          driveFileId: f.driveFileId,
          name: contentData.name || f.name,
          mimeType: contentData.mimeType || f.mimeType,
          content: contentData.content || "",
          note: contentData.note || "",
        });
      } catch (err) {
        const msg =
          err && typeof err === "object" && "message" in err
            ? err.message
            : String(err);

        filesWithContent.push({
          driveFileId: f.driveFileId,
          name: f.name || `File ID: ${f.driveFileId}`,
          mimeType: f.mimeType || "error",
          content: `Error reading file: ${msg}`,
          note: "Error",
        });
      }
    }

    // Create snapshot with full file contents
    const snapshotChatJson = {
      name: chat.name,
      systemPrompt: chat.systemPrompt,
      messages: chat.messages.map((m) => ({
        sender: m.sender,
        text: m.text,
        timestamp: m.timestamp?.toString(),
        createdAt: m.createdAt.toISOString(),
      })),
      files: filesWithContent, // Full content included
      sharedAt: new Date().toISOString(),
      originalChatId: chatId,
    };

    // Check if recipient user exists
    const sharedWithUser = await prisma.user.findUnique({
      where: { email: sharedWithEmail },
    });

    // Check if already shared with this email
    const existingShare = await prisma.chatShare.findFirst({
      where: {
        chatId,
        sharedWithEmail,
      },
    });

    if (existingShare) {
      // Update existing share with fresh snapshot
      const updated = await prisma.chatShare.update({
        where: { id: existingShare.id },
        data: {
          role: shareRole,
          snapshotChatJson,
          updatedAt: new Date(),
        },
        include: {
          sharedWithUser: {
            select: { id: true, email: true, name: true },
          },
        },
      });

      return res.json({
        share: updated,
        message: "Share updated successfully with latest content",
      });
    }

    // Create new share
    const share = await prisma.chatShare.create({
      data: {
        chatId,
        sharedWithEmail,
        sharedWithUserId: sharedWithUser?.id,
        role: shareRole,
        createdByUserId: userId,
        snapshotChatJson,
      },
      include: {
        sharedWithUser: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    // ✅ If chat has Slack channel, invite the shared user
    if (chat.slackChannelId && sharedWithUser?.slackUserId && req.user.slackAccessToken) {
  try {
    const { addUserToChannel, postMessageToSlack } = await import("../services/slackChannelManager.js");
    
    await addUserToChannel(
      chat.slackChannelId,
      sharedWithUser.slackUserId,
      req.user.slackAccessToken
    );

    await postMessageToSlack(
      chat.slackChannelId,
      `✨ *${sharedWithUser.name || sharedWithUser.email}* was added to this chat!`,
      req.user.slackAccessToken
    );

    console.log("✅ Added user to Slack channel");
  } catch (error) {
    console.error("Error adding user to Slack channel:", error);
  }
}


    res.status(201).json({ share });
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e ? e.message : String(e);
    res.status(500).json({ error: message || "share error" });
  }
});

/**
 * GET /shares/with-me
 * Get all chats shared with the current user
 */
sharesRouter.get("/with-me", async (req, res) => {
  try {
    const userEmail = req.user.email;

    const shares = await prisma.chatShare.findMany({
      where: { sharedWithEmail: userEmail },
      orderBy: { createdAt: "desc" },
      include: {
        chat: {
          select: {
            id: true,
            name: true,
            owner: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        createdByUser: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json({ shares });
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e ? e.message : String(e);
    res.status(500).json({ error: message || "fetch shares error" });
  }
});

/**
 * GET /shares/by-me
 * Get all shares created by the current user
 */
sharesRouter.get("/by-me", async (req, res) => {
  try {
    const userId = req.user.id;

    const shares = await prisma.chatShare.findMany({
      where: { createdByUserId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        chat: {
          select: { id: true, name: true },
        },
        sharedWithUser: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json({ shares });
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e ? e.message : String(e);
    res.status(500).json({ error: message || "fetch shares error" });
  }
});

/**
 * GET /shares/:id
 * Get a specific shared chat with full content
 */
sharesRouter.get("/:id", async (req, res) => {
  try {
    const shareId = req.params.id;
    const userEmail = req.user.email;

    const share = await prisma.chatShare.findFirst({
      where: {
        id: shareId,
        sharedWithEmail: userEmail,
      },
      include: {
        chat: {
          select: {
            id: true,
            name: true,
            owner: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        createdByUser: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!share) {
      return res.status(404).json({ error: "Share not found or access denied" });
    }

    res.json({ share });
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e ? e.message : String(e);
    res.status(500).json({ error: message || "fetch share error" });
  }
});

/**
 * DELETE /shares/:id
 * Revoke a share
 */
sharesRouter.delete("/:id", async (req, res) => {
  try {
    const shareId = req.params.id;
    const userId = req.user.id;

    // Only creator can delete
    const share = await prisma.chatShare.findFirst({
      where: {
        id: shareId,
        createdByUserId: userId,
      },
    });

    if (!share) {
      return res.status(404).json({
        error: "Share not found or you don't have permission to revoke it",
      });
    }

    await prisma.chatShare.delete({ where: { id: shareId } });

    res.json({ ok: true, message: "Share revoked successfully" });
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e ? e.message : String(e);
    res.status(500).json({ error: message || "delete share error" });
  }
});

/**
 * POST /shares/:id/messages
 * Add a message to a shared chat (recipient can interact with AI)
 * body: { userPrompt }
 */
sharesRouter.post("/:id/messages", async (req, res) => {
  try {
    const shareId = req.params.id;
    const userEmail = req.user.email;
    const userId = req.user.id;
    const { userPrompt } = req.body;

    if (!userPrompt || typeof userPrompt !== "string" || !userPrompt.trim()) {
      return res.status(400).json({ error: "userPrompt is required" });
    }

    // Get the share
    const share = await prisma.chatShare.findFirst({
      where: {
        id: shareId,
        sharedWithEmail: userEmail,
      },
    });

    if (!share) {
      return res.status(404).json({ error: "Share not found or access denied" });
    }

    const snapshot = share.snapshotChatJson;
    const systemPrompt = snapshot.systemPrompt || "You are a helpful AI assistant.";
    const filesWithContent = snapshot.files || [];

    // Build combined prompt with embedded file contents
    let combinedPrompt = `${systemPrompt}\n\n***DOCUMENTS CONTENT***\n\n`;

    filesWithContent.forEach((file, index) => {
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

    // Call Gemini
    const { callGemini } = await import("../services/gemini.js");
    const aiResponse = await callGemini(combinedPrompt);

    // Update snapshot with new messages
    const updatedMessages = [
      ...(snapshot.messages || []),
      {
        sender: "user",
        text: userPrompt.trim(),
        timestamp: Date.now().toString(),
        createdAt: new Date().toISOString(),
        sharedChatUser: userEmail,
      },
      {
        sender: "ai",
        text: aiResponse,
        timestamp: Date.now().toString(),
        createdAt: new Date().toISOString(),
      },
    ];

    const updatedSnapshot = {
      ...snapshot,
      messages: updatedMessages,
    };

    // Update the share with new messages
    await prisma.chatShare.update({
      where: { id: shareId },
      data: {
        snapshotChatJson: updatedSnapshot,
        updatedAt: new Date(),
      },
    });

    res.json({ aiResponse, updatedMessages });
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e ? e.message : String(e);
    res.status(500).json({ error: message || "message error" });
  }
});