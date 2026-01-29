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
        text: "💡 Your chats are synced as private Slack channels.\nCheck your Slack sidebar for channels starting with `esme-`",
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
    const channelName = chat.slackChannelName || "Not synced yet";

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${chatName}*\n📱 Channel: \`${channelName}\`\n📎 ${fileCount} files · 💬 ${messageCount} messages`,
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
        text: "💬 Message directly in the Slack channels to chat with AI!",
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
        text: "💡 Shared chats use snapshots - they're read-only in this view.",
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
        text: `*${chatName}*\n👤 Shared by: ${sharedBy}\n📎 ${fileCount} files · 💬 ${messageCount} messages`,
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