import express from "express";
import passport from "../config/passport.js";

export const authRouter = express.Router();

// Initiate Google OAuth
authRouter.get("/google", (req, res, next) => {
  console.log("🚀 Starting Google OAuth flow...");
  passport.authenticate("google")(req, res, next);
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
    failureMessage: true 
  }),
  (req, res) => {
    console.log("✅ Google OAuth successful!");
    console.log("User email:", req.user?.email);
    console.log("User ID:", req.user?.id);
    console.log("Session ID:", req.sessionID);
    console.log("Session data:", req.session);
    console.log("Is authenticated:", req.isAuthenticated());
    
    // Successful authentication
    console.log("➡️ Redirecting to /");
    res.redirect("/");
  }
);

// Logout
authRouter.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
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
      },
    });
  } else {
    res.json({ authenticated: false });
  }
});