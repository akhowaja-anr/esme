/*
  Warnings:

  - A unique constraint covering the columns `[slackUserId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "slackAccessToken" TEXT,
ADD COLUMN     "slackTeamId" TEXT,
ADD COLUMN     "slackUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_slackUserId_key" ON "User"("slackUserId");
