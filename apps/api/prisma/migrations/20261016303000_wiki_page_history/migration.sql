-- CreateTable
CREATE TABLE "WikiPageVersion" (
    "id" TEXT NOT NULL,
    "wikiPageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WikiPageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WikiPageVersion_wikiPageId_version_key" ON "WikiPageVersion"("wikiPageId", "version");

-- AddForeignKey
ALTER TABLE "WikiPageVersion" ADD CONSTRAINT "WikiPageVersion_wikiPageId_fkey" FOREIGN KEY ("wikiPageId") REFERENCES "WikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: mỗi trang đã có được một phiên bản 1 = trạng thái hiện tại (để "Lịch sử" không trống và khôi phục được về mốc này).
INSERT INTO "WikiPageVersion" ("id", "wikiPageId", "version", "title", "body", "authorId", "note", "createdAt")
SELECT 'wpv_' || w."id", w."id", 1, w."title", w."body", COALESCE(w."updatedById", w."createdById"), 'Bản trước khi bật lịch sử', w."updatedAt"
FROM "WikiPage" w;
