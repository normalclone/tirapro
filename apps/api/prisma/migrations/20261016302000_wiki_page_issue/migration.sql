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

-- Backfill một lần: trích mã công việc từ nội dung trang MỘT lần rồi nối theo khoá (hash join) —
-- độ phức tạp theo số mã trong nội dung, không phải tích trang × công việc.
-- Mẫu mã = ISSUE_KEY_RE của packages/shared (markdown-text.ts); lookbehind/lookahead dùng được từ PostgreSQL 9.6.
INSERT INTO "WikiPageIssue" ("wikiPageId", "issueId")
SELECT DISTINCT w."id", i."id"
FROM "WikiPage" w
CROSS JOIN LATERAL regexp_matches(
  w."body",
  '(?<![A-Za-z0-9-])[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-[0-9]+(?![A-Za-z0-9-])',
  'g'
) AS m(k)
JOIN "Issue" i ON i."workspaceId" = w."workspaceId" AND i."key" = m.k[1] AND i."deletedAt" IS NULL
JOIN "Project" p ON p."id" = i."projectId" AND p."deletedAt" IS NULL
ON CONFLICT DO NOTHING;
