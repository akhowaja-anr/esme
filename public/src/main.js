import { CONFIG } from "./config.js";
import { state } from "./state.js";
import { api } from "./api.js";
import { showToast } from "./toasts.js";
import { showModal, closeModal, wireModalCloseHandlers } from "./modals.js";
import {
  appendMessage,
  showLoading,
  hideLoading,
  showTypingIndicator,
  hideTypingIndicator,
  applyLockUI,
  toggleSystemPromptUI,
  escapeHtml,
  formatFileType,
  setThemeFromStorage,
  toggleTheme,
} from "./ui.js";

function wireMarked() {
  if (window.marked) marked.setOptions({ gfm: true, breaks: true });
}

function setSystemPromptDefaults() {
  state.defaultSystemPrompt = CONFIG.FALLBACK_DEFAULT_PROMPT;
  state.customSystemPrompt = state.defaultSystemPrompt;
  document.getElementById("systemPromptTextarea").value = state.customSystemPrompt;
}

function updateSelectedFilesDisplay() {
  const selectedFilesSection = document.getElementById("selectedFilesSection");
  const selectedFilesList = document.getElementById("selectedFilesList");

  if (state.selectedFiles.length === 0) {
    selectedFilesSection.style.display = "none";
    return;
  }

  selectedFilesSection.style.display = "block";
  selectedFilesList.innerHTML = "";

  state.selectedFiles.forEach((file, index) => {
    const tag = document.createElement("div");
    tag.className = "selected-file-tag";

    if (state.filesLocked) {
      tag.innerHTML = `<span>${escapeHtml(file.name)}</span>`;
    } else {
      tag.innerHTML = `
        <span>${escapeHtml(file.name)}</span>
        <button class="remove-file-btn" data-index="${index}">✕</button>
      `;
    }
    selectedFilesList.appendChild(tag);
  });

  if (!state.filesLocked) {
    document.querySelectorAll(".remove-file-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const index = parseInt(e.target.dataset.index, 10);
        removeSelectedFile(index);
      });
    });
  }
}

function updateFileListUI(files = null) {
  const fileList = document.getElementById("fileList");
  const list = files || state.allFiles;

  if (!list || list.length === 0) {
    fileList.innerHTML =
      '<div style="padding:20px;text-align:center;color:var(--color-text-secondary)">No files found</div>';
    return;
  }

  fileList.innerHTML = "";
  list.forEach((file) => {
    const isSelected = state.selectedFiles.some((f) => f.id === file.id);

    const item = document.createElement("div");
    item.className = `file-item ${isSelected ? "selected" : ""}`;
    item.innerHTML = `
      <div class="file-info">
        <div class="file-name">${escapeHtml(file.name)}</div>
        <div class="file-meta">${formatFileType(file.mimeType)} • ${new Date(
          file.modifiedTime || Date.now()
        ).toLocaleDateString()}</div>
      </div>
      <input type="checkbox" class="file-checkbox" ${isSelected ? "checked" : ""} ${
        state.filesLocked ? "disabled" : ""
      }>
    `;

    if (!state.filesLocked) {
      item.onclick = () => toggleFileSelection(file);
    } else {
      item.style.cursor = "not-allowed";
      item.style.opacity = "0.6";
    }

    fileList.appendChild(item);
  });
}

function toggleFileSelection(file) {
  if (state.filesLocked) {
    appendMessage("ai", "🔒 Cannot modify file selection while locked.", "error");
    return;
  }

  const isSelected = state.selectedFiles.some((f) => f.id === file.id);
  if (isSelected) {
    state.selectedFiles = state.selectedFiles.filter((f) => f.id !== file.id);
  } else {
    state.selectedFiles.push(file);
  }

  updateSelectedFilesDisplay();
  updateFileListUI();
}

function removeSelectedFile(index) {
  if (state.filesLocked) {
    appendMessage("ai", "🔒 Cannot remove files while locked.", "error");
    return;
  }
  state.selectedFiles.splice(index, 1);
  updateSelectedFilesDisplay();
  updateFileListUI();
}

