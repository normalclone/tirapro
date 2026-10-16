-- CreateTable
CREATE TABLE "WikiPageIssue" (
    "wikiPageId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WikiPageIssue_pkey" PRIMARY KEY ("wikiPageId","issueId")
);

-- CreateIndex
CREATE INDEX "WikiPageIssue_issueId_idx" ON "WikiPageIssue"("issueId");

-- AddForeignKey
ALTER TABLE "WikiPageIssue" ADD CONSTRAINT "WikiPageIssue_wikiPageId_fkey" FOREIGN KEY ("wikiPageId") REFERENCES "WikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPageIssue" ADD CONSTRAINT "WikiPageIssue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill một lần: trang nào đang nhắc mã công việc (còn sống, cùng workspace) thì ghi liên kết.
-- Biên mã giống extractIssueKeys: trước/sau mã không được là chữ, số hoặc dấu gạch ngang.
INSERT INTO "WikiPageIssue" ("wikiPageId", "issueId")
SELECT DISTINCT w."id", i."id"
FROM "WikiPage" w
JOIN "Issue" i ON i."workspaceId" = w."workspaceId" AND i."deletedAt" IS NULL
JOIN "Project" p ON p."id" = i."projectId" AND p."deletedAt" IS NULL
WHERE w."body" ~ ('(^|[^A-Za-z0-9-])' || i."key" || '($|[^A-Za-z0-9-])')
ON CONFLICT DO NOTHING;
