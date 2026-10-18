import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_LABELS,
  APP_NAV_LABELS,
  CONNECT_LABELS,
  MANAGE_LABELS,
  PROJECT_CONFIG_LABELS,
  SETTINGS_LABELS,
} from './navLabels';
import { hits } from './terminology.test';

/**
 * Bộ C (UX_CONVENTIONS §19 + đợt 1 UI): nút huỷ, tên menu = tiêu đề trang, chữ chỉ hướng, "Project ID", "dashboard".
 * Dùng `hits()` của bộ A/B (bỏ dòng comment).
 */
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('thuật ngữ — bộ C', () => {
  it('nút huỷ viết "Huỷ", không viết "Hủy"', () => {
    expect(hits(/\bHủy\b/)).toEqual([]);
    expect(hits(/Huỷ/).length).toBeGreaterThan(20); // đối chứng: chuẩn vẫn đang được dùng
  });

  it('không còn "Project ID" hiển thị (dùng "Dự án")', () => {
    expect(hits(/Project ID/)).toEqual([]);
  });

  it('không còn tiêu đề trang cũ lệch tên menu', () => {
    const old =
      /title="(Độ ưu tiên|Mức độ nghiêm trọng|Trường tuỳ chỉnh)"|Cấu hình quy trình|API (&|&amp;) MCP/;
    expect(hits(old)).toEqual([]);
  });

  it('không còn "Trường tuỳ chỉnh" (mọi cách gõ dấu: tuỳ / tùy / dạng tổ hợp) — dùng "Trường thông tin thêm"', () => {
    expect(hits(/Trường t[uù]\p{M}*[yỳ]\p{M}*\s*ch(ỉ|i\p{M}*)nh/iu)).toEqual([]);
  });

  it('không còn "bên trái"/"cột trái" trong chữ hiển thị của features/ (sai trên mobile, nơi rail nằm trên nội dung)', () => {
    // Bỏ chú thích JSX `{/* … */}` (hits chỉ bỏ dòng comment thuần). Hiện không có ngoại lệ desktop-only nào.
    const found = hits(/(bên|cột) trái/, (l) => !/\{\/\*/.test(l)).filter((x) =>
      x.startsWith('features/'),
    );
    expect(found).toEqual([]);
  });

  it('không còn "dashboard" trong chữ hiển thị (dùng "bảng tổng quan")', () => {
    // Chỉ xét nội dung chuỗi ("…", '…', `…` bỏ phần ${…}) và chữ JSX `>…<`.
    // Cho phép: từ khoá tìm của Cmd+K (`value="…"`) và ROUTE_CATALOG.keywords (một từ không khoảng trắng),
    // khoá cache / route (`/dashboards/…`, `dashboard:manage`: không có khoảng trắng), log kỹ thuật `console.*`.
    const isUi = (l: string) => !/value="|console\.|queryKey|import /.test(l);
    const found = hits(/./, (raw) => {
      if (!isUi(raw)) return false;
      const line = raw.replace(/\$\{[^}]*\}/g, '#');
      const pieces = [...line.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`|>([^<>{}]+)</g)].map(
        (m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? '',
      );
      return pieces.some(
        (t) => /dashboard/i.test(t) && (/\s/.test(t.trim()) || /^Dashboard/.test(t)),
      );
    });
    expect([...new Set(found)]).toEqual([]);
  });

  it('nhóm phím tắt dùng "Trên bảng việc", không "Trên board"', () => {
    expect(hits(/Trên board/)).toEqual([]);
  });
});

describe('một nguồn nhãn (lib/navLabels.ts)', () => {
  it('sidebar, thanh tab, ROUTE_CATALOG và sub-nav đều import nhãn từ navLabels', () => {
    for (const f of [
      'components/layout/navItems.tsx',
      'lib/routeSuggest.ts',
      'features/settings/SettingsLayout.tsx',
      'features/manage/ManageLayout.tsx',
      'features/connect/ConnectLayout.tsx',
    ]) {
      expect(src(f), f).toMatch(/from '@\/lib\/navLabels'/);
    }
  });

  const pageTitles: [string, string, string][] = [
    [
      'features/workspace/WorkspaceBrandingPanel.tsx',
      'SETTINGS_LABELS.general',
      SETTINGS_LABELS.general,
    ],
    ['features/settings/RolesPage.tsx', 'SETTINGS_LABELS.roles', SETTINGS_LABELS.roles],
    [
      'features/workflow-settings/WorkflowSettingsPage.tsx',
      'SETTINGS_LABELS.workflows',
      SETTINGS_LABELS.workflows,
    ],
    [
      'features/settings-admin/PrioritiesSection.tsx',
      'SETTINGS_LABELS.priorities',
      SETTINGS_LABELS.priorities,
    ],
    [
      'features/settings/SeveritySection.tsx',
      'SETTINGS_LABELS.severities',
      SETTINGS_LABELS.severities,
    ],
    [
      'features/settings-admin/CustomFieldsAdminSection.tsx',
      'SETTINGS_LABELS.fields',
      SETTINGS_LABELS.fields,
    ],
    ['features/sla/SlaPage.tsx', 'SETTINGS_LABELS.responseTime', SETTINGS_LABELS.responseTime],
    ['features/import/ImportPage.tsx', 'SETTINGS_LABELS.import', SETTINGS_LABELS.import],
    ['features/api-keys/ApiKeysPage.tsx', 'SETTINGS_LABELS.api', SETTINGS_LABELS.api],
    ['features/goals/GoalsPage.tsx', 'MANAGE_LABELS.goals', MANAGE_LABELS.goals],
    ['features/resources/ResourcesPage.tsx', 'MANAGE_LABELS.resources', MANAGE_LABELS.resources],
    ['features/clients/ClientsPage.tsx', 'MANAGE_LABELS.clients', MANAGE_LABELS.clients],
    ['features/members/MembersPage.tsx', 'APP_NAV_LABELS.members', APP_NAV_LABELS.members],
    ['features/wiki/WikiPage.tsx', 'APP_NAV_LABELS.wiki', APP_NAV_LABELS.wiki],
    ['features/connect/ConnectLayout.tsx', 'APP_NAV_LABELS.connect', APP_NAV_LABELS.connect],
    [
      'features/integrations/IntegrationsPage.tsx',
      'CONNECT_LABELS.integrations',
      CONNECT_LABELS.integrations,
    ],
    [
      'features/issue-fields/CustomFieldsPanel.tsx',
      'SETTINGS_LABELS.fields',
      SETTINGS_LABELS.fields,
    ],
    ['features/admin/AdminOverviewPage.tsx', 'ADMIN_LABELS.overview', ADMIN_LABELS.overview],
    ['features/admin/AdminConfigPage.tsx', 'ADMIN_LABELS.config', ADMIN_LABELS.config],
  ];
  it.each(pageTitles)('%s dùng %s làm tiêu đề trang', (file, ref, label) => {
    expect(label.length).toBeGreaterThan(0);
    expect(src(file)).toContain(ref);
  });

  it('nhãn khớp nhãn menu đã chốt (không đổi chữ menu)', () => {
    expect(SETTINGS_LABELS.workflows).toBe('Quy trình');
    expect(SETTINGS_LABELS.priorities).toBe('Mức ưu tiên');
    expect(SETTINGS_LABELS.fields).toBe('Trường thông tin thêm');
    expect(SETTINGS_LABELS.api).toBe('API & kết nối lập trình');
    expect(ADMIN_LABELS.config).toBe('Cấu hình');
    expect(CONNECT_LABELS.integrations).toBe('Ứng dụng bên ngoài');
    expect(PROJECT_CONFIG_LABELS.general).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* D8b: "Hệ thống" thay "Ai đó", không lộ enum, vai trò tiếng Việt, ngày */
/* ------------------------------------------------------------------ */

/** Quét `*.ts(x)` không phải test dưới một thư mục (đường dẫn tương đối từ `apps/web/src`, hoặc tuyệt đối). */
function walkFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== 'node_modules' && f !== 'dist') walkFiles(p, out);
    } else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}
const isTestFile = (f: string) => /\.(test|spec)\.tsx?$/.test(f);

describe('"Hệ thống" thay "Ai đó"', () => {
  it('không còn "Ai đó" trong apps/web/src và packages/shared/src (spec chỉ được giữ nếu khẳng định nó KHÔNG xuất hiện)', () => {
    const roots = [join(__dirname, '..'), join(__dirname, '../../../../packages/shared/src')];
    const bad = roots.flatMap((root) =>
      walkFiles(root)
        .filter((f) => !f.endsWith('terminology2.test.ts')) // file này nêu chuỗi để cấm
        .filter((f) => {
          const text = readFileSync(f, 'utf8');
          if (!text.includes('Ai đó')) return false;
          // Spec/test được phép nhắc tới chuỗi chỉ khi có khẳng định vắng mặt.
          return !(isTestFile(f) && /not\.(toContain|toMatch)\(\s*['/]Ai đó/.test(text));
        }),
    );
    expect(bad).toEqual([]);
  });
});

describe('không lộ tên enum/trường thô trên giao diện', () => {
  it('feed hoạt động dự án không in `{a.field}` thô', () => {
    expect(src('features/intake/ProjectActivityPage.tsx')).not.toMatch(/\{a\.field\}/);
  });
  it('nhánh mặc định của describeActivity không nội suy `a.field`', () => {
    expect(src('features/activity/activityFilters.ts')).not.toMatch(/\$\{a\.field\}/);
  });
  it('feed hoạt động dự án: "kết quả xử lý" thay "resolution", có icon Timer cho ghi thời gian', () => {
    const t = src('features/intake/ProjectActivityPage.tsx');
    expect(t).not.toMatch(/>resolution</);
    expect(t).toMatch(/case 'TIME_SPENT'/);
    expect(t).toMatch(/Timer/);
  });
});

describe('vai trò hiển thị bằng tiếng Việt (roleLabel)', () => {
  it.each([
    ['features/workspace/WorkspaceSwitcher.tsx', /roleLabel\(ws\.roleName\)/],
    ['features/issue-edit/useAssigneeOptions.ts', /roleNames\.map\(roleLabel\)/],
    ['features/quick-filters/AssigneeFilter.tsx', /label: roleLabel\(r\)/],
    ['features/members/AddPeopleDialog.tsx', /label: roleLabel\(n\)/],
    ['features/members/AddPeopleDialog.tsx', /\{roleLabel\(r\)\}/],
  ])('%s dịch tên vai trò qua roleLabel', (file, re) => {
    expect(src(file)).toMatch(re);
  });
  it('không còn in `{ws.roleName}` thô', () => {
    expect(hits(/\{ws\.roleName\}/)).toEqual([]);
  });
});

describe('định dạng ngày/tháng thống nhất (lib/dateFormat.ts)', () => {
  // Dòng chỉ hiển thị ngày: bỏ chú thích; lib/dateFormat.ts là nơi duy nhất được dựng mẫu.
  const notDateLib = (l: string) => !/import /.test(l);
  const inDisplayCode = (re: RegExp) =>
    hits(re, notDateLib).filter((x) => x !== undefined && !x.startsWith('lib/dateFormat.ts'));

  it('không còn nhãn tháng tự dựng `T${…}` hay "thg"', () => {
    expect(inDisplayCode(/`T\$\{/)).toEqual([]);
    expect(inDisplayCode(/\bthg\b/)).toEqual([]);
  });
  it('không còn `toLocaleString(` trong features/', () => {
    expect(hits(/toLocaleString\(/).filter((x) => x.startsWith('features/'))).toEqual([]);
  });
  it("không còn date-fns `format(…, 'dd/MM…')` tự viết — dùng fmtDate/fmtDayMonth/fmtDateTime", () => {
    const found = hits(/\bformat\([^)]*['"]dd\/MM/).filter(
      (x) => !x.startsWith('lib/dateFormat.ts'),
    );
    expect(found).toEqual([]);
  });
  it('không còn bản `shortDay`/`shortDate` tự viết (một nguồn: fmtDayMonth)', () => {
    expect(hits(/(function|const)\s+shortDay\b|function\s+shortDate\b/)).toEqual([]);
  });
  it('trục/tooltip biểu đồ Dòng chảy không còn ISO thô', () => {
    const t = src('features/reports/FlowTab.tsx');
    expect(t).toMatch(/tickFormatter=\{fmtDayMonth\}/);
    expect(t).toMatch(/labelFormatter=\{fmtDate\}/);
  });
});
