-- CreateTable
CREATE TABLE "UserTelegramLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "username" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTelegramLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTelegramLinkCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTelegramLinkCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserTelegramLink_organizationId_idx" ON "UserTelegramLink"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTelegramLink_userId_organizationId_key" ON "UserTelegramLink"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTelegramLink_integrationId_chatId_key" ON "UserTelegramLink"("integrationId", "chatId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTelegramLinkCode_code_key" ON "UserTelegramLinkCode"("code");

-- CreateIndex
CREATE INDEX "UserTelegramLinkCode_userId_organizationId_idx" ON "UserTelegramLinkCode"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "UserTelegramLinkCode_integrationId_idx" ON "UserTelegramLinkCode"("integrationId");

-- AddForeignKey
ALTER TABLE "UserTelegramLink" ADD CONSTRAINT "UserTelegramLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTelegramLink" ADD CONSTRAINT "UserTelegramLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTelegramLink" ADD CONSTRAINT "UserTelegramLink_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTelegramLinkCode" ADD CONSTRAINT "UserTelegramLinkCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTelegramLinkCode" ADD CONSTRAINT "UserTelegramLinkCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTelegramLinkCode" ADD CONSTRAINT "UserTelegramLinkCode_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

