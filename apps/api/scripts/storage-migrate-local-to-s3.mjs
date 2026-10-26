/**
 * Tirapro — chuyển tệp từ đĩa cục bộ (STORAGE_LOCAL_DIR) lên bucket S3/MinIO.
 * Đọc mọi khoá tệp mà DB đang tham chiếu (đính kèm, ảnh đại diện của người dùng / không gian / dự án) cộng `system-settings.json`,
 * rồi sao chép từ đĩa lên bucket. Định dạng khoá giữ nguyên nên đây chỉ là sao chép.
 *
 *   pnpm --filter @tirapro/api run storage:migrate-local-to-s3 -- --dry-run   # chỉ báo cáo, không ghi
 *   pnpm --filter @tirapro/api run storage:migrate-local-to-s3                # sao chép thật
 *   pnpm --filter @tirapro/api run storage:migrate-local-to-s3 -- --force     # ghi đè cả khi bản S3 MỚI hơn bản local (cẩn thận)
 *   docker run --rm --env-file .env <image> node scripts/storage-migrate-local-to-s3.mjs --dry-run
 *
 * Cần: DATABASE_URL, STORAGE_LOCAL_DIR (thư mục tệp cũ), S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY
 * (S3_REGION, S3_FORCE_PATH_STYLE tuỳ chọn). Cần `pnpm --filter @tirapro/api build` trước (script dùng mã đã biên dịch ở dist/).
 *
 * - Idempotent: bỏ qua object đã có cùng kích thước (tệp bất biến) hoặc cùng NỘI DUNG sha256 (`system-settings.json`) ⇒ chạy lại
 *   bao nhiêu lần cũng được. Thứ tự cắt chuyển: DỪNG API → chạy script lần cuối → đổi STORAGE_DRIVER=s3 → khởi động API.
 * - KHÔNG bao giờ ghi đè object S3 MỚI hơn bản local và khác nội dung (đếm là "xung đột") trừ khi có --force.
 * - KHÔNG xoá tệp local, KHÔNG tạo bucket (thiếu bucket ⇒ dừng và báo).
 * - Thoát 0 khi không có lỗi/xung đột; 2 nếu còn tệp lỗi hoặc xung đột; 1 nếu cấu hình sai / không tới được bucket.
 * - Tệp phân tích import Jira (`imports/`, giữ tối đa 1 giờ) cố ý KHÔNG chuyển.
 */
import { PrismaClient } from '@prisma/client';

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const env = process.env;

const missing = [
  'DATABASE_URL',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
].filter((k) => !(env[k] ?? '').trim());
if (missing.length) {
  console.error(`Thiếu biến môi trường: ${missing.join(', ')} — đặt đủ rồi chạy lại.`);
  process.exit(1);
}
const localDir = env.STORAGE_LOCAL_DIR || './uploads';
if ((env.STORAGE_DRIVER ?? '').trim() === 's3') {
  console.warn(
    'CẢNH BÁO: STORAGE_DRIVER=s3 trong môi trường này — API có thể đang ghi trực tiếp lên bucket. ' +
      'Thứ tự đúng: dừng API → chạy script lần cuối (với STORAGE_DRIVER chưa đổi) → đổi driver → khởi động API.',
  );
}

let LocalStorage, S3Storage, collectKeys, migrateObjects;
try {
  ({ LocalStorage } = await import('../dist/common/storage/local-storage.js'));
  ({ S3Storage } = await import('../dist/common/storage/s3-storage.js'));
  ({ collectKeys, migrateObjects } = await import('../dist/common/storage/migrate-local-to-s3.js'));
} catch (err) {
  console.error(
    `Không nạp được mã đã biên dịch (dist/): ${err.message}\nChạy \`pnpm --filter @tirapro/api build\` trước.`,
  );
  process.exit(1);
}

const dest = new S3Storage({
  endpoint: env.S3_ENDPOINT.trim(),
  region: env.S3_REGION || 'us-east-1',
  bucket: env.S3_BUCKET.trim(),
  accessKey: env.S3_ACCESS_KEY,
  secretKey: env.S3_SECRET_KEY,
  forcePathStyle: !['false', '0'].includes(String(env.S3_FORCE_PATH_STYLE ?? 'true')),
});
const source = new LocalStorage(localDir);

const health = await dest.check();
if (!health.ok) {
  console.error(`Bucket chưa dùng được: ${health.detail}`);
  process.exit(1);
}

const prisma = new PrismaClient();
let report;
try {
  const [attachments, users, workspaces, projects] = await Promise.all([
    prisma.attachment.findMany({ select: { storageKey: true, mimeType: true } }),
    prisma.user.findMany({ where: { avatarUrl: { not: null } }, select: { avatarUrl: true } }),
    prisma.workspace.findMany({ where: { avatarUrl: { not: null } }, select: { avatarUrl: true } }),
    prisma.project.findMany({ where: { avatarUrl: { not: null } }, select: { avatarUrl: true } }),
  ]);
  const keys = collectKeys({
    attachmentKeys: attachments.map((a) => a.storageKey),
    avatarUrls: [...users, ...workspaces, ...projects].map((r) => r.avatarUrl),
  });
  const contentTypes = new Map(attachments.map((a) => [a.storageKey, a.mimeType]));
  console.log(
    `${dryRun ? '[DRY-RUN] ' : ''}Chuyển ${keys.length} khoá từ "${localDir}" lên bucket "${env.S3_BUCKET.trim()}"…`,
  );
  report = await migrateObjects({
    source,
    dest,
    keys,
    dryRun,
    force,
    contentTypes,
    onProgress: (done, total) => {
      if (done % 100 === 0 || done === total) console.log(`  ${done}/${total}`);
    },
  });
} finally {
  await prisma.$disconnect();
}

console.log(
  `\nKết quả${dryRun ? ' (dry-run — chưa ghi gì)' : ''}: ` +
    `${dryRun ? 'sẽ chép' : 'đã chép'} ${report.copied}, bỏ qua (đã có cùng kích thước) ${report.skipped}, ` +
    `thiếu trên đĩa ${report.missing}, xung đột (S3 mới hơn, không ghi đè) ${report.conflicts}, lỗi ${report.failed}.`,
);
if (report.missingKeys.length)
  console.log(
    `Thiếu trên đĩa (DB có tham chiếu nhưng không thấy tệp — thường là tệp đã mất từ trước hoặc system-settings.json chưa từng tạo):\n  ` +
      report.missingKeys.slice(0, 50).join('\n  ') +
      (report.missingKeys.length > 50 ? `\n  … và ${report.missingKeys.length - 50} khoá nữa` : ''),
  );
if (report.conflictKeys.length)
  console.error(
    `Xung đột — object trên S3 MỚI hơn bản local và khác nội dung nên KHÔNG bị ghi đè (kiểm tra tay; chắc chắn muốn đè thì chạy lại với --force):\n  ` +
      report.conflictKeys.slice(0, 50).join('\n  '),
  );
if (report.failures.length)
  console.error(
    `Lỗi (chạy lại script để thử lại các khoá này):\n  ` +
      report.failures
        .slice(0, 50)
        .map((f) => `${f.key} — ${f.cause}`)
        .join('\n  '),
  );
process.exit(report.failed > 0 || report.conflicts > 0 ? 2 : 0);
