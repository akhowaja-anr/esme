import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import pgSession from "connect-pg-simple";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

import { prisma } from "./db/prisma.js";
import passport from "./config/passport.js";
import { requireUser, isAuthenticated } from "./middleware/auth.js";
import { requireGoogleAccessToken } from "./middleware/googleAuth.js";

import { authRouter } from "./routes/auth.js";
import { chatsRouter } from "./routes/chats.js";
import { chatFilesRouter } from "./routes/chat-files.js";
import { aiRouter } from "./routes/ai.js";
import { driveRouter } from "./routes/drive.js";
import { sharesRouter } from "./routes/shares.js";
import { slackRouter } from "./routes/slack.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global BigInt -> string JSON serialization
BigInt.prototype.toJSON = function () {
  return this.toString();
};

const app = express();

// Trust proxy (for Render)
app.set("trust proxy", 1);

// CORS
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:8080",
    credentials: true,
  })
);

/**
 * IMPORTANT:
 * Slack signature verification needs the EXACT raw request body.
 * Slack sends:
 * - slash commands / interactions: application/x-www-form-urlencoded
 * - events: application/json
 *
 * So we must capture rawBody for BOTH.
 */

// Capture rawBody for URL-encoded payloads (Slack commands / interactions)
app.use(
  bodyParser.urlencoded({
    extended: true,
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

// Capture rawBody for JSON payloads (Slack events)
app.use(
  bodyParser.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

app.use(cookieParser());

// Create PostgreSQL session store
const PgStore = pgSession(session);
const pgPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// Session configuration
app.use(
  session({
    store: new PgStore({
      pool: pgPool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "your-secret-key-change-this",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: "lax",
    },
  })
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Health check (public)
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "esme-backend" });
});

app.get("/db/ping", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: "connected" });
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e ? e.message : String(e);
    res.status(500).json({ ok: false, error: message || "db error" });
  }
});

// Auth routes (public)
app.use("/auth", authRouter);

// Slack routes (public)
app.use("/slack", slackRouter);

// Serve login page (public)
app.get("/login.html", express.static(path.join(__dirname, "..", "public")));

// Protected static files
app.use(express.static(path.join(__dirname, "..", "public")));

// Redirect to login if not authenticated
app.get("/", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// API: Get current user
app.get("/me", requireUser, async (req, res) => {
  res.json({ user: req.user });
});

// Admin: Clear Slack tokens (for debugging)
app.get("/admin/clear-slack-tokens", requireUser, async (req, res) => {
  try {
    const result = await prisma.user.updateMany({
      where: {
        slackUserId: { not: null },
      },
      data: {
        slackAccessToken: null,
        slackUserId: null,
        slackTeamId: null,
      },
    });

    res.json({
      success: true,
      message: `Cleared Slack tokens for ${result.count} users`,
      count: result.count,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Create Slack channels for all chats
app.post("/admin/create-slack-channels", requireUser, async (req, res) => {
  try {
    if (!req.user.slackAccessToken) {
      return res.json({
        error: "Please connect Slack first",
        needsSlack: true,
      });
    }

    const { getOrCreateSlackChannel, syncMessagesToSlack } = await import(
      "./services/slackChannelManager.js"
    );

    // Get all user's chats without Slack channels
    const chats = await prisma.chat.findMany({
      where: {
        ownerId: req.user.id,
        slackChannelId: null,
      },
      include: {
        owner: true,
        files: true,
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    console.log(`Found ${chats.length} chats without Slack channels`);

    const results = [];
    for (const chat of chats) {
      try {
        console.log(`Creating channel for chat: ${chat.name}`);

        const channelId = await getOrCreateSlackChannel(chat, req.user.slackAccessToken);

        // Reload chat to get slackChannelId
        const updatedChat = await prisma.chat.findUnique({
          where: { id: chat.id },
          include: {
            owner: true,
            messages: {
              orderBy: { createdAt: "asc" },
            },
          },
        });

        // Sync messages
        if (updatedChat.messages.length > 0) {
          await syncMessagesToSlack(updatedChat, req.user.slackAccessToken);
        }

        results.push({
          chatId: chat.id,
          chatName: chat.name,
          channelId,
          messagesSynced: updatedChat.messages.length,
          success: true,
        });

        console.log(`✅ Created channel ${channelId} for chat ${chat.name}`);
      } catch (error) {
        console.error(`Error creating channel for chat ${chat.id}:`, error);
        results.push({
          chatId: chat.id,
          chatName: chat.name,
          error: error.message,
          success: false,
        });
      }
    }

    res.json({
      success: true,
      message: `Processed ${chats.length} chats`,
      results,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PROTECTED ROUTES
app.use("/chats", requireUser, chatsRouter);
app.use("/chats", requireUser, chatFilesRouter);
app.use("/shares", requireUser, sharesRouter);

// AI (requires Google token)
app.use("/ai", requireUser, requireGoogleAccessToken, aiRouter);

// Drive routes (token required)
app.use("/drive", requireUser, requireGoogleAccessToken, driveRouter);

const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => {
  console.log(`Backend running on http://localhost:${port}`);
  console.log(`Slack OAuth URL: http://localhost:${port}/slack/oauth/callback`);
});
