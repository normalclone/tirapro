-- AlterTable
ALTER TABLE "ChannelLinkToken" ADD COLUMN "integrationId" TEXT;

-- CreateIndex
CREATE INDEX "ChannelLinkToken_integrationId_idx" ON "ChannelLinkToken"("integrationId");

-- AddForeignKey
ALTER TABLE "ChannelLinkToken" ADD CONSTRAINT "ChannelLinkToken_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
