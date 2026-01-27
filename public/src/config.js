// Automatically use the correct URL based on environment
const API_BASE_URL = 
  window.location.hostname === "localhost" 
    ? "http://localhost:8080" 
    : window.location.origin;

export const CONFIG = {
  API_BASE_URL,
  TOKEN_STORAGE_KEY: "esme_google_access_token",
  THEME_STORAGE_KEY: "theme",
  FALLBACK_DEFAULT_PROMPT:
    "You are a helpful AI assistant that analyzes documents and answers questions based on their content.",
};