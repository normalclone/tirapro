/**
 * Tirapro — mã hoá khoá bí mật (HMAC) của webhook automation đang lưu dạng chữ thường.
 * Chạy MỘT lần sau khi nâng cấp lên bản mã hoá secret webhook. Không bắt buộc ngay: secret cũ (không tiền tố)
 * vẫn gửi được, và tự được mã hoá khi người dùng lưu lại quy tắc — script chỉ xử lý nốt phần còn lại.
 *
 *   node apps/api/scripts/seal-webhook-secrets.mjs --dry-run   # chỉ báo cáo
 *   node apps/api/scripts/seal-webhook-secrets.mjs             # ghi vào DB
 *
 * Idempotent: secret đã có tiền tố "enc:v1:" bị bỏ qua, chạy lại không mã hoá hai lần.
 * Cần DATABASE_URL + INTEGRATION_ENCRYPTION_KEY (tối thiểu 32 ký tự, cùng khoá với API).
 * Chống nhầm khoá: nếu DB đã có secret `enc:v1:` mà khoá hiện tại KHÔNG giải được, script dừng (exit 1) thay vì mã hoá
 * phần còn lại bằng một khoá lạ (không lấy lại được). `--force` bỏ qua kiểm tra này (chỉ khi chắc chắn).
 * Thuật toán phải khớp telegram.service.ts: AES-256-GCM, khoá = sha256(secret), "iv:tag:ciphertext" hex;
 * tiền tố phải khớp webhook-secret.ts (WEBHOOK_SECRET_PREFIX).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const PREFIX = 'enc:v1:';
const MAX_PLAIN = 200; // khớp WEBHOOK_SECRET_MAX_LENGTH (@tirapro/shared): dạng mã hoá của ≤200 ký tự luôn nằm trong giới hạn schema
const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const current = process.env.INTEGRATION_ENCRYPTION_KEY ?? '';
if (current.length < 32) {
  console.error(
    'Thiếu INTEGRATION_ENCRYPTION_KEY (tối thiểu 32 ký tự) — hãy đặt biến này rồi chạy lại.',
  );
  process.exit(1);
}

const derive = (secret) => createHash('sha256').update(secret).digest();

function encrypt(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', derive(current), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

function canDecrypt(payload) {
  try {
    const [iv, tag, data] = payload.split(':');
    const d = createDecipheriv('aes-256-gcm', derive(current), Buffer.from(iv, 'hex'));
    d.setAuthTag(Buffer.from(tag, 'hex'));
    Buffer.concat([d.update(Buffer.from(data, 'hex')), d.final()]);
    return true;
  } catch {
    return false;
  }
}

const isWebhook = (a) => !!a && typeof a === 'object' && a.type === 'webhook';

const prisma = new PrismaClient();
const stats = { sealed: 0, already: 0, none: 0, skipped: 0, tooLong: 0 };
try {
  const rows = await prisma.automationRule.findMany({
    select: { id: true, actions: true, updatedAt: true },
  });
  if (!force) {
    // Mẫu thử: một secret đã mã hoá sẵn phải giải được bằng khoá hiện tại, nếu không thì khoá trong shell khác khoá API đang dùng.
    const sample = rows
      .flatMap((r) => (Array.isArray(r.actions) ? r.actions : []))
      .find((a) => isWebhook(a) && typeof a.secret === 'string' && a.secret.startsWith(PREFIX));
    if (sample && !canDecrypt(sample.secret.slice(PREFIX.length))) {
      console.error(
        'INTEGRATION_ENCRYPTION_KEY hiện tại KHÔNG giải được secret đã mã hoá sẵn trong DB — có vẻ khác khoá API đang dùng. ' +
          'Dừng để tránh mã hoá bằng khoá lạ. Đặt đúng khoá (hoặc chạy integrations:rekey trước); dùng --force nếu chắc chắn.',
      );
      await prisma.$disconnect();
      process.exit(1);
    }
  }
  for (const row of rows) {
    if (!Array.isArray(row.actions)) continue;
    let changed = false;
    const actions = row.actions.map((a) => {
      if (!isWebhook(a)) return a;
      if (typeof a.secret !== 'string' || a.secret === '') {
        stats.none++;
        return a;
      }
      if (a.secret.startsWith(PREFIX)) {
        stats.already++;
        return a;
      }
      if (a.secret.length > MAX_PLAIN) {
        // Không thể xảy ra với dữ liệu tạo qua API (schema ≤200); bỏ qua thay vì tạo dạng vượt giới hạn schema.
        stats.tooLong++;
        console.error(
          `Quy tắc ${row.id}: khoá webhook dài ${a.secret.length} ký tự (> ${MAX_PLAIN}) — bỏ qua, hãy nhập lại khoá ngắn hơn.`,
        );
        return a;
      }
      stats.sealed++;
      changed = true;
      return { ...a, secret: PREFIX + encrypt(a.secret) };
    });
    if (!changed || dryRun) continue;
    // updatedAt làm khoá lạc quan: nếu người dùng vừa sửa quy tắc giữa lúc đọc và ghi thì bỏ qua (chạy lại là xong).
    const { count } = await prisma.automationRule.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: { actions },
    });
    if (count === 0) {
      stats.skipped++;
      console.error(`Quy tắc ${row.id} vừa bị sửa trong lúc chạy — bỏ qua, hãy chạy lại script.`);
    }
  }
  console.log(
    `${dryRun ? '[dry-run] ' : ''}mã hoá mới: ${stats.sealed} · đã mã hoá sẵn: ${stats.already} · không có khoá: ${stats.none} · bỏ qua (xung đột): ${stats.skipped} · quá dài: ${stats.tooLong}`,
  );
  if (stats.skipped > 0 || stats.tooLong > 0) process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
