import { CONFIG } from "./config.js";

export const state = {
  // core
  currentChatId: null,
  currentShareId: null,  // ✅ ADD THIS
  firstUserMessage: "",
  chatHistory: [],
  allFiles: [],
  selectedFiles: [],

  // UI toggles
  filesVisible: false,
  filesLocked: false,
  systemPromptVisible: false,

  // system prompt
  defaultSystemPrompt: CONFIG.FALLBACK_DEFAULT_PROMPT,
  customSystemPrompt: CONFIG.FALLBACK_DEFAULT_PROMPT,

  // shared chats
  isSharedChat: false,

  // auth
  getToken() {
    return localStorage.getItem(CONFIG.TOKEN_STORAGE_KEY) || "";
  },
  setToken(token) {
    if (!token) localStorage.removeItem(CONFIG.TOKEN_STORAGE_KEY);
    else localStorage.setItem(CONFIG.TOKEN_STORAGE_KEY, token);
  },
};