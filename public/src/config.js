export const CONFIG = {
  API_BASE_URL: "http://localhost:8080",
  // If your backend currently uses dev auth only (no tokens), leave as null.
  // If you want to send a Google OAuth access token for Drive reads, set it in UI with the 🔑 Token button.
  TOKEN_STORAGE_KEY: "esme_google_access_token",
  THEME_STORAGE_KEY: "theme",
  FALLBACK_DEFAULT_PROMPT:
    "You are a helpful AI assistant that analyzes documents and answers questions based on their content.",
};
