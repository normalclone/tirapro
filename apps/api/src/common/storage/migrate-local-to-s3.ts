import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import {
  ObjectNotFoundError,
  assertSafeKey,
  causeMessage,
  streamToBuffer,
  type ObjectStorage,
} from './object-storage';

/** Khoá cờ hệ thống (SystemSettingsService). Không có trong DB nhưng cần sao chép nếu đã có trên đĩa. */
const SYSTEM_SETTINGS_KEY = 'system-settings.json';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json',
};

/** Khoá `avatars/<file>` từ URL ảnh đại diện của MediaService; URL ngoài hoặc lạ → null. */
export function avatarKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = '/media/avatars/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const file = url.slice(idx + marker.length).split(/[?#]/)[0] ?? '';
  return /^[\w.-]+$/.test(file) && !/^\.+$/.test(file) && !file.startsWith('..')
    ? `avatars/${file}`
    : null;
}

/** Gộp mọi khoá tệp mà DB đang tham chiếu (+ cờ hệ thống), bỏ trùng. */
export function collectKeys(input: {
  attachmentKeys: string[];
  avatarUrls: (string | null | undefined)[];
}): string[] {
  const set = new Set<string>([SYSTEM_SETTINGS_KEY]);
  for (const k of input.attachmentKeys) if (k) set.add(k);
  for (const u of input.avatarUrls) {
    const k = avatarKeyFromUrl(u);
    if (k) set.add(k);
  }
  return [...set];
}

export interface MigrateReport {
  total: number;
  copied: number;
  skipped: number;
  /** Khoá có trong DB nhưng không còn trên đĩa nguồn (vd `system-settings.json` chưa từng tạo). */
  missing: number;
  /** Đích MỚI hơn nguồn và khác nội dung → không ghi đè (cần `force` sau khi tự kiểm). */
  conflicts: number;
  failed: number;
  dryRun: boolean;
  missingKeys: string[];
  conflictKeys: string[];
  failedKeys: string[];
  /** Nguyên nhân từng khoá lỗi (đã làm sạch, không chứa khoá bí mật). */
  failures: { key: string; cause: string }[];
}

/** Tệp nhỏ CÓ THỂ ĐỔI sau khi tạo: so theo nội dung (sha256), không theo kích thước. */
const MUTABLE_KEYS = new Set([SYSTEM_SETTINGS_KEY]);

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function readBody(storage: ObjectStorage, key: string): Promise<Buffer> {
  return streamToBuffer((await storage.get(key)).stream);
}

/**
 * Sao chép các khoá từ `source` (đĩa) sang `dest` (S3). Idempotent. Không xoá nguồn. Một khoá lỗi không dừng cả mẻ.
 * - Tệp bất biến (đính kèm, ảnh): bỏ qua nếu đích đã có CÙNG kích thước.
 * - Tệp có thể đổi (`system-settings.json`): so theo NỘI DUNG (sha256).
 * - Khác nhau mà đích MỚI hơn nguồn ⇒ KHÔNG ghi đè (`conflicts`) trừ khi `force` — tránh đè bản S3 mới bằng bản local cũ.
 * - `dryRun` chỉ đếm, không ghi.
 */
export async function migrateObjects(opts: {
  source: ObjectStorage;
  dest: ObjectStorage;
  keys: string[];
  dryRun: boolean;
  /** Ghi đè cả khi đích mới hơn nguồn. */
  force?: boolean;
  /** Content-Type theo khoá (vd mimeType của Attachment); khoá không có thì đoán theo đuôi. */
  contentTypes?: ReadonlyMap<string, string>;
  onProgress?: (done: number, total: number) => void;
  /** Báo từng khoá với hành động (để dry-run in khoá đích). */
  onItem?: (key: string, action: 'copy' | 'skip' | 'conflict' | 'missing') => void;
}): Promise<MigrateReport> {
  const report: MigrateReport = {
    total: opts.keys.length,
    copied: 0,
    skipped: 0,
    missing: 0,
    conflicts: 0,
    failed: 0,
    dryRun: opts.dryRun,
    missingKeys: [],
    conflictKeys: [],
    failedKeys: [],
    failures: [],
  };
  let done = 0;
  for (const key of opts.keys) {
    try {
      assertSafeKey(key);
      const src = await opts.source.stat(key);
      if (!src) {
        report.missing++;
        report.missingKeys.push(key);
        opts.onItem?.(key, 'missing');
      } else {
        const existing = await opts.dest.stat(key);
        let body: Buffer | null = null;
        let action: 'copy' | 'skip' | 'conflict' = 'copy';
        if (existing) {
          let same = existing.size === src.size;
          if (MUTABLE_KEYS.has(key)) {
            body = await readBody(opts.source, key);
            same = sha256(body) === sha256(await readBody(opts.dest, key));
          }
          if (same) action = 'skip';
          else if (!opts.force && existing.lastModified.getTime() > src.lastModified.getTime())
            action = 'conflict';
        }
        opts.onItem?.(key, action);
        if (action === 'skip') {
          report.skipped++;
        } else if (action === 'conflict') {
          report.conflicts++;
          report.conflictKeys.push(key);
        } else if (opts.dryRun) {
          report.copied++;
        } else {
          body ??= await readBody(opts.source, key);
          await opts.dest.put(key, body, {
            contentType:
              opts.contentTypes?.get(key) ??
              MIME_BY_EXT[extname(key).toLowerCase()] ??
              'application/octet-stream',
            size: body.length,
          });
          report.copied++;
        }
      }
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        report.missing++;
        report.missingKeys.push(key);
      } else {
        report.failed++;
        report.failedKeys.push(key);
        report.failures.push({ key, cause: causeMessage(err) });
      }
    }
    opts.onProgress?.(++done, report.total);
  }
  return report;
}
