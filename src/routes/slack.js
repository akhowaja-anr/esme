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

slackRouter.get("/oauth/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  try {
    const client = new WebClient();
    
    // Get BOTH bot and user tokens
    const result = await client.oauth.v2.access({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: process.env.SLACK_REDIRECT_URI,
    });

    console.log("======================================");
    console.log("📦 OAuth Result:", JSON.stringify(result, null, 2));
    console.log("======================================");

    // ✅ USE BOT TOKEN, not user token!
    const botToken = result.access_token; // This is the bot token with correct scopes
    const slackUserId = result.authed_user.id;
    const slackTeamId = result.team.id;

    console.log("🤖 Bot token scopes:", result.scope);
    console.log("👤 User token scopes:", result.authed_user?.scope);

    // Get user info using BOT token
    const botClient = new WebClient(botToken);
    const userInfo = await botClient.users.info({ user: slackUserId });
    const email = userInfo.user.profile.email;

    // Save user with BOT token
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        slackUserId,
        slackTeamId,
        slackAccessToken: botToken, // ✅ Save BOT token, not user token
      },
      create: {
        email,
        name: userInfo.user.real_name || userInfo.user.name,
        slackUserId,
        slackTeamId,
        slackAccessToken: botToken, // ✅ Save BOT token
      },
    });

    console.log("✅ Saved user with BOT token");

    // Send welcome DM using bot token
    await sendSlackMessage(
      botClient,
      slackUserId,
      "🎉 *Connected to e-SME!*\n\n" +
      "Your e-SME chats will appear as private Slack channels.\n\n" +
      "*How it works:*\n" +
      "• Create chats in the web app\n" +
      "• They automatically appear as Slack channels\n" +
      "• Message in Slack or web app - stays in sync!\n" +
      "• Share chats - colleagues get added to the channel\n\n" +
      "*Commands:*\n" +
      "• `/esme-chats` - View all your chats\n" +
      "• `/esme-chats shared` - View shared chats\n\n" +
      `🌐 Web app: ${process.env.FRONTEND_URL}`
    );

    res.send(
      '<html><body><h1>✅ Slack Connected!</h1><p>You can close this window and return to the app.</p><script>setTimeout(() => window.close(), 2000);</script></body></html>'
    );
  } catch (error) {
    console.error("Slack OAuth error:", error);
    res.status(500).send(`OAuth failed: ${error.message}`);
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

      case "/esme-chat": {
        const parts = text.trim().split(" ");
        if (parts.length < 2) {
          await fetch(response_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blocks: buildErrorBlock(
                "Usage: `/esme-chat <share-id> <your message>`\n\n" +
                "💡 Get the Share ID from `/esme-chats shared`\n" +
                "Note: You can only message shared chats, not personal chats (they require Drive access)."
              ),
              response_type: "ephemeral",
            }),
          });
          return;
        }

        const shareId = parts[0];
        const message = parts.slice(1).join(" ");

        // Find the shared chat
        const share = await prisma.chatShare.findFirst({
          where: {
            id: shareId,
            sharedWithEmail: user.email,
          },
        });

        if (!share) {
          await fetch(response_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blocks: buildErrorBlock(
                "Share not found or you don't have access.\n\n" +
                "Make sure you're using a **Share ID** (not a Chat ID).\n" +
                "Get Share IDs from: `/esme-chats shared`"
              ),
              response_type: "ephemeral",
            }),
          });
          return;
        }

        // Process shared chat message
        const snapshot = share.snapshotChatJson;
        const systemPrompt = snapshot.systemPrompt || "You are a helpful AI assistant.";
        const filesWithContent = snapshot.files || [];

        if (!filesWithContent.length) {
          await fetch(response_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blocks: buildErrorBlock("This shared chat has no documents attached."),
              response_type: "ephemeral",
            }),
          });
          return;
        }

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

        try {
          const aiResponse = await callGemini(combinedPrompt);

          // Update snapshot with new messages
          const updatedMessages = [
            ...(snapshot.messages || []),
            {
              sender: "user",
              text: message,
              createdAt: new Date().toISOString(),
              source: "slack",
              userEmail: user.email,
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

          // Send response to Slack
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
                    text: `*AI Response:*\n${aiResponse.substring(0, 2900)}${aiResponse.length > 2900 ? '...\n\n_View full response in the web app_' : ''}`,
                  },
                },
                {
                  type: "context",
                  elements: [
                    {
                      type: "mrkdwn",
                      text: `💬 Chat: ${snapshot.name || 'Shared Chat'}`,
                    },
                  ],
                },
              ],
              response_type: "ephemeral",
            }),
          });
        } catch (error) {
          console.error("AI error:", error);
          await fetch(response_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blocks: buildErrorBlock(`AI Error: ${error.message}`),
              response_type: "ephemeral",
            }),
          });
        }
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
  // Handle Slack URL verification challenge
  if (req.body?.type === "url_verification") {
    console.log("Received Slack challenge, responding with:", req.body.challenge);
    return res.json({ challenge: req.body.challenge });
  }

  next();
}, verifySlackRequest, async (req, res) => {
  const { event } = req.body;

  // Acknowledge event immediately
  res.status(200).send();

  // Handle channel messages
  if (event?.type === "message" && !event.bot_id && event.channel_type === "group") {
    try {
      // Find chat by Slack channel ID
      const chat = await prisma.chat.findUnique({
        where: { slackChannelId: event.channel },
        include: {
          files: true,
          owner: true,
        },
      });

      if (!chat) return;

      // Find user who sent message
      const user = await prisma.user.findUnique({
        where: { slackUserId: event.user },
      });

      if (!user) return;

      // Check if message already synced (prevent duplicates)
      const existing = await prisma.message.findFirst({
        where: { slackTs: event.ts },
      });

      if (existing) return;

      // Save message to database
      await prisma.message.create({
        data: {
          chatId: chat.id,
          sender: "user",
          text: event.text,
          timestamp: BigInt(Date.now()),
          userId: user.id,
          slackTs: event.ts,
          syncedToSlack: true,
        },
      });

      // Get AI response
      const { callGemini } = await import("../services/gemini.js");
      const { getDriveFileContent } = await import("../services/driveContent.js");

      // Build prompt with file contents
      const fileContents = [];
      for (const f of chat.files) {
        try {
          const contentData = await getDriveFileContent({
            accessToken: chat.owner.accessToken,
            fileId: f.driveFileId,
            mimeType: f.mimeType,
          });
          fileContents.push(contentData);
        } catch (err) {
          console.error(`Error reading file ${f.driveFileId}:`, err);
        }
      }

      let combinedPrompt = `${chat.systemPrompt || "You are a helpful AI assistant."}\n\n***DOCUMENTS CONTENT***\n\n`;
      fileContents.forEach((file, index) => {
        combinedPrompt += `\n--- START DOCUMENT ${index + 1} (${file.name}) ---\n`;
        combinedPrompt += file.content || "";
        combinedPrompt += `\n--- END DOCUMENT ${index + 1} ---\n`;
      });
      combinedPrompt += `\n***USER REQUEST***\n\n${event.text}\n\n***AI RESPONSE***\n\n`;

      const aiResponse = await callGemini(combinedPrompt);

      // Save AI response to database
      const aiMessage = await prisma.message.create({
        data: {
          chatId: chat.id,
          sender: "ai",
          text: aiResponse,
          timestamp: BigInt(Date.now()),
          syncedToSlack: false, // Will be synced when posted
        },
      });

      // Post AI response to Slack
      const { postMessageToSlack } = await import("../services/slackChannelManager.js");

      const slackTs = await postMessageToSlack(
        chat.slackChannelId,
        `🤖 *AI Assistant*\n${aiResponse}`,
        chat.owner.slackAccessToken
      );

      // Update with Slack timestamp
      await prisma.message.update({
        where: { id: aiMessage.id },
        data: { slackTs, syncedToSlack: true },
      });

    } catch (error) {
      console.error("Channel message error:", error);
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