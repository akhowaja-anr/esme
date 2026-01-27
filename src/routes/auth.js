import express from "express";
import passport from "../config/passport.js";

export const authRouter = express.Router();

// Initiate Google OAuth
authRouter.get("/google", passport.authenticate("google"));

// Google OAuth callback
authRouter.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login.html" }),
  (req, res) => {
    // Successful authentication
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