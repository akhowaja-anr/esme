export function requireGoogleAccessToken(req, res, next) {
  // Now we get the token from session instead of header
  const token = req.user?.accessToken;

  if (!token) {
    return res.status(401).json({
      error: "Missing Google access token. Please re-authenticate.",
      needsAuth: true
    });
  }

  req.googleAccessToken = token;
  next();
}