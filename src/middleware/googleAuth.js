export function requireGoogleAccessToken(req, res, next) {
  // Get token from user session (after OAuth login)
  const token = req.user?.accessToken;

  if (!token) {
    console.log("❌ No Google access token found");
    console.log("User:", req.user?.email);
    console.log("User has accessToken:", !!req.user?.accessToken);
    
    return res.status(401).json({
      error: "Missing Google access token. Please re-authenticate with Google.",
      needsAuth: true
    });
  }

  console.log("✅ Google access token found for:", req.user?.email);
  req.googleAccessToken = token;
  next();
}