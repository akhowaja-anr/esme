-- CreateEnum
CREATE TYPE "ChatScope" AS ENUM ('PERSONAL', 'SHARED_SNAPSHOT');

-- CreateEnum
CREATE TYPE "ShareRole" AS ENUM ('VIEWER', 'EDITOR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "scope" "ChatScope" NOT NULL DEFAULT 'PERSONAL',
    "name" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "filesLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "timestamp" BIGINT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatFile" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatShare" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "sharedWithEmail" TEXT,
    "sharedWithUserId" TEXT,
    "role" "ShareRole" NOT NULL DEFAULT 'VIEWER',
    "createdByUserId" TEXT NOT NULL,
    "snapshotChatJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Chat_ownerId_updatedAt_idx" ON "Chat"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "Chat_scope_updatedAt_idx" ON "Chat"("scope", "updatedAt");

-- CreateIndex
CREATE INDEX "Message_chatId_createdAt_idx" ON "Message"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatFile_driveFileId_idx" ON "ChatFile"("driveFileId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatFile_chatId_driveFileId_key" ON "ChatFile"("chatId", "driveFileId");

-- CreateIndex
CREATE INDEX "ChatShare_chatId_idx" ON "ChatShare"("chatId");

-- CreateIndex
CREATE INDEX "ChatShare_sharedWithUserId_idx" ON "ChatShare"("sharedWithUserId");

-- CreateIndex
CREATE INDEX "ChatShare_sharedWithEmail_idx" ON "ChatShare"("sharedWithEmail");

-- CreateIndex
CREATE INDEX "ChatShare_createdByUserId_idx" ON "ChatShare"("createdByUserId");

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatFile" ADD CONSTRAINT "ChatFile_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatShare" ADD CONSTRAINT "ChatShare_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatShare" ADD CONSTRAINT "ChatShare_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatShare" ADD CONSTRAINT "ChatShare_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
