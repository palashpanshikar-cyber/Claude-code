-- CreateTable
CREATE TABLE "StreakBreak" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "streakLength" INTEGER NOT NULL,
    "lastActiveDay" TEXT,
    "brokenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreakBreak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StreakBreak_userId_brokenAt_idx" ON "StreakBreak"("userId", "brokenAt");

-- CreateIndex
CREATE INDEX "StreakBreak_brokenAt_idx" ON "StreakBreak"("brokenAt");

-- AddForeignKey
ALTER TABLE "StreakBreak" ADD CONSTRAINT "StreakBreak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
