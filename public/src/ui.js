import { state } from "./state.js";

export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

export function formatFileType(mimeType) {
  const types = {
    "application/vnd.google-apps.spreadsheet": "📊 Sheet",
    "application/vnd.google-apps.document": "📄 Doc",
    "application/vnd.google-apps.presentation": "📽️ Slides",
    "application/pdf": "📕 PDF",
    "text/plain": "📝 Text",
    "text/csv": "📊 CSV",
  };
  return types[mimeType] || "📎 File";
}

export function showLoading(message = "Loading...") {
  const overlay = document.createElement("div");
  overlay.className = "loading-overlay";
  overlay.id = "loadingOverlay";
  overlay.innerHTML = `
    <div class="loading-content">
      <div class="loading-spinner"></div>
      <div style="color: var(--color-text-primary); font-size: 16px;">${escapeHtml(
        message
      )}</div>
    </div>
  `;
  document.body.appendChild(overlay);
}

export function hideLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.remove();
}

export function appendMessage(sender, text, type = "") {
  const chatContainer = document.getElementById("chatContainer");

  const msg = document.createElement("div");
  msg.className = `message ${sender} ${type}`;

  if (sender === "ai" && window.marked) {
    msg.innerHTML = marked.parse(String(text || ""));
  } else {
    msg.textContent = text;
  }

  chatContainer.appendChild(msg);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  state.chatHistory.push({ sender, text, timestamp: Date.now() });
}

export function showTypingIndicator() {
  const chatContainer = document.getElementById("chatContainer");
  const indicator = document.createElement("div");
  indicator.className = "typing-indicator active";
  indicator.id = "typingIndicator";
  indicator.textContent = "AI is thinking...";
  chatContainer.appendChild(indicator);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

export function hideTypingIndicator() {
  const indicator = document.getElementById("typingIndicator");
  if (indicator) indicator.remove();
}

export function applyLockUI() {
  const lockBtn = document.getElementById("lockBtn");
  const lockBadge = document.getElementById("lockBadge");
  const fileSelector = document.getElementById("fileSelector");
  const listFilesBtn = document.getElementById("listFilesBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const clearFilesBtn = document.getElementById("clearFilesBtn");

  if (state.filesLocked || state.isSharedChat) {
    lockBtn.textContent = "🔒 Unlock Files";
    lockBtn.classList.add("locked");
    lockBadge.style.display = "inline-block";
    fileSelector.classList.add("locked");
    listFilesBtn.disabled = true;
    refreshBtn.disabled = true;
    clearFilesBtn.disabled = true;
    
    // Disable lock button for shared chats
    if (state.isSharedChat) {
      lockBtn.disabled = true;
      lockBtn.title = "File selection locked in shared chats";
    } else {
      lockBtn.disabled = false;
      lockBtn.title = "";
    }
  } else {
    lockBtn.textContent = "🔓 Lock Files";
    lockBtn.classList.remove("locked");
    lockBtn.disabled = false;
    lockBtn.title = "";
    lockBadge.style.display = "none";
    fileSelector.classList.remove("locked");
    listFilesBtn.disabled = false;
    refreshBtn.disabled = false;
    clearFilesBtn.disabled = false;
  }
}

export function toggleSystemPromptUI() {
  const togglePromptBtn = document.getElementById("togglePromptBtn");
  const systemPromptContainer = document.getElementById("systemPromptContainer");

  state.systemPromptVisible = !state.systemPromptVisible;

  if (state.systemPromptVisible) {
    systemPromptContainer.style.display = "block";
    togglePromptBtn.textContent = "▲ Hide";
  } else {
    systemPromptContainer.style.display = "none";
    togglePromptBtn.textContent = "▼ Show";
  }
}

export function setThemeFromStorage(key) {
  const themeToggle = document.getElementById("themeToggle");
  const savedTheme = localStorage.getItem(key);
  if (savedTheme === "light") {
    document.body.classList.add("light");
    themeToggle.textContent = "🌞";
  }
}

export function toggleTheme(key) {
  const themeToggle = document.getElementById("themeToggle");
  document.body.classList.toggle("light");
  const isLight = document.body.classList.contains("light");
  themeToggle.textContent = isLight ? "🌞" : "🌙";
  localStorage.setItem(key, isLight ? "light" : "dark");
}
