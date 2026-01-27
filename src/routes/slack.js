import express from "express";
import crypto from "crypto";
import { WebClient } from "@slack/web-api";
import { prisma } from "../db/prisma.js";
import { createSlackClient, sendSlackMessage } from "../services/slackClient.js";
import {
  buildChatListBlocks,
  buildSharedChatListBlocks,
  buildChatMessagesBlocks,
  buildErrorBlock,
  buildSuccessBlock,
} from "../services/slackBlocks.js";
import { callGemini } from "../services/gemini.js";

export const slackRouter = express.Router();

// Slack signing secret verification middleware
function verifySlackRequest(req, res, next) {
  const slackSignature = req.headers["x-slack-signature"];
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!slackSignature || !timestamp) {
    return res.status(400).send("Missing Slack headers");
  }

  // Prevent replay attacks
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - timestamp) > 60 * 5) {
    return res.status(400).send("Request too old");
  }

  const sigBasestring = `v0:${timestamp}:${req.rawBody}`;
  const mySignature =
    "v0=" +
    crypto.createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");

  if (
    crypto.timingSafeEqual(
      Buffer.from(mySignature, "utf8"),
      Buffer.from(slackSignature, "utf8")
    )
  ) {
    return next();
  }

  return res.status(400).send("Invalid signature");
}

/**
 * OAuth callback - Connect Slack account
 */
slackRouter.get("/oauth/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  try {
    const client = new WebClient();
    const result = await client.oauth.v2.access({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: process.env.SLACK_REDIRECT_URI,
    });

    const slackUserId = result.authed_user.id;
    const slackTeamId = result.team.id;
    const slackAccessToken = result.authed_user.access_token;

    // Get user info from Slack
    const userClient = new WebClient(slackAccessToken);
    const userInfo = await userClient.users.info({ user: slackUserId });
    const email = userInfo.user.profile.email;

    // Find or create user
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        slackUserId,
        slackTeamId,
        slackAccessToken,
      },
      create: {
        email,
        name: userInfo.user.real_name || userInfo.user.name,
        slackUserId,
        slackTeamId,
        slackAccessToken,
      },
    });

    // Send welcome message
    await sendSlackMessage(
      userClient,
      slackUserId,
      "🎉 *Connected to e-SME!*\n\nYou can now:\n• `/esme-chats` - View your chats\n• `/esme-new` - Create a new chat\n• `/esme-chat <chat-id> <message>` - Send a message\n• `/esme-share <chat-id> <email>` - Share a chat"
    );

    res.send(
      '<html><body><h1>✅ Slack Connected!</h1><p>You can close this window and return to Slack.</p></body></html>'
    );
  } catch (error) {
    console.error("Slack OAuth error:", error);
    res.status(500).send("OAuth failed");
  }
});

/**
 * Slash Commands handler
 */
