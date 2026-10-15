/**
 * Tirapro — mã hoá lại botToken của tích hợp Telegram bằng khoá hiện tại.
 * Dùng sau khi đổi INTEGRATION_ENCRYPTION_KEY: đặt khoá cũ vào INTEGRATION_ENCRYPTION_KEY_PREVIOUS,
 * chạy script này một lần, sau đó có thể bỏ INTEGRATION_ENCRYPTION_KEY_PREVIOUS.
 *
 *   node apps/api/scripts/rekey-integrations.mjs --dry-run   # chỉ báo cáo
 *   node apps/api/scripts/rekey-integrations.mjs             # ghi vào DB
 *
 * Cần DATABASE_URL, INTEGRATION_ENCRYPTION_KEY (và INTEGRATION_ENCRYPTION_KEY_PREVIOUS nếu có khoá cũ).
 * Thuật toán phải khớp telegram.service.ts: AES-256-GCM, khoá = sha256(secret), định dạng "iv:tag:ciphertext" hex.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const dryRun = process.argv.includes('--dry-run');
const current = process.env.INTEGRATION_ENCRYPTION_KEY ?? '';
const previous = process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS ?? '';
if (current.length < 32) {
  console.error(
    'Thiếu INTEGRATION_ENCRYPTION_KEY (tối thiểu 32 ký tự) — hãy đặt biến này rồi chạy lại.',
  );
  process.exit(1);
}

const derive = (secret) => createHash('sha256').update(secret).digest();

function tryDecrypt(enc, secret) {
  const [iv, tag, data] = enc.split(':');
  try {
    const d = createDecipheriv('aes-256-gcm', derive(secret), Buffer.from(iv, 'hex'));
    d.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(data, 'hex')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function encrypt(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', derive(current), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

const prisma = new PrismaClient();
const stats = { ok: 0, rekeyed: 0, plaintext: 0, failed: 0 };
try {
  const rows = await prisma.integration.findMany({
    where: { type: 'TELEGRAM' },
    select: { id: true, config: true },
  });
  for (const row of rows) {
    const cfg =
      row.config && typeof row.config === 'object' && !Array.isArray(row.config) ? row.config : {};
    const token = typeof cfg.botToken === 'string' ? cfg.botToken : '';
    if (!token) continue;
    if (token.split(':').length !== 3) {
      stats.plaintext++; // dữ liệu cũ lưu plaintext — encrypt() ở API sẽ mã hoá khi người dùng nhập lại
      continue;
    }
    if (tryDecrypt(token, current) !== null) {
      stats.ok++;
      continue;
    }
    const plain = previous.length >= 32 ? tryDecrypt(token, previous) : null;
    if (plain === null) {
      stats.failed++;
      console.error(
        `Tích hợp ${row.id}: không giải mã được bằng khoá hiện tại lẫn khoá cũ — cần nhập lại token.`,
      );
      continue;
    }
    if (!dryRun) {
      await prisma.integration.update({
        where: { id: row.id },
        data: { config: { ...cfg, botToken: encrypt(plain) } },
      });
    }
    stats.rekeyed++;
  }
  console.log(
    `${dryRun ? '[dry-run] ' : ''}đã đúng khoá: ${stats.ok} · mã hoá lại: ${stats.rekeyed} · plaintext cũ: ${stats.plaintext} · không giải được: ${stats.failed}`,
  );
  if (stats.failed > 0) process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
