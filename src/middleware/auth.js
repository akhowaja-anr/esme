import { prisma } from "../db/prisma.js";

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || null;

export async function requireUser(req, res, next) {
  try {
    console.log("🔐 requireUser middleware");
    console.log("Is authenticated:", req.isAuthenticated());
    console.log("Session ID:", req.sessionID);
    console.log("User:", req.user?.email);
    
    // Check if user is authenticated via session (passport)
    if (!req.user) {
      console.log("❌ No user in session");
      return res.status(401).json({ 
        error: "Unauthorized. Please login.",
        needsAuth: true 
      });
    }

    // Check email domain restriction
    if (ALLOWED_DOMAIN && req.user.email) {
      const emailDomain = req.user.email.split('@')[1];
      if (emailDomain !== ALLOWED_DOMAIN) {
        console.log(`❌ Email domain ${emailDomain} not allowed`);
        return res.status(403).json({
          error: `Access restricted to ${ALLOWED_DOMAIN} emails only.`,
        });
      }
    }

    console.log("✅ User authenticated");
    next();
  } catch (e) {
    const message =
      e && typeof e === "object" && "message" in e ? e.message : String(e);
    console.error("❌ Auth error:", message);
    res.status(500).json({ error: message || "auth error" });
  }
}

// Middleware to check if user is authenticated (for frontend routes)
export function isAuthenticated(req, res, next) {
  console.log("🔍 isAuthenticated middleware");
  console.log("Path:", req.path);
  console.log("Is authenticated:", req.isAuthenticated());
  console.log("Session ID:", req.sessionID);
  console.log("User:", req.user?.email || "No user");
  
  if (req.isAuthenticated()) {
    console.log("✅ User is authenticated, proceeding");
    return next();
  }
  
  console.log("❌ Not authenticated, redirecting to /login.html");
  res.redirect("/login.html");
}