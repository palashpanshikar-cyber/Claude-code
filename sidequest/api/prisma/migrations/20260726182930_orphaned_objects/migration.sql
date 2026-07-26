-- CreateTable
CREATE TABLE "OrphanedObject" (
    "id" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrphanedObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrphanedObject_objectKey_key" ON "OrphanedObject"("objectKey");

-- CreateIndex
CREATE INDEX "OrphanedObject_createdAt_idx" ON "OrphanedObject"("createdAt");
