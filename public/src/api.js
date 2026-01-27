import { CONFIG } from "./config.js";

async function apiFetch(path, options = {}) {
  const url = `${CONFIG.API_BASE_URL}${path}`;

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include'
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    if (payload?.needsAuth || res.status === 401) {
      window.location.href = "/login.html";
      return;
    }

    const msg =
      (payload && payload.error) ||
      (typeof payload === "string" ? payload : "") ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return payload;
}

export const api = {
  // Auth
  checkAuth() {
    return apiFetch("/auth/status", { method: "GET" });
  },

  logout() {
    return apiFetch("/auth/logout", { method: "GET" });
  },

  // user
  me() {
    return apiFetch("/me", { method: "GET" });
  },

  // chats
  listChats() {
    return apiFetch("/chats", { method: "GET" });
  },

  getChat(chatId) {
    return apiFetch(`/chats/${encodeURIComponent(chatId)}`, { method: "GET" });
  },

  createChat({ name, systemPrompt }) {
    return apiFetch("/chats", {
      method: "POST",
      body: JSON.stringify({ name, systemPrompt }),
    });
  },

  updateChat(chatId, patch) {
    return apiFetch(`/chats/${encodeURIComponent(chatId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  deleteChat(chatId) {
    return apiFetch(`/chats/${encodeURIComponent(chatId)}`, {
      method: "DELETE",
    });
  },

  // AI prompt
  aiPrompt({ chatId, userPrompt, systemPrompt }) {
    return apiFetch("/ai/prompt", {
      method: "POST",
      body: JSON.stringify({ chatId, userPrompt, systemPrompt }),
    });
  },

  // Drive
  listDriveFiles(limit = 100) {
    return apiFetch(`/drive/files?limit=${encodeURIComponent(limit)}`, {
      method: "GET",
    });
  },

  attachFileToChat(chatId, file) {
    return apiFetch(`/chats/${encodeURIComponent(chatId)}/files`, {
      method: "POST",
      body: JSON.stringify({
        driveFileId: file.id,
        name: file.name,
        mimeType: file.mimeType,
      }),
    });
  },

  detachFileFromChat(chatId, driveFileId) {
    return apiFetch(`/chats/${encodeURIComponent(chatId)}/files/${encodeURIComponent(driveFileId)}`, {
      method: "DELETE",
    });
  },

  // Shares
  shareChat({ chatId, sharedWithEmail, role }) {
    return apiFetch("/shares", {
      method: "POST",
      body: JSON.stringify({ chatId, sharedWithEmail, role }),
    });
  },

  getSharesWithMe() {
    return apiFetch("/shares/with-me", { method: "GET" });
  },

  getSharesByMe() {
    return apiFetch("/shares/by-me", { method: "GET" });
  },

  getShare(shareId) {
    return apiFetch(`/shares/${encodeURIComponent(shareId)}`, {
      method: "GET",
    });
  },

  revokeShare(shareId) {
    return apiFetch(`/shares/${encodeURIComponent(shareId)}`, {
      method: "DELETE",
    });
  },

  // Send message in shared chat
  sendSharedChatMessage({ shareId, userPrompt }) {
    return apiFetch(`/shares/${encodeURIComponent(shareId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ userPrompt }),
    });
  },

  getSlackClientId() {
    return apiFetch("/slack/client-id", { method: "GET" });
  },
};