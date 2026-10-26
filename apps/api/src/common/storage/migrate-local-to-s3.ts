import { extname } from 'node:path';
import {
  ObjectNotFoundError,
  assertSafeKey,
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
  return /^[\w.-]+$/.test(file) && !file.startsWith('..') ? `avatars/${file}` : null;
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
  failed: number;
  dryRun: boolean;
  missingKeys: string[];
  failedKeys: string[];
}

/**
 * Sao chép các khoá từ `source` (đĩa) sang `dest` (S3). Idempotent: bỏ qua object đã có CÙNG kích thước.
 * Không xoá nguồn. Một khoá lỗi không dừng cả mẻ. `dryRun` chỉ đếm, không ghi.
 */
export async function migrateObjects(opts: {
  source: ObjectStorage;
  dest: ObjectStorage;
  keys: string[];
  dryRun: boolean;
  /** Content-Type theo khoá (vd mimeType của Attachment); khoá không có thì đoán theo đuôi. */
  contentTypes?: ReadonlyMap<string, string>;
  onProgress?: (done: number, total: number) => void;
}): Promise<MigrateReport> {
  const report: MigrateReport = {
    total: opts.keys.length,
    copied: 0,
    skipped: 0,
    missing: 0,
    failed: 0,
    dryRun: opts.dryRun,
    missingKeys: [],
    failedKeys: [],
  };
  let done = 0;
  for (const key of opts.keys) {
    try {
      assertSafeKey(key);
      const src = await opts.source.stat(key);
      if (!src) {
        report.missing++;
        report.missingKeys.push(key);
      } else {
        const existing = await opts.dest.stat(key);
        if (existing && existing.size === src.size) {
          report.skipped++;
        } else if (opts.dryRun) {
          report.copied++;
        } else {
          const got = await opts.source.get(key);
          const body = await streamToBuffer(got.stream);
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
      }
    }
    opts.onProgress?.(++done, report.total);
  }
  return report;
}
