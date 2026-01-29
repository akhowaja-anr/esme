import express from "express";
import crypto from "crypto";
import { WebClient } from "@slack/web-api";
import { prisma } from "../db/prisma.js";
import { createSlackClient, sendSlackMessage } from "../services/slackClient.js";
import {
  buildChatListBlocks,
  buildSharedChatListBlocks,
  buildErrorBlock,
} from "../services/slackBlocks.js";
import { callGemini } from "../services/gemini.js";
import { getDriveFileContent } from "../services/driveContent.js";

export const slackRouter = express.Router();

/**
 * Get Slack Client ID for OAuth
 */
slackRouter.get("/client-id", (req, res) => {
  res.json({ clientId: process.env.SLACK_CLIENT_ID });
});


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

    console.log("🤖 Bot token scopes:", result.scope);
    console.log("👤 User ID:", result.authed_user.id);

    // ✅ USE BOT TOKEN
    const botToken = result.access_token;
    const slackUserId = result.authed_user.id;
    const slackTeamId = result.team.id;

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
        slackAccessToken: botToken,
      },
      create: {
        email,
        name: userInfo.user.real_name || userInfo.user.name,
        slackUserId,
        slackTeamId,
        slackAccessToken: botToken,
      },
    });

    console.log("✅ Saved user with BOT token:", email);

    // Send welcome DM
    await sendSlackMessage(
      botClient,
      slackUserId,
      "🎉 *Connected to e-SME!*\n\n" +
      "Your e-SME chats will appear as private Slack channels.\n\n" +
      "*How it works:*\n" +
      "• Open chats in the web app - they auto-create Slack channels\n" +
      "• Message in Slack or web app - stays in sync!\n" +
      "• Share chats - colleagues get added to the channel\n\n" +
      "*Commands:*\n" +
      "• `/esme-chats` - View all your chats\n" +
      "• `/esme-chats shared` - View shared chats\n\n" +
      `🌐 Web app: ${process.env.FRONTEND_URL}`
    );

    res.send(
      '<html><body><h1>✅ Slack Connected!</h1><p>You can close this window.</p><script>setTimeout(() => window.close(), 2000);</script></body></html>'
    );
  } catch (error) {
    console.error("Slack OAuth error:", error);
    res.status(500).send("OAuth failed");
  }
});

/**
 * Disconnect Slack
 */
slackRouter.post("/disconnect", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        slackAccessToken: null,
        slackUserId: null,
        slackTeamId: null,
      },
    });

    res.json({ success: true, message: "Slack disconnected" });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e ? e.message : String(e);
    await fetch(response_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: buildErrorBlock(`Error: ${message}`),
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
    console.log("Received Slack challenge");
    return res.json({ challenge: req.body.challenge });
  }
  
  next();
}, verifySlackRequest, async (req, res) => {
  const { event } = req.body;

  // Acknowledge event immediately
  res.status(200).send();

  // Handle channel messages (not DMs, not bot messages)
  if (event?.type === "message" && event.channel_type === "group" && !event.bot_id && !event.thread_ts) {
    try {
      console.log("📩 Received message in channel:", event.channel);
      
      // Find chat by Slack channel ID
      const chat = await prisma.chat.findUnique({
        where: { slackChannelId: event.channel },
        include: {
          files: true,
          owner: true,
        },
      });

      if (!chat) {
        console.log("⚠️ No chat found for channel:", event.channel);
        return;
      }

      console.log("Found chat:", chat.name);

      // Find user who sent message
      const user = await prisma.user.findUnique({
        where: { slackUserId: event.user },
      });

      if (!user) {
        console.log("⚠️ User not found:", event.user);
        return;
      }

      // Check if message already synced (prevent duplicates)
      const existing = await prisma.message.findFirst({
        where: { slackTs: event.ts },
      });

      if (existing) {
        console.log("ℹ️ Message already synced");
        return;
      }

      // Save user message to database
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

      console.log("✅ User message saved");

      // Get file contents
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

      // Build AI prompt
      let combinedPrompt = `${chat.systemPrompt || "You are a helpful AI assistant."}\n\n***DOCUMENTS CONTENT***\n\n`;
      
      fileContents.forEach((file, index) => {
        combinedPrompt += `\n--- START DOCUMENT ${index + 1} (${file.name}) ---\n`;
        combinedPrompt += file.content || "";
        combinedPrompt += `\n--- END DOCUMENT ${index + 1} ---\n`;
      });
      
      combinedPrompt += `\n***USER REQUEST***\n\n${event.text}\n\n***AI RESPONSE***\n\n`;

      // Get AI response
      const aiResponse = await callGemini(combinedPrompt);

      // Save AI response to database
      const aiMessage = await prisma.message.create({
        data: {
          chatId: chat.id,
          sender: "ai",
          text: aiResponse,
          timestamp: BigInt(Date.now()),
        },
      });

      console.log("✅ AI response generated");

      // Post AI response to Slack
      const client = createSlackClient(chat.owner.slackAccessToken);
      const slackResult = await client.chat.postMessage({
        channel: chat.slackChannelId,
        text: `🤖 *AI Assistant*\n${aiResponse}`,
      });

      // Update with Slack timestamp
      await prisma.message.update({
        where: { id: aiMessage.id },
        data: { 
          slackTs: slackResult.ts,
          syncedToSlack: true,
        },
      });

      console.log("✅ AI response posted to Slack");

    } catch (error) {
      console.error("❌ Error handling channel message:", error);
    }
  }
});

/**
 * Interactions handler
 */
slackRouter.post("/interactions", verifySlackRequest, async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  res.status(200).send();
  
  // Handle button interactions if needed in future
  console.log("Interaction received:", payload.type);
});