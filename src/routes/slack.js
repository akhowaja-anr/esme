// routes/slack.js
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
import { getFreshGoogleAccessTokenForUser } from "../services/googleTokenService.js";

export const slackRouter = express.Router();

/**
 * fetch() fallback (Node <18)
 */
async function safeFetch(...args) {
  if (typeof fetch !== "undefined") return fetch(...args);
  const mod = await import("node-fetch");
  return mod.default(...args);
}

/**
 * Get Slack Client ID for OAuth
 */
slackRouter.get("/client-id", (req, res) => {
  res.json({ clientId: process.env.SLACK_CLIENT_ID });
});

/**
 * Slack signing secret verification middleware
 * Requires req.rawBody to exist (configured in server.js bodyParser verify hooks)
 */
function verifySlackRequest(req, res, next) {
  try {
    const slackSignature = req.headers["x-slack-signature"];
    const timestampHeader = req.headers["x-slack-request-timestamp"];
    const signingSecret = process.env.SLACK_SIGNING_SECRET;

    if (!slackSignature || !timestampHeader) {
      return res.status(400).send("Missing Slack headers");
    }
    if (!signingSecret) {
      return res.status(500).send("Missing SLACK_SIGNING_SECRET");
    }

    const timestamp = Number(timestampHeader);

    // Prevent replay attacks
    const currentTime = Math.floor(Date.now() / 1000);
    if (Number.isNaN(timestamp) || Math.abs(currentTime - timestamp) > 60 * 5) {
      return res.status(400).send("Request too old");
    }

    // rawBody MUST exist
    const rawBody = req.rawBody;
    if (!rawBody) {
      return res.status(400).send("Missing rawBody (check body parser verify)");
    }

    const sigBasestring = `v0:${timestamp}:${rawBody}`;
    const mySignature =
      "v0=" +
      crypto
        .createHmac("sha256", signingSecret)
        .update(sigBasestring)
        .digest("hex");

    // timingSafeEqual throws if buffer lengths differ
    const a = Buffer.from(mySignature, "utf8");
    const b = Buffer.from(slackSignature, "utf8");
    if (a.length !== b.length) return res.status(400).send("Invalid signature");

    if (crypto.timingSafeEqual(a, b)) {
      return next();
    }

    return res.status(400).send("Invalid signature");
  } catch (e) {
    console.error("verifySlackRequest error:", e);
    return res.status(400).send("Invalid signature");
  }
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
    console.log("👤 Slack user ID:", result.authed_user?.id);

    const botToken = result.access_token; // BOT token
    const slackUserId = result.authed_user.id;
    const slackTeamId = result.team.id;

    // Fetch user email using bot token
    const botClient = new WebClient(botToken);
    const userInfo = await botClient.users.info({ user: slackUserId });
    const email = userInfo.user.profile.email;

    await prisma.user.upsert({
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

    // Welcome DM
    await sendSlackMessage(
      botClient,
      slackUserId,
      "🎉 *Connected to e-SME!*\n\n" +
        "Your e-SME chats will appear as private Slack channels.\n\n" +
        "*How it works:*\n" +
        "• Start chatting in the web app — Slack channels auto-create\n" +
        "• Message in Slack or web app — stays in sync\n\n" +
        "*Commands:*\n" +
        "• `/esme-chats` - View your chats\n" +
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
      await safeFetch(response_url, {
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
        const type = (text || "").trim().toLowerCase() || "personal";

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
          await safeFetch(response_url, {
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
          await safeFetch(response_url, {
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
        await safeFetch(response_url, {
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

    try {
      await safeFetch(req.body.response_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocks: buildErrorBlock(`Error: ${message}`),
          response_type: "ephemeral",
        }),
      });
    } catch (err) {
      console.error("Failed to post slash command error to Slack:", err);
    }
  }
});

/**
 * Events API handler
 * - Accepts both private channels (group) and public channels (channel)
 * - Saves Slack message to DB (so web app sees it)
 * - Generates AI response using Drive content (requires server-side Google refresh token)
 * - Replies in a thread to keep Slack tidy
 */
slackRouter.post(
  "/events",
  (req, res, next) => {
    // Handle Slack URL verification challenge
    if (req.body?.type === "url_verification") {
      console.log("Received Slack challenge");
      return res.json({ challenge: req.body.challenge });
    }
    next();
  },
  verifySlackRequest,
  async (req, res) => {
    const { event } = req.body;

    // Acknowledge event immediately
    res.status(200).send();

    // Only handle human messages in channels/groups
    // Ignore:
    // - bot messages (event.bot_id)
    // - thread replies (event.thread_ts) [optional: you can allow these later]
    // - message subtypes (edited, etc.)
    if (
      !event ||
      event.type !== "message" ||
      event.subtype ||
      event.bot_id ||
      !event.text ||
      event.thread_ts ||
      !(
        event.channel_type === "group" ||
        event.channel_type === "channel"
      )
    ) {
      return;
    }

    try {
      console.log("📩 Slack message:", {
        channel: event.channel,
        user: event.user,
        ts: event.ts,
        text: event.text?.slice(0, 120),
      });

      // Find chat by Slack channel ID
      const chat = await prisma.chat.findUnique({
        where: { slackChannelId: event.channel },
        include: {
          files: true,
          owner: true,
        },
      });

      if (!chat) {
        console.log("⚠️ No chat found for Slack channel:", event.channel);
        return;
      }

      // Find app user who sent message (must have connected Slack)
      const senderUser = await prisma.user.findUnique({
        where: { slackUserId: event.user },
      });

      if (!senderUser) {
        console.log("⚠️ Slack user not mapped to app user:", event.user);
        // Optionally: post an ephemeral message telling them to connect
        return;
      }

      // Prevent duplicates
      const existing = await prisma.message.findFirst({
        where: { slackTs: event.ts },
      });
      if (existing) {
        console.log("ℹ️ Message already synced (duplicate Slack event)");
        return;
      }

      // Save Slack user message to DB (this is what makes it appear in web app)
      await prisma.message.create({
        data: {
          chatId: chat.id,
          sender: "user",
          text: event.text,
          timestamp: BigInt(Date.now()),
          userId: senderUser.id,
          slackTs: event.ts,
          syncedToSlack: true,
        },
      });

      // Need a fresh Google access token SERVER-SIDE (Slack events have no session)
      const driveAccessToken = await getFreshGoogleAccessTokenForUser(chat.ownerId);

      // Read file contents
      const fileContents = [];
      for (const f of chat.files) {
        try {
          const contentData = await getDriveFileContent({
            accessToken: driveAccessToken,
            fileId: f.driveFileId,
            mimeType: f.mimeType,
          });
          fileContents.push(contentData);
        } catch (err) {
          console.error(`Error reading file ${f.driveFileId}:`, err);
        }
      }

      // Build AI prompt
      let combinedPrompt = `${
        chat.systemPrompt || "You are a helpful AI assistant."
      }\n\n***DOCUMENTS CONTENT***\n\n`;

      fileContents.forEach((file, index) => {
        combinedPrompt += `\n--- START DOCUMENT ${index + 1} (${file.name}) ---\n`;
        combinedPrompt += file.content || "";
        combinedPrompt += `\n--- END DOCUMENT ${index + 1} ---\n`;
      });

      combinedPrompt += `\n***USER REQUEST***\n\n${event.text}\n\n***AI RESPONSE***\n\n`;

      // Get AI response
      const aiResponse = await callGemini(combinedPrompt);

      // Save AI response to DB (web app will show it)
      const aiMessage = await prisma.message.create({
        data: {
          chatId: chat.id,
          sender: "ai",
          text: aiResponse,
          timestamp: BigInt(Date.now()),
        },
      });

      // Post AI response back to Slack (threaded)
      const slackClient = createSlackClient(chat.owner.slackAccessToken);
      const slackResult = await slackClient.chat.postMessage({
        channel: chat.slackChannelId,
        text: `🤖 *AI Assistant*\n${aiResponse}`,
        thread_ts: event.ts,
      });

      // Mark AI message as synced
      await prisma.message.update({
        where: { id: aiMessage.id },
        data: {
          slackTs: slackResult.ts,
          syncedToSlack: true,
        },
      });

      console.log("✅ Slack -> DB -> AI -> Slack sync complete");
    } catch (error) {
      console.error("❌ Error handling Slack event:", error);

      // Best-effort: post error in-thread so user sees something
      try {
        const channel = event?.channel;
        if (channel) {
          const chat = await prisma.chat.findUnique({
            where: { slackChannelId: channel },
            select: { slackChannelId: true, ownerId: true, owner: { select: { slackAccessToken: true } } },
          });

          const slackClient = chat?.owner?.slackAccessToken
            ? createSlackClient(chat.owner.slackAccessToken)
            : null;

          if (slackClient) {
            await slackClient.chat.postMessage({
              channel: channel,
              text:
                "❌ *Something went wrong while answering from documents.*\n" +
                "Most common cause: Google refresh token not stored / expired.\n" +
                "Please reconnect Google + Slack in the web app.",
              thread_ts: event?.ts,
            });
          }
        }
      } catch (e) {
        console.error("Failed to post Slack error message:", e);
      }
    }
  }
);

/**
 * Interactions handler (Block Kit buttons etc.)
 */
slackRouter.post("/interactions", verifySlackRequest, async (req, res) => {
  try {
    const payload = JSON.parse(req.body.payload);
    res.status(200).send();
    console.log("Interaction received:", payload.type);
  } catch (e) {
    console.error("Error parsing interaction payload:", e);
    res.status(200).send();
  }
});