function clearAllSelectedFiles() {
  if (state.filesLocked) {
    appendMessage("ai", "🔒 Cannot clear files while locked.", "error");
    return;
  }
  state.selectedFiles = [];
  updateSelectedFilesDisplay();
  updateFileListUI();
  appendMessage("ai", "All files cleared. Select new files to continue.");
}

async function loadFiles() {
  const listFilesBtn = document.getElementById("listFilesBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const fileCount = document.getElementById("fileCount");
  const fileListContainer = document.getElementById("fileListContainer");
  const fileList = document.getElementById("fileList");

  listFilesBtn.disabled = true;
  listFilesBtn.textContent = "⏳ Loading...";
  fileList.innerHTML =
    '<div style="padding:20px;text-align:center;color:var(--color-text-secondary)">Loading files...</div>';

  try {
    const result = await api.listDriveFiles(100);
    const files = Array.isArray(result) ? result : result.files || [];
    
    // Normalize file structure
    state.allFiles = files.map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime
    }));

    updateFileListUI();
    fileListContainer.classList.add("open");
    listFilesBtn.disabled = false;
    listFilesBtn.textContent = "📋 Hide Files";
    refreshBtn.style.display = "inline-block";
    fileCount.style.display = "inline-block";
    fileCount.textContent = `📊 ${state.allFiles.length} files found`;
    state.filesVisible = true;
  } catch (e) {
    listFilesBtn.disabled = false;
    listFilesBtn.textContent = "📋 Show Files";
    fileList.innerHTML =
      '<div style="padding:20px;text-align:center;color:#f44336">Failed to load files</div>';
    appendMessage("ai", `❌ Error loading files: ${e.message}`, "error");
  }
}

async function refreshFiles() {
  const refreshBtn = document.getElementById("refreshBtn");
  const fileCount = document.getElementById("fileCount");
  const fileList = document.getElementById("fileList");

  if (state.filesLocked) {
    appendMessage("ai", "🔒 Cannot refresh files while locked.", "error");
    return;
  }

  refreshBtn.disabled = true;
  refreshBtn.textContent = "⏳ Refreshing...";
  fileList.innerHTML =
    '<div style="padding:20px;text-align:center;color:var(--color-text-secondary)">Refreshing files...</div>';

  try {
    const result = await api.listDriveFiles(100);
    const files = Array.isArray(result) ? result : result.files || [];
    
    state.allFiles = files.map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime
    }));

    updateFileListUI();
    refreshBtn.disabled = false;
    refreshBtn.textContent = "🔄 Refresh";
    fileCount.textContent = `📊 ${state.allFiles.length} files found`;
  } catch (e) {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "🔄 Refresh";
    fileList.innerHTML =
      '<div style="padding:20px;text-align:center;color:#f44336">Failed to refresh files</div>';
    appendMessage("ai", `❌ Error refreshing files: ${e.message}`, "error");
  }
}

