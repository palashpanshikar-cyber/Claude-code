-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('ADVENTURE', 'FOOD_DRINK', 'CULTURE', 'NATURE', 'FITNESS', 'CREATIVE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "city" TEXT,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDay" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quest" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "city" TEXT,
    "neighborhood" TEXT,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Completion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "photoKey" TEXT NOT NULL,
    "review" TEXT,
    "rating" INTEGER NOT NULL,
    "localDay" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Completion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MiniQuest" (
    "id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "category" "Category" NOT NULL,

    CONSTRAINT "MiniQuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MiniAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "miniQuestId" TEXT NOT NULL,
    "localDay" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MiniAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_lastActiveDay_idx" ON "User"("lastActiveDay");

-- CreateIndex
CREATE INDEX "Quest_category_city_idx" ON "Quest"("category", "city");

-- CreateIndex
CREATE INDEX "Quest_isActive_idx" ON "Quest"("isActive");

-- CreateIndex
CREATE INDEX "Completion_userId_createdAt_idx" ON "Completion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Completion_userId_localDay_idx" ON "Completion"("userId", "localDay");

-- CreateIndex
CREATE UNIQUE INDEX "Completion_userId_questId_key" ON "Completion"("userId", "questId");

-- CreateIndex
CREATE UNIQUE INDEX "MiniQuest_slot_key" ON "MiniQuest"("slot");

-- CreateIndex
CREATE INDEX "MiniAssignment_userId_localDay_idx" ON "MiniAssignment"("userId", "localDay");

-- CreateIndex
CREATE UNIQUE INDEX "MiniAssignment_userId_miniQuestId_localDay_key" ON "MiniAssignment"("userId", "miniQuestId", "localDay");

-- AddForeignKey
ALTER TABLE "Completion" ADD CONSTRAINT "Completion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Completion" ADD CONSTRAINT "Completion_questId_fkey" FOREIGN KEY ("questId") REFERENCES "Quest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiniAssignment" ADD CONSTRAINT "MiniAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiniAssignment" ADD CONSTRAINT "MiniAssignment_miniQuestId_fkey" FOREIGN KEY ("miniQuestId") REFERENCES "MiniQuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

