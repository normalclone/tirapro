import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GUARD đổi tên Workspace -> Organization: trong mã nguồn (`apps/*​/src`, `packages/*​/src`, `apps/api/prisma` trừ `migrations/`,
 * `apps/api/scripts`, `apps/web/scripts`) không còn từ "workspace" (không phân biệt hoa thường) theo nghĩa tenant. Ngoại lệ chỉ nằm trong
 * `ALLOW` dưới đây, MỖI mục có lý do và (tuỳ chọn) mẫu dòng được phép — dòng khác trong cùng tệp vẫn bị chặn. Mục thừa (tệp không còn
 * khớp) cũng làm test đỏ, để danh sách không mục dần. Ngoài phạm vi quét có chủ đích: `package.json` (giao thức `workspace:*` của pnpm),
 * `pnpm-workspace.yaml`, `apps/api/Dockerfile` (cũng là pnpm), thư mục `prisma/migrations/*` (lịch sử, không sửa) và tài liệu cũ trong `docs/`.
 */
interface Allow {
  /** Đường dẫn từ gốc repo. */
  file: string;
  /** Chỉ các dòng khớp mẫu này được phép; bỏ trống = cả tệp. */
  lines?: RegExp;
  reason: string;
}

const LEGACY_CLAIM =
  'Claim JWT cũ `workspaceId` của access token đã cấp trước khi đổi tên: còn được nhận tới hết 2026-12-05 rồi gỡ.';
const OLD_SCHEMA =
  'Spec dựng DB ở trạng thái TRƯỚC khi đổi tên (áp migration cũ hơn rồi nạp dữ liệu bằng SQL) nên phải dùng tên bảng/cột lịch sử.';

const ALLOW: Allow[] = [
  {
    file: 'apps/api/src/modules/auth/token.service.ts',
    lines: /workspaceId/,
    reason: LEGACY_CLAIM,
  },
  {
    file: 'apps/api/src/modules/auth/token.service.spec.ts',
    lines: /workspaceId|CŨ|cũ/,
    reason: `${LEGACY_CLAIM} (test)`,
  },
  {
    file: 'apps/api/src/modules/auth/strategies/jwt.strategy.spec.ts',
    lines: /workspaceId|cũ|CŨ/,
    reason: `${LEGACY_CLAIM} (test)`,
  },
  {
    file: 'apps/api/src/modules/realtime/realtime.gateway.ts',
    lines: /workspaceId/,
    reason: LEGACY_CLAIM,
  },
  {
    file: 'apps/api/src/modules/realtime/realtime.gateway.spec.ts',
    lines: /workspaceId/,
    reason: `${LEGACY_CLAIM} (test)`,
  },
  {
    file: 'apps/api/src/config/env.validation.ts',
    lines: /AI_MONTHLY_TOKEN_QUOTA_PER_WORKSPACE/,
    reason: 'Tên biến môi trường cũ vẫn được đọc (env prod chưa đổi tên); gỡ sau 2026-12-05.',
  },
  {
    file: 'apps/api/src/config/configuration.ts',
    lines: /AI_MONTHLY_TOKEN_QUOTA_PER_WORKSPACE/,
    reason: 'Tên biến môi trường cũ vẫn được đọc (env prod chưa đổi tên); gỡ sau 2026-12-05.',
  },
  {
    file: 'apps/api/prisma/seed.ts',
    reason:
      'Bước đổi tên di sản khoá quyền `workspace:*` / vai trò `Workspace *` TRƯỚC khi upsert theo tên mới (không sinh bản trùng).',
  },
  {
    file: 'apps/api/scripts/seed-system-roles.mjs',
    reason:
      'Bước đổi tên di sản khoá quyền `workspace:*` / vai trò `Workspace *` TRƯỚC khi upsert theo tên mới (không sinh bản trùng).',
  },
  { file: 'apps/api/src/modules/programs/menu-regroup.migration.int-spec.ts', reason: OLD_SCHEMA },
  {
    file: 'apps/api/src/modules/programs/personal-groups.migration.int-spec.ts',
    reason: OLD_SCHEMA,
  },
  {
    file: 'apps/api/src/modules/saved-filters/saved-filter-shares.migration.int-spec.ts',
    reason: OLD_SCHEMA,
  },
  {
    file: 'apps/api/src/modules/organizations/organization-rename.migration.int-spec.ts',
    reason: 'Chính spec của migration đổi tên: nạp dữ liệu theo tên cũ rồi kiểm tên mới.',
  },
  {
    file: 'apps/web/src/app/router.tsx',
    lines: /'workspaces'|Workspace -> Organization/,
    reason:
      'Đường dẫn cũ `/admin/workspaces` chuyển hướng sang `/admin/organizations` (dấu trang đã lưu).',
  },
  {
    file: 'apps/web/src/app/adminOrganizationsRedirect.test.ts',
    reason: 'Test của đường chuyển hướng `/admin/workspaces` cũ.',
  },
];

const ROOT = join(__dirname, '..', '..', '..', '..');
const SCAN_ROOTS = [
  ...['apps', 'packages']
    .filter((d) => existsSync(join(ROOT, d)))
    .flatMap((d) => readdirSync(join(ROOT, d)).map((p) => join(d, p, 'src'))),
  'apps/api/prisma',
  'apps/api/scripts',
  'apps/web/scripts',
].filter((d) => existsSync(join(ROOT, d)));

const EXT = /\.(ts|tsx|js|mjs|cjs|json|prisma|sql|css|html|md)$/;
const SELF = 'apps/api/src/common/no-workspace-term.spec.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name === 'migrations') continue;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (EXT.test(name) && rel !== SELF) out.push(rel);
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const root of SCAN_ROOTS)
    for (const file of walk(root))
      readFileSync(join(ROOT, file), 'utf8')
        .split('\n')
        .forEach((text, i) => {
          if (/workspace/i.test(text)) hits.push({ file: relative('.', file), line: i + 1, text });
        });
  return hits;
}

describe('không còn khái niệm "workspace" trong mã (đã đổi thành Organization / tổ chức)', () => {
  const hits = scan();

  it('mọi dòng có "workspace" đều nằm trong allowlist có lý do', () => {
    const bad = hits.filter((h) => {
      const a = ALLOW.find((x) => x.file === h.file);
      return !a || (a.lines !== undefined && !a.lines.test(h.text));
    });
    expect(bad.map((h) => `${h.file}:${h.line}: ${h.text.trim().slice(0, 100)}`)).toEqual([]);
  });

  it('allowlist không có mục thừa: tệp phải còn tồn tại và còn đúng dòng được phép', () => {
    const stale = ALLOW.filter(
      (a) => !hits.some((h) => h.file === a.file && (!a.lines || a.lines.test(h.text))),
    );
    expect(stale.map((a) => a.file)).toEqual([]);
    for (const a of ALLOW) expect(a.reason.length).toBeGreaterThan(20);
  });
});