function toggleFileList() {
  const fileListContainer = document.getElementById("fileListContainer");
  const listFilesBtn = document.getElementById("listFilesBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const fileCount = document.getElementById("fileCount");

  if (state.filesLocked) {
    appendMessage("ai", "🔒 Cannot browse files while locked.", "error");
    return;
  }

  if (state.filesVisible) {
    fileListContainer.classList.remove("open");
    listFilesBtn.textContent = "📋 Show Files";
    refreshBtn.style.display = "none";
    fileCount.style.display = "none";
    state.filesVisible = false;
    return;
  }

  if (state.allFiles.length === 0) {
    loadFiles();
  } else {
    fileListContainer.classList.add("open");
    listFilesBtn.textContent = "📋 Hide Files";
    refreshBtn.style.display = "inline-block";
    fileCount.style.display = "inline-block";
    fileCount.textContent = `📊 ${state.allFiles.length} files found`;
    state.filesVisible = true;
  }
}

function toggleFileLock() {
  state.filesLocked = !state.filesLocked;
  applyLockUI();
  appendMessage(
    "ai",
    state.filesLocked
      ? "🔒 Files are now locked. You cannot add or remove files until you unlock them."
      : "🔓 Files are now unlocked. You can add or remove files.",
    "success"
  );
}

function saveSystemPrompt() {
  const textarea = document.getElementById("systemPromptTextarea");
  const newPrompt = textarea.value.trim();

  if (!newPrompt) {
    appendMessage("ai", "⚠️ System prompt cannot be empty. Using default prompt.", "error");
    textarea.value = state.defaultSystemPrompt;
    state.customSystemPrompt = state.defaultSystemPrompt;
    return;
  }
  state.customSystemPrompt = newPrompt;
  appendMessage("ai", "✅ System prompt applied to this chat!", "success");
}

function resetSystemPrompt() {
  state.customSystemPrompt = state.defaultSystemPrompt;
  document.getElementById("systemPromptTextarea").value = state.customSystemPrompt;
  appendMessage("ai", "🔄 System prompt reset to default for this chat.", "success");
}

async function loadChats() {
  const chatList = document.getElementById("chatList");
  chatList.innerHTML = '<div class="sidebar-empty">Loading...</div>';

  try {
    const data = await api.listChats();
    const chats = Array.isArray(data) ? data : data.chats || [];

    if (!chats.length) {
      chatList.innerHTML = '<div class="sidebar-empty">No saved chats</div>';
      return;
    }

    chatList.innerHTML = "";
    chats.forEach((chat) => {
      const div = document.createElement("div");
      div.className = "chat-item";
      div.dataset.chatId = chat.id;
      div.innerHTML = `<span class="chat-name">${escapeHtml(chat.name)}</span>`;
      div.onclick = () => loadChat(chat.id);

      if (state.currentChatId === chat.id) div.classList.add("active");
      chatList.appendChild(div);
    });
  } catch (e) {
    chatList.innerHTML = '<div class="sidebar-empty">Error loading chats</div>';
    appendMessage("ai", `❌ Error loading chats: ${e.message}`, "error");
  }
}

function setActiveChatHighlight() {
  const chatList = document.getElementById("chatList");
  chatList.querySelectorAll(".chat-item").forEach((el) => el.classList.remove("active"));
  if (!state.currentChatId) return;
  chatList.querySelectorAll(".chat-item").forEach((el) => {
    if (el.dataset.chatId === state.currentChatId) el.classList.add("active");
  });
}

async function loadChat(chatId) {
  showLoading("Loading chat...");
  try {
    const data = await api.getChat(chatId);
    const chat = data.chat || data;

    state.currentChatId = chat.id;
    state.firstUserMessage = chat.name || "";

    state.filesLocked = !!chat.filesLocked;
    applyLockUI();

    state.customSystemPrompt = chat.systemPrompt || state.defaultSystemPrompt;
    document.getElementById("systemPromptTextarea").value = state.customSystemPrompt;

    const files = chat.files || [];
    state.selectedFiles = files.map((f) => ({
      id: f.driveFileId,
      name: f.name,
      mimeType: f.mimeType,
    }));

    const messages = chat.messages || [];
    state.chatHistory = [];
    const chatContainer = document.getElementById("chatContainer");
    chatContainer.innerHTML = "";
    messages.forEach((m) => {
      appendMessage(m.sender, m.text);
    });

    if (!messages.length) {
      appendMessage("ai", "Loaded chat. Ask me anything about the attached files!");
    }

    updateSelectedFilesDisplay();
    setActiveChatHighlight();
    await loadChats();
  } catch (e) {
    appendMessage("ai", `❌ Error loading chat: ${e.message}`, "error");
  } finally {
    hideLoading();
  }
}

async function newChat() {
  // Reset ALL state
  state.currentChatId = null;
  state.currentShareId = null;  // ✅ ADD THIS
  state.firstUserMessage = "";
  state.chatHistory = [];
  state.selectedFiles = [];
  state.filesLocked = false;
  state.isSharedChat = false;
  
  applyLockUI();

  const chatContainer = document.getElementById("chatContainer");
  chatContainer.innerHTML = "";
  appendMessage("ai", "New chat started! Select files and ask me anything.");

  updateSelectedFilesDisplay();
  setActiveChatHighlight();
  
  // Clear shared chat highlights
  document.querySelectorAll("#sharedChatList .chat-item").forEach((el) => {
    el.classList.remove("active");
  });
}

async function saveChat() {
  if (!state.currentChatId) {
    showToast("No chat to rename yet. Start a conversation first!", "info");
    return;
  }

  // Get current chat name
  const currentName = state.firstUserMessage || "Untitled chat";
  
  showModal({
    title: "Rename Chat",
    bodyHtml: `
      <p>Give this chat a custom name.</p>
      <label for="modalChatNameInput">Chat name</label>
      <input type="text" id="modalChatNameInput" value="${escapeHtml(currentName)}" />
    `,
    primaryText: "Rename",
    secondaryText: "Cancel",
    onPrimary: async () => {
      const input = document.getElementById("modalChatNameInput");
      const name = (input.value || "").trim();
      if (!name) {
        showToast("Chat name cannot be empty.", "error");
        return;
      }
      closeModal();

      showLoading("Renaming chat...");
      try {
        await api.updateChat(state.currentChatId, {
          name,
          systemPrompt: state.customSystemPrompt,
          filesLocked: state.filesLocked,
        });
        state.firstUserMessage = name;
        showToast("Chat renamed successfully.", "success");
        await loadChats();
        setActiveChatHighlight();
      } catch (e) {
        showToast(`Error renaming chat: ${e.message}`, "error");
      } finally {
        hideLoading();
      }
    },
  });
}

async function deleteChat() {
  if (!state.currentChatId) {
    showToast("No chat to delete yet.", "info");
    return;
  }

  const name = state.firstUserMessage || "this chat";
  showModal({
    title: "Delete Chat",
    bodyHtml: `
      <p>Are you sure you want to permanently delete "<strong>${escapeHtml(name)}</strong>"?</p>
      <p>This cannot be undone.</p>
    `,
    primaryText: "Delete",
    secondaryText: "Cancel",
    primaryType: "danger",
    onPrimary: async () => {
      closeModal();
      showLoading("Deleting chat...");
      try {
        await api.deleteChat(state.currentChatId);
        showToast("Chat deleted.", "success");
        
        // Reset to new chat state
        state.currentChatId = null;
        state.firstUserMessage = "";
        state.chatHistory = [];
        state.selectedFiles = [];
        state.filesLocked = false;
        applyLockUI();
        
        await loadChats();

        const chatContainer = document.getElementById("chatContainer");
        chatContainer.innerHTML = "";
        appendMessage("ai", "Chat deleted. Select files and start a new conversation!");
        updateSelectedFilesDisplay();
      } catch (e) {
        showToast(`Error deleting chat: ${e.message}`, "error");
      } finally {
        hideLoading();
      }
    },
  });
}

async function connectSlack() {
  try {
    const { clientId } = await api.getSlackClientId();
    const redirectUri = encodeURIComponent(`${CONFIG.API_BASE_URL}/slack/oauth/callback`);
    const scopes = encodeURIComponent("commands,chat:write,users:read,users:read.email,im:write,im:history");
    
    const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&user_scope=chat:write,users:read,users:read.email`;
    
    window.open(slackAuthUrl, "_blank", "width=600,height=800");
    showToast("Opening Slack authorization...", "info");
  } catch (e) {
    showToast(`Error: ${e.message}`, "error");
  }
}

async function attachSelectedFilesToChat() {
  if (!state.currentChatId) {
    appendMessage("ai", "❌ No chat created yet. Click New Chat first.", "error");
    return;
  }
  if (!state.selectedFiles.length) return;

  try {
    await Promise.all(
      state.selectedFiles.map((f) =>
        api.attachFileToChat(state.currentChatId, {
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
        })
      )
    );
  } catch (e) {
    appendMessage("ai", `⚠️ Some files may not have attached: ${e.message}`, "error");
  }
}

async function sendMessage() {
  const userInput = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendBtn");

  const text = userInput.value.trim();
  if (!text) return;

  appendMessage("user", text);
  userInput.value = "";

  // Handle shared chat messages
  if (state.isSharedChat && state.currentShareId) {
    sendBtn.disabled = true;
    sendBtn.textContent = "⏳";
    userInput.disabled = true;
    showTypingIndicator();

    try {
      const result = await api.sendSharedChatMessage({
        shareId: state.currentShareId,
        userPrompt: text,
      });

      const aiResponse = result.aiResponse || "";
      appendMessage("ai", aiResponse);
    } catch (e) {
      appendMessage("ai", `❌ Error: ${e.message}`, "error");
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "➤";
      userInput.disabled = false;
      hideTypingIndicator();
    }
    return;
  }

  // Handle regular chat messages (existing code)
  if (state.selectedFiles.length === 0) {
    appendMessage("ai", "⚠️ Please select at least one file first.");
    return;
  }

  // Auto-create chat if none exists (first message in a new chat)
  if (!state.currentChatId) {
    showLoading("Creating chat...");
    try {
      const chatName = text.length > 40 ? text.slice(0, 40).trim() + "..." : text;
      
      const created = await api.createChat({
        name: chatName,
        systemPrompt: state.customSystemPrompt || state.defaultSystemPrompt,
      });

      const chat = created.chat || created;
      state.currentChatId = chat.id;
      state.firstUserMessage = chatName;
      state.chatHistory = [];

      await loadChats();
      setActiveChatHighlight();
      hideLoading();
    } catch (e) {
      hideLoading();
      appendMessage("ai", `❌ Error creating chat: ${e.message}`, "error");
      return;
    }
  }

  await attachSelectedFilesToChat();

  sendBtn.disabled = true;
  sendBtn.textContent = "⏳";
  userInput.disabled = true;
  showTypingIndicator();

  try {
    const result = await api.aiPrompt({
      chatId: state.currentChatId,
      userPrompt: text,
      systemPrompt: state.customSystemPrompt,
    });

    const aiResponse = result.aiResponse || "";
    appendMessage("ai", aiResponse);
  } catch (e) {
    appendMessage("ai", `❌ Error: ${e.message}`, "error");
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = "➤";
    userInput.disabled = false;
    hideTypingIndicator();
  }
}


async function shareChat() {
  if (!state.currentChatId) {
    showToast("No chat to share. Start a conversation first!", "info");
    return;
  }

  showModal({
    title: "Share Chat",
    bodyHtml: `
      <p>Share this chat with another user. They'll receive a snapshot with full document content embedded.</p>
      
      <label for="shareEmailInput">Recipient email</label>
      <input type="email" id="shareEmailInput" placeholder="colleague@example.com" />
      
      <label for="shareRoleSelect">Access level</label>
      <select id="shareRoleSelect">
        <option value="VIEWER">Can view and chat</option>
        <option value="EDITOR">Can edit (future feature)</option>
      </select>
      
      <p style="margin-top:10px;font-size:12px;color:var(--color-text-secondary);">
        💡 The recipient will be able to chat with the AI using the embedded document content. They won't need access to your Google Drive files.
      </p>
    `,
    primaryText: "Share",
    secondaryText: "Cancel",
    onPrimary: async () => {
      const emailInput = document.getElementById("shareEmailInput");
      const roleSelect = document.getElementById("shareRoleSelect");
      
      const email = (emailInput.value || "").trim();
      const role = roleSelect.value;
      
      if (!email) {
        showToast("Please enter an email address.", "error");
        return;
      }
      
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast("Please enter a valid email address.", "error");
        return;
      }
      
      closeModal();
      showLoading("Preparing share (fetching file contents)...");
      
      try {
        await api.shareChat({
          chatId: state.currentChatId,
          sharedWithEmail: email,
          role,
        });
        
        showToast(`Chat shared with ${email}!`, "success");
      } catch (e) {
        showToast(`Error sharing chat: ${e.message}`, "error");
      } finally {
        hideLoading();
      }
    },
  });
}

async function loadSharedChats() {
  const sharedChatList = document.getElementById("sharedChatList");
  sharedChatList.innerHTML = '<div class="sidebar-empty">Loading...</div>';

  try {
    const data = await api.getSharesWithMe();
    const shares = Array.isArray(data) ? data : data.shares || [];

    if (!shares.length) {
      sharedChatList.innerHTML = '<div class="sidebar-empty">No shared chats</div>';
      return;
    }

    sharedChatList.innerHTML = "";
    shares.forEach((share) => {
      const chatName = share.snapshotChatJson?.name || share.chat?.name || "Shared Chat";
      const sharedBy = share.createdByUser?.name || share.createdByUser?.email || "Unknown";
      
      const div = document.createElement("div");
      div.className = "chat-item";
      div.dataset.shareId = share.id;
      div.innerHTML = `
        <span class="chat-name">${escapeHtml(chatName)}</span>
        <span style="font-size:11px;color:var(--color-text-secondary);display:block;margin-top:2px;">
          by ${escapeHtml(sharedBy)}
        </span>
      `;
      div.onclick = () => loadSharedChat(share.id);

      sharedChatList.appendChild(div);
    });
  } catch (e) {
    sharedChatList.innerHTML = '<div class="sidebar-empty">Error loading shared chats</div>';
    console.error("Error loading shared chats:", e);
  }
}

async function loadSharedChat(shareId) {
  showLoading("Loading shared chat...");
  try {
    const data = await api.getShare(shareId);
    const share = data.share || data;
    const snapshot = share.snapshotChatJson;

    // Set shared chat mode
    state.currentChatId = null;
    state.currentShareId = shareId;  // ✅ Store the share ID
    state.isSharedChat = true;
    state.filesLocked = true;
    applyLockUI();

    const chatName = snapshot.name || "Shared Chat";
    state.firstUserMessage = chatName;

    // Load files from snapshot (display only, content is embedded)
    state.selectedFiles = (snapshot.files || []).map((f) => ({
      id: f.driveFileId,
      name: f.name,
      mimeType: f.mimeType,
    }));

    // Load messages from snapshot
    const messages = snapshot.messages || [];
    state.chatHistory = [];
    const chatContainer = document.getElementById("chatContainer");
    chatContainer.innerHTML = "";
    
    messages.forEach((m) => {
      appendMessage(m.sender, m.text);
    });

    if (!messages.length) {
      appendMessage("ai", "This shared chat has no messages yet.");
    }

    // Add info message
    const sharedBy = share.createdByUser?.name || share.createdByUser?.email || "someone";
    appendMessage(
      "ai",
      `📤 This is a shared chat from ${sharedBy}. You can interact with the AI using the embedded document content. Your messages will be saved in this shared chat.`,
      "success"
    );

    updateSelectedFilesDisplay();
    
    // Highlight in sidebar
    document.querySelectorAll("#sharedChatList .chat-item").forEach((el) => {
      el.classList.remove("active");
      if (el.dataset.shareId === shareId) {
        el.classList.add("active");
      }
    });
    
  } catch (e) {
    appendMessage("ai", `❌ Error loading shared chat: ${e.message}`, "error");
  } finally {
    hideLoading();
  }
}



function wireEvents() {
  // File buttons
  document.getElementById("listFilesBtn")?.addEventListener("click", toggleFileList);
  document.getElementById("refreshBtn")?.addEventListener("click", refreshFiles);
  document.getElementById("clearFilesBtn")?.addEventListener("click", clearAllSelectedFiles);
  document.getElementById("lockBtn")?.addEventListener("click", toggleFileLock);

  // System prompt buttons
  document.getElementById("togglePromptBtn")?.addEventListener("click", toggleSystemPromptUI);
  document.getElementById("savePromptBtn")?.addEventListener("click", saveSystemPrompt);
  document.getElementById("resetPromptBtn")?.addEventListener("click", resetSystemPrompt);

  // Chat buttons
  document.getElementById("sendBtn")?.addEventListener("click", sendMessage);
  document.getElementById("userInput")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !document.getElementById("sendBtn").disabled) {
      sendMessage();
    }
  });

  document.getElementById("saveChatBtn")?.addEventListener("click", saveChat);
  document.getElementById("deleteChatBtn")?.addEventListener("click", deleteChat);
  document.getElementById("newChatBtn")?.addEventListener("click", newChat);
  document.getElementById("shareChatBtn")?.addEventListener("click", shareChat);  // ✅ ADD THIS

  // Auth button
  document.getElementById("authBtn")?.addEventListener("click", openTokenModal);

  // Theme toggle
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    toggleTheme(CONFIG.THEME_STORAGE_KEY);
  });

  //Slack
  document.getElementById("slackConnectBtn")?.addEventListener("click", connectSlack);

  // Search
  document.getElementById("searchBox")?.addEventListener("input", () => {
    const q = (document.getElementById("searchBox").value || "").toLowerCase();
    if (!state.allFiles.length) return;
    const filtered = state.allFiles.filter((f) => (f.name || "").toLowerCase().includes(q));

    updateFileListUI(filtered);

    const fileCount = document.getElementById("fileCount");
    fileCount.textContent = `📊 ${filtered.length} of ${state.allFiles.length} files`;
  });
}

// Add logout button handler
function addLogoutButton() {
  const headerButtons = document.querySelector(".header-buttons");
  
  // Check if logout button already exists
  if (document.getElementById("logoutBtn")) return;
  
  const logoutBtn = document.createElement("button");
  logoutBtn.id = "logoutBtn";
  logoutBtn.className = "btn-secondary";
  logoutBtn.textContent = "🚪 Logout";
  logoutBtn.addEventListener("click", async () => {
    if (confirm("Are you sure you want to logout?")) {
      try {
        await api.logout();
        window.location.href = "/login.html";
      } catch (e) {
        console.error("Logout error:", e);
      }
    }
  });
  
  headerButtons.insertBefore(logoutBtn, headerButtons.lastChild);
}

async function init() {
  console.log("Initializing app...");
  
  // Check authentication first
  try {
    const authStatus = await api.checkAuth();
    if (!authStatus.authenticated) {
      window.location.href = "/login.html";
      return;
    }
  } catch (e) {
    console.error("Auth check failed:", e);
    window.location.href = "/login.html";
    return;
  }
  
  wireMarked();
  wireModalCloseHandlers();
  setSystemPromptDefaults();
  applyLockUI();
  setThemeFromStorage(CONFIG.THEME_STORAGE_KEY);

  // Wire all events
  wireEvents();
  addLogoutButton();

  showLoading("Initializing...");
  try {
    await api.me().catch(() => null);
    await loadChats();
    await loadSharedChats();  // ✅ ADD THIS

    setTimeout(() => {
      appendMessage("ai", '👋 Welcome! To get started:\n\n1. Click "Show Files" to browse your Google Drive\n2. Select one or more files\n3. Ask me anything about them!\n\nI\'ll automatically create a chat for you when you send your first message.');
    }, 800);
  } catch (e) {
    console.error("Init error:", e);
    appendMessage("ai", `⚠️ Initialization error: ${e.message}`, "error");
  } finally {
    hideLoading();
  }

  console.log("App initialized successfully");
}


// Start the app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}