// Helper functions to build Slack Block Kit UI

export function buildChatListBlocks(chats, type = "personal") {
  if (!chats || chats.length === 0) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `No ${type} chats found.\n\n🌐 Create chats in the web app: ${process.env.FRONTEND_URL}`,
        },
      },
    ];
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📋 Your Personal Chats`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "💡 Personal chats can only be accessed in the web app.\nTo message from Slack, share a chat first!",
      },
    },
    {
      type: "divider",
    },
  ];

  chats.forEach((chat) => {
    const chatName = chat.name || "Untitled Chat";
    const chatId = chat.id;
    const fileCount = chat._count?.files || 0;
    const messageCount = chat._count?.messages || 0;

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${chatName}*\n📎 ${fileCount} files · 💬 ${messageCount} messages`,
      },
      accessory: {
        type: "button",
        text: {
          type: "plain_text",
          text: "Open in Web",
        },
        url: `${process.env.FRONTEND_URL}?chat=${chatId}`,
        action_id: "open_chat",
      },
    });
  });

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "🔗 To message from Slack: Share a chat with colleagues using the web app",
      },
    ],
  });

  return blocks;
}

export function buildSharedChatListBlocks(shares) {
  if (!shares || shares.length === 0) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "No shared chats found.\n\nChats shared with you will appear here.",
        },
      },
    ];
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🌐 Chats Shared With You",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "💡 To send a message: `/esme-chat <Share-ID> <your message>`",
      },
    },
    {
      type: "divider",
    },
  ];

  shares.forEach((share) => {
    const chatName = share.snapshotChatJson?.name || "Shared Chat";
    const shareId = share.id;
    const sharedBy = share.createdByUser?.name || share.createdByUser?.email || "Unknown";
    const fileCount = share.snapshotChatJson?.files?.length || 0;
    const messageCount = share.snapshotChatJson?.messages?.length || 0;

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${chatName}*\n` +
              `📋 Share ID: \`${shareId}\`\n` +
              `👤 Shared by: ${sharedBy}\n` +
              `📎 ${fileCount} files · 💬 ${messageCount} messages`,
      },
      accessory: {
        type: "button",
        text: {
          type: "plain_text",
          text: "View in Web",
        },
        url: `${process.env.FRONTEND_URL}?share=${shareId}`,
        action_id: "open_shared_chat",
      },
    });
  });

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "📱 Use the Share ID in `/esme-chat` or click *View in Web* to see full chat",
      },
    ],
  });

  return blocks;
}

export function buildChatMessagesBlocks(chat, messages) {
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: chat.name || "Chat Conversation",
      },
    },
    {
      type: "divider",
    },
  ];

  if (!messages || messages.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No messages yet. Start a conversation!",
      },
    });
    return blocks;
  }

  // Show last 5 messages
  const recentMessages = messages.slice(-5);

  recentMessages.forEach((msg) => {
    const emoji = msg.sender === "user" ? "👤" : "🤖";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${msg.sender === "user" ? "You" : "AI"}*\n${msg.text}`,
      },
    });
  });

  if (messages.length > 5) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_Showing last 5 of ${messages.length} messages_`,
        },
      ],
    });
  }

  return blocks;
}

export function buildErrorBlock(message) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `❌ *Error*\n${message}`,
      },
    },
  ];
}

export function buildSuccessBlock(message) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `✅ ${message}`,
      },
    },
  ];
}