slackRouter.post("/commands", verifySlackRequest, async (req, res) => {
  const { command, text, user_id, response_url } = req.body;

  // Acknowledge immediately
  res.status(200).send();

  try {
    // Find user by Slack ID
    const user = await prisma.user.findUnique({
      where: { slackUserId: user_id },
    });

    if (!user) {
      await fetch(response_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "❌ You need to connect your e-SME account first. Visit the web app to get started!",
          response_type: "ephemeral",
        }),
      });
      return;
    }

    const client = createSlackClient(user.slackAccessToken);

    switch (command) {
      case "/esme-chats": {
        const type = text.trim().toLowerCase() || "personal";

        if (type === "shared") {
          // Get shared chats
          const shares = await prisma.chatShare.findMany({
            where: { sharedWithEmail: user.email },
            orderBy: { createdAt: "desc" },
            include: {
              createdByUser: {
                select: { email: true, name: true },
              },
            },
          });

          const blocks = buildSharedChatListBlocks(shares);
          await fetch(response_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blocks,
              response_type: "ephemeral",
            }),
          });
        } else {
          // Get personal chats
          const chats = await prisma.chat.findMany({
            where: { ownerId: user.id },
            orderBy: { updatedAt: "desc" },
            include: {
              _count: {
                select: { files: true, messages: true },
              },
            },
            take: 10,
          });

          const blocks = buildChatListBlocks(chats, "personal");
          await fetch(response_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blocks,
              response_type: "ephemeral",
            }),
          });
        }
        break;
      }

      case "/esme-new": {
        const chatName = text.trim() || "New Chat from Slack";

        const chat = await prisma.chat.create({
          data: {
            ownerId: user.id,
            name: chatName,
            scope: "PERSONAL",
          },
        });

        const blocks = buildSuccessBlock(
          `Chat created: *${chatName}*\nID: \`${chat.id}\`\n\nAdd files and chat in the web app, or use \`/esme-chat ${chat.id} <message>\` to send messages.`
        );

        await fetch(response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blocks,
            response_type: "ephemeral",
          }),
        });
        break;
      }

      case "/esme-chat": {
        const parts = text.trim().split(" ");
        if (parts.length < 2) {
          await fetch(response_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blocks: buildErrorBlock(
                "Usage: `/esme-chat <chat-id> <your message>`"
              ),
              response_type: "ephemeral",
            }),
          });
          return;
        }

        const chatId = parts[0];
        const message = parts.slice(1).join(" ");

        // Check if it's a personal chat or shared chat
        let chat = await prisma.chat.findFirst({
          where: { id: chatId, ownerId: user.id },
          include: {
            files: true,
          },
        });

        let isSharedChat = false;
        let share = null;

        if (!chat) {
          // Check if it's a share ID
          share = await prisma.chatShare.findFirst({
            where: {
              id: chatId,
              sharedWithEmail: user.email,
            },
          });

          if (share) {
            isSharedChat = true;
          } else {
            await fetch(response_url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                blocks: buildErrorBlock("Chat not found or you don't have access."),
                response_type: "ephemeral",
              }),
            });
            return;
          }
        }

        // Send to shared chat
        if (isSharedChat) {
          const snapshot = share.snapshotChatJson;
          const systemPrompt = snapshot.systemPrompt || "You are a helpful AI assistant.";
          const filesWithContent = snapshot.files || [];

          // Build prompt with file contents
          let combinedPrompt = `${systemPrompt}\n\n***DOCUMENTS CONTENT***\n\n`;

          filesWithContent.forEach((file, index) => {
            combinedPrompt += `\n--- START DOCUMENT ${index + 1} (${file.name}) ---\n`;
            combinedPrompt += file.content || "";
            combinedPrompt += `\n--- END DOCUMENT ${index + 1} ---\n`;
          });

          combinedPrompt +=
            `\n***USER REQUEST***\n\n${message}\n\n` +
            `***INSTRUCTIONS***\n\nProvide a response based on the documents.\n\n` +
            `***AI RESPONSE***\n\n`;

          const aiResponse = await callGemini(combinedPrompt);

          // Update snapshot
          const updatedMessages = [
            ...(snapshot.messages || []),
            {
              sender: "user",
              text: message,
              createdAt: new Date().toISOString(),
              source: "slack",
            },
            {
              sender: "ai",
              text: aiResponse,
              createdAt: new Date().toISOString(),
            },
          ];

          await prisma.chatShare.update({
            where: { id: share.id },
            data: {
              snapshotChatJson: {
                ...snapshot,
                messages: updatedMessages,
              },
            },
          });

          await fetch(response_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `*Your message:*\n${message}`,
                  },
                },
                {
                  type: "divider",
                },
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `*AI Response:*\n${aiResponse}`,
                  },
                },
              ],
              response_type: "ephemeral",
            }),
          });
        } else {
          // Send to personal chat
          if (!chat.files || chat.files.length === 0) {
            await fetch(response_url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                blocks: buildErrorBlock(
                  "This chat has no files attached. Add files in the web app first."
                ),
                response_type: "ephemeral",
              }),
            });
            return;
          }

          // This would require Google Drive access - show message
          await fetch(response_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blocks: buildErrorBlock(
                "Sending messages to personal chats from Slack requires the web app (needs Drive access). Use the web interface or share the chat first."
              ),
              response_type: "ephemeral",
            }),
          });
        }
        break;
      }

      case "/esme-share": {
        const parts = text.trim().split(" ");
        if (parts.length !== 2) {
          await fetch(response_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blocks: buildErrorBlock(
                "Usage: `/esme-share <chat-id> <email@example.com>`"
              ),
              response_type: "ephemeral",
            }),
          });
          return;
        }

        const chatId = parts[0];
        const email = parts[1];

        await fetch(response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blocks: buildErrorBlock(
              "Sharing chats from Slack requires the web app (needs to fetch file contents). Please use the web interface to share."
            ),
            response_type: "ephemeral",
          }),
        });
        break;
      }

      default:
        await fetch(response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: "Unknown command",
            response_type: "ephemeral",
          }),
        });
    }
  } catch (error) {
    console.error("Slack command error:", error);
    await fetch(response_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: buildErrorBlock(`Error: ${error.message}`),
        response_type: "ephemeral",
      }),
    });
  }
});

/**
 * Events API handler
 */
slackRouter.post("/events", (req, res, next) => {
  // Handle Slack URL verification challenge immediately (no signature verification needed)
  if (req.body?.type === "url_verification") {
    console.log("Received Slack challenge, responding with:", req.body.challenge);
    return res.json({ challenge: req.body.challenge });
  }
  
  // For other events, proceed with signature verification
  next();
}, verifySlackRequest, async (req, res) => {
  const { event } = req.body;

  // Acknowledge event immediately
  res.status(200).send();

  // Handle DM events asynchronously
  if (event?.type === "message" && event.channel_type === "im" && !event.bot_id) {
    try {
      const user = await prisma.user.findUnique({
        where: { slackUserId: event.user },
      });

      if (!user) return;

      const client = createSlackClient(user.slackAccessToken);

      await sendSlackMessage(
        client,
        event.channel,
        "💡 To chat with e-SME, use slash commands:\n• `/esme-chats` - View your chats\n• `/esme-chat <chat-id> <message>` - Send a message"
      );
    } catch (error) {
      console.error("DM event error:", error);
    }
  }
});

/**
 * Interactions handler (button clicks, etc.)
 */
slackRouter.post("/interactions", verifySlackRequest, async (req, res) => {
  const payload = JSON.parse(req.body.payload);

  res.status(200).send();

  // Handle button interactions
  if (payload.type === "block_actions") {
    const action = payload.actions[0];

    // Handle view shared chat button
    if (action.action_id === "view_shared_chat") {
      const shareId = action.value;

      try {
        const user = await prisma.user.findUnique({
          where: { slackUserId: payload.user.id },
        });

        if (!user) return;

        const share = await prisma.chatShare.findFirst({
          where: {
            id: shareId,
            sharedWithEmail: user.email,
          },
          include: {
            createdByUser: true,
          },
        });

        if (!share) return;

        const snapshot = share.snapshotChatJson;
        const messages = snapshot.messages || [];
        const blocks = buildChatMessagesBlocks(
          { name: snapshot.name },
          messages
        );

        const client = createSlackClient(user.slackAccessToken);
        await sendSlackMessage(
          client,
          payload.user.id,
          `Shared chat: ${snapshot.name}`,
          blocks
        );
      } catch (error) {
        console.error("View shared chat error:", error);
      }
    }
  }
});