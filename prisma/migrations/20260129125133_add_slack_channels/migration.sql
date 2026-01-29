/*
  Warnings:

  - A unique constraint covering the columns `[slackChannelId]` on the table `Chat` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "slackChannelId" TEXT,
ADD COLUMN     "slackChannelName" TEXT;

-- AlterTable
ALTER TABLE "ChatShare" ADD COLUMN     "slackSynced" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "slackThreadTs" TEXT,
ADD COLUMN     "slackTs" TEXT,
ADD COLUMN     "syncedToSlack" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Chat_slackChannelId_key" ON "Chat"("slackChannelId");

-- CreateIndex
CREATE INDEX "Chat_slackChannelId_idx" ON "Chat"("slackChannelId");

-- CreateIndex
CREATE INDEX "Message_slackTs_idx" ON "Message"("slackTs");
