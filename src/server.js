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
import { slackRouter } from "./routes/slack.js";  // ✅ ADD THIS

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PgStore = pgSession(session);
const pgPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});


// ✅ Global BigInt -> string JSON serialization
BigInt.prototype.toJSON = function () {
  return this.toString();
};

const app = express();
app.set("trust proxy", 1);

// ✅ Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:8080",
  credentials: true,
}));

// ✅ Raw body for Slack signature verification
app.use(
  bodyParser.urlencoded({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
    extended: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// ✅ Session configuration
app.use(
  session({
    store: new PgStore({
      pool: pgPool,
      tableName: "session",
      createTableIfMissing: true, // ✅ ADD THIS LINE
    }),
    secret: process.env.SESSION_SECRET || "your-secret-key-change-this",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  })
);

// ✅ Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// ✅ Health check (public)
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "esme-backend" });
});

// Get Slack client ID for OAuth
app.get("/slack/client-id", (req, res) => {
  res.json({ clientId: process.env.SLACK_CLIENT_ID });
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

// ✅ Auth routes (public)
app.use("/auth", authRouter);

// ✅ Slack routes (public)
app.use("/slack", slackRouter);  // ✅ ADD THIS

// ✅ Serve login page (public)
app.get("/login.html", express.static(path.join(__dirname, "..", "public")));

// ✅ Protected static files
app.use(express.static(path.join(__dirname, "..", "public")));

// ✅ Redirect to login if not authenticated
app.get("/", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// ✅ API: Get current user
app.get("/me", requireUser, async (req, res) => {
  res.json({ user: req.user });
});

// ✅ PROTECTED ROUTES
app.use("/chats", requireUser, chatsRouter);
app.use("/chats", requireUser, chatFilesRouter);
app.use("/shares", requireUser, sharesRouter);

// ✅ AI (requires Google token)
app.use("/ai", requireUser, requireGoogleAccessToken, aiRouter);

// ✅ Drive routes (token required)
app.use("/drive", requireUser, requireGoogleAccessToken, driveRouter);

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
  console.log(`Slack OAuth URL: http://localhost:${port}/slack/oauth/callback`);
});