/**
 * Tirapro — mã hoá lại botToken của tích hợp Telegram và khoá bí mật webhook automation (enc:v1:) bằng khoá hiện tại.
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
const stats = { ok: 0, rekeyed: 0, plaintext: 0, failed: 0 }; // Telegram
const webhookStats = { ok: 0, rekeyed: 0, failed: 0 }; // khoá bí mật webhook automation
const WEBHOOK_PREFIX = 'enc:v1:'; // khớp webhook-secret.ts
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
    `${dryRun ? '[dry-run] ' : ''}Telegram — đã đúng khoá: ${stats.ok} · mã hoá lại: ${stats.rekeyed} · plaintext cũ: ${stats.plaintext} · không giải được: ${stats.failed}`,
  );

  // Khoá bí mật webhook automation: "enc:v1:" + ciphertext. Không tiền tố = plaintext cũ (chưa seal) → bỏ qua.
  const rules = await prisma.automationRule.findMany({
    select: { id: true, actions: true, updatedAt: true },
  });
  for (const rule of rules) {
    if (!Array.isArray(rule.actions)) continue;
    let changed = false;
    const actions = rule.actions.map((a) => {
      if (!a || typeof a !== 'object' || a.type !== 'webhook') return a;
      if (typeof a.secret !== 'string' || !a.secret.startsWith(WEBHOOK_PREFIX)) return a;
      const enc = a.secret.slice(WEBHOOK_PREFIX.length);
      if (tryDecrypt(enc, current) !== null) {
        webhookStats.ok++;
        return a;
      }
      const plain = previous.length >= 32 ? tryDecrypt(enc, previous) : null;
      if (plain === null) {
        webhookStats.failed++;
        console.error(
          `Quy tắc automation ${rule.id}: không giải mã được khoá bí mật webhook bằng khoá hiện tại lẫn khoá cũ — cần nhập lại khoá.`,
        );
        return a;
      }
      webhookStats.rekeyed++;
      changed = true;
      return { ...a, secret: WEBHOOK_PREFIX + encrypt(plain) };
    });
    if (changed && !dryRun) {
      const { count } = await prisma.automationRule.updateMany({
        where: { id: rule.id, updatedAt: rule.updatedAt },
        data: { actions },
      });
      if (count === 0) {
        webhookStats.failed++;
        console.error(
          `Quy tắc automation ${rule.id} vừa bị sửa trong lúc chạy — hãy chạy lại script.`,
        );
      }
    }
  }
  console.log(
    `${dryRun ? '[dry-run] ' : ''}webhook automation — đã đúng khoá: ${webhookStats.ok} · mã hoá lại: ${webhookStats.rekeyed} · không giải được: ${webhookStats.failed}`,
  );
  if (stats.failed > 0 || webhookStats.failed > 0) process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
