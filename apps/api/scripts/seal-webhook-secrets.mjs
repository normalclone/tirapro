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
 * Thuật toán phải khớp telegram.service.ts: AES-256-GCM, khoá = sha256(secret), "iv:tag:ciphertext" hex;
 * tiền tố phải khớp webhook-secret.ts (WEBHOOK_SECRET_PREFIX).
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const PREFIX = 'enc:v1:';
const dryRun = process.argv.includes('--dry-run');
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

const isWebhook = (a) => !!a && typeof a === 'object' && a.type === 'webhook';

const prisma = new PrismaClient();
const stats = { sealed: 0, already: 0, none: 0, skipped: 0 };
try {
  const rows = await prisma.automationRule.findMany({
    select: { id: true, actions: true, updatedAt: true },
  });
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
    `${dryRun ? '[dry-run] ' : ''}mã hoá mới: ${stats.sealed} · đã mã hoá sẵn: ${stats.already} · không có khoá: ${stats.none} · bỏ qua (xung đột): ${stats.skipped}`,
  );
  if (stats.skipped > 0) process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
