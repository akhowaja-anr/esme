import express from "express";
import passport from "../config/passport.js";

export const authRouter = express.Router();

/**
 * IMPORTANT:
 * To reliably receive a Google refresh token, you must request:
 * - access_type=offline
 * - prompt=consent
 *
 * Even if you set these in the Strategy config, it is safest to pass them
 * explicitly in the authenticate() call.
 */

const GOOGLE_SCOPES = [
  "profile",
  "email",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/presentations.readonly",
];

// Initiate Google OAuth
authRouter.get("/google", (req, res, next) => {
  console.log("🚀 Starting Google OAuth flow...");
  // This forces Google to return refresh_token (when user grants consent).
  passport.authenticate("google", {
    scope: GOOGLE_SCOPES,
    accessType: "offline",
    prompt: "consent",
    // includeGrantedScopes: true, // optional (helps in incremental auth)
  })(req, res, next);
});

// Google OAuth callback
authRouter.get(
  "/google/callback",
  (req, res, next) => {
    console.log("📥 Received callback from Google");
    console.log("Query params:", req.query);
    next();
  },
  passport.authenticate("google", {
    failureRedirect: "/login.html",
    failureMessage: true,
    // session: true, // default is true with passport sessions enabled
  }),
  (req, res) => {
    console.log("✅ Google OAuth successful!");
    console.log("User email:", req.user?.email);
    console.log("User ID:", req.user?.id);
    console.log("Has accessToken:", !!req.user?.accessToken);
    console.log("Has refreshToken:", !!req.user?.refreshToken);
    console.log("Session ID:", req.sessionID);
    console.log("Is authenticated:", req.isAuthenticated());

    /**
     * Where to redirect after login:
     * - If backend serves frontend: keep "/"
     * - If frontend is separate (SPA), redirect to FRONTEND_URL
     */
    const redirectUrl = process.env.FRONTEND_URL || "/";
    console.log("➡️ Redirecting to:", redirectUrl);

    res.redirect(redirectUrl);
  }
);

// Logout
authRouter.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error("❌ Logout error:", err);
      return res.status(500).json({ error: "Logout failed" });
    }

    req.session.destroy(() => {
      res.redirect("/login.html");
    });
  });
});

// Check auth status
authRouter.get("/status", (req, res) => {
  console.log("🔍 Auth status check:");
  console.log("Is authenticated:", req.isAuthenticated());
  console.log("User:", req.user?.email);
  console.log("Session ID:", req.sessionID);

  if (req.isAuthenticated()) {
    res.json({
      authenticated: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        hasGoogleAccessToken: !!req.user.accessToken,
        hasGoogleRefreshToken: !!req.user.refreshToken,
        hasSlackToken: !!req.user.slackAccessToken,
      },
    });
  } else {
    res.json({ authenticated: false });
  }
});
