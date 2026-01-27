import { prisma } from "../db/prisma.js";

export async function requireUser(req, res, next) {
  try {
    // Check if user is authenticated via session (passport)
    if (!req.user) {
      return res.status(401).json({ 
        error: "Unauthorized. Please login.",
        needsAuth: true 
      });
    }

    // User is already attached by passport, just continue
    next();
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e ? e.message : String(e);
    res.status(500).json({ error: message || "auth error" });
  }
}

// Middleware to check if user is authenticated (for frontend routes)
export function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login.html");
}