/**
 * Tirapro — sửa tên tệp đính kèm đã lưu MÉO (tiếng Việt bị multer giải mã latin1: "báo cáo" → "bÃ¡o cÃ¡o") — TUỲ CHỌN.
 * Chỉ sửa cột hiển thị `Attachment.fileName`; khoá lưu trữ (`storageKey`) không đổi nên tệp trên đĩa/S3 không bị đụng tới.
 * Dùng đúng phép kiểm "sạch" của lúc upload (`fixLatin1Utf8`): chỉ đổi khi mọi ký tự ≤ U+00FF và giải mã UTF-8 không sinh U+FFFD;
 * tên không giải mã lossless được thì giữ nguyên.
 *
 *   pnpm --filter @tirapro/api run attachments:fix-filenames -- --dry-run   # chỉ liệt kê, không ghi
 *   pnpm --filter @tirapro/api run attachments:fix-filenames                # cập nhật
 *   docker run --rm --env-file .env <image> node scripts/attachments-fix-filenames.mjs --dry-run
 *
 * Cần DATABASE_URL và `pnpm --filter @tirapro/api build` trước (dùng mã đã biên dịch ở dist/). Idempotent.
 */
import { PrismaClient } from '@prisma/client';

const dryRun = process.argv.includes('--dry-run');
if (!(process.env.DATABASE_URL ?? '').trim()) {
  console.error('Thiếu DATABASE_URL.');
  process.exit(1);
}

let fixLatin1Utf8;
try {
  ({ fixLatin1Utf8 } = await import('../dist/common/filename.js'));
} catch (err) {
  console.error(
    `Không nạp được mã đã biên dịch (dist/): ${err.message}\nChạy \`pnpm --filter @tirapro/api build\` trước.`,
  );
  process.exit(1);
}

const prisma = new PrismaClient();
let scanned = 0;
let fixed = 0;
try {
  let cursor;
  for (;;) {
    const rows = await prisma.attachment.findMany({
      select: { id: true, fileName: true },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      scanned++;
      const better = fixLatin1Utf8(row.fileName);
      if (better === row.fileName) continue;
      fixed++;
      console.log(`${dryRun ? '[DRY-RUN] ' : ''}${row.id}: "${row.fileName}" → "${better}"`);
      if (!dryRun)
        await prisma.attachment.update({ where: { id: row.id }, data: { fileName: better } });
    }
    cursor = rows[rows.length - 1].id;
  }
} finally {
  await prisma.$disconnect();
}
console.log(
  `\nĐã duyệt ${scanned} tệp đính kèm, ${dryRun ? 'sẽ sửa' : 'đã sửa'} ${fixed} tên${dryRun ? ' (dry-run — chưa ghi gì)' : ''}.`,
);
