// services/googleTokenService.js
import { prisma } from "../db/prisma.js";

async function safeFetch(...args) {
  if (typeof fetch !== "undefined") return fetch(...args);
  const mod = await import("node-fetch");
  return mod.default(...args);
}

/**
 * Slack events happen WITHOUT the user's web session.
 * So we must refresh the Google access token server-side using the stored refreshToken.
 *
 * Uses fields that already exist in your schema:
 * - User.refreshToken
 * - User.accessToken
 */
export async function getFreshGoogleAccessTokenForUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      refreshToken: true,
      accessToken: true,
    },
  });

  if (!user?.refreshToken) {
    throw new Error(
      "No Google refreshToken stored for this user. User must re-connect Google with offline access."
    );
  }

  // Refresh access token every time (simple + reliable, no schema changes needed).
  const res = await safeFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: user.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();

  if (!res.ok || !data?.access_token) {
    throw new Error(
      `Failed to refresh Google access token: ${data?.error || "unknown_error"} ${
        data?.error_description ? `(${data.error_description})` : ""
      }`
    );
  }

  // Persist the latest access token (useful for web requests too)
  await prisma.user.update({
    where: { id: userId },
    data: { accessToken: data.access_token },
  });

  return data.access_token;
}
