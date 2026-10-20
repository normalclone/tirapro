import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keys } from '@/lib/queryKeys';
import { AudiencePanel } from './AudiencePanel';
import { CopyLinkRow } from './CopyLinkRow';
import { SharePanel } from './SharePanel';
import {
  DASHBOARD_COPY,
  DASHBOARD_SHARE_KINDS,
  FILTER_COPY,
  FILTER_SHARE_KINDS,
} from './shareModel';
import type { ShareValue } from './shareModel';

// renderToStaticMarkup đọc "trạng thái khởi tạo" của zustand → thay kho bằng bản chỉ-đọc-state như permissions.test.ts.
vi.mock('@/stores/auth', () => {
  let state: Record<string, unknown> = {};
  const useAuth = Object.assign(<T,>(sel: (s: Record<string, unknown>) => T) => sel(state), {
    setState: (p: Record<string, unknown>) => {
      state = { ...state, ...p };
    },
  });
  return { useAuth };
});
import { useAuth } from '@/stores/auth';

const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');

const user = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `u${i}`,
  email: `u${i}@x.test`,
  displayName: `Người ${i}`,
  avatarUrl: null,
  status: 'ACTIVE',
  ...extra,
});
const people = (n: number) => Array.from({ length: n }, (_, i) => user(i + 1));
const project = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  key: id.toUpperCase(),
  name: `Dự án ${id}`,
  isArchived: false,
  isPrivate: false,
  ...over,
});

function seed() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(keys.workspaces.mine, [
    { id: 'w1', name: 'W', slug: 'w', avatarUrl: null, roleName: 'Admin', memberCount: 25 },
  ]);
  qc.setQueryData(keys.projects.withArchived, [
    project('pub'),
    project('sec', { isPrivate: true }),
    project('old', { isArchived: true }),
  ]);
  qc.setQueryData(keys.teams.all, [
    { id: 't1', name: 'Web', lead: user(1), members: people(8), memberCount: 8 },
    { id: 't2', name: 'Mobile', lead: null, members: [user(1)], memberCount: 1 },
  ]);
  qc.setQueryData(keys.members.project('sec'), [
    ...people(7).map((u) => ({ membershipId: `m${u.id}`, user: u, roles: [] })),
  ]);
  return qc;
}
const wrap = (node: React.ReactNode, qc = seed()) =>
  renderToStaticMarkup(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
const val = (over: Partial<ShareValue> = {}): ShareValue => ({
  scope: 'PRIVATE',
  projectId: '',
  teamId: '',
  ...over,
});

beforeEach(() => {
  useAuth.setState({
    workspaceId: 'w1',
    user: user(1) as never,
    can: (perm: string) => perm === 'workspace:admin',
  });
});

describe('AudiencePanel — ai có quyền', () => {
  it('PRIVATE: "Chỉ bạn", không avatar', () => {
    const h = wrap(<AudiencePanel value={val()} />);
    expect(h).toContain('Ai có quyền xem');
    expect(h).toContain('Chỉ bạn');
    expect(h).not.toContain('<img');
  });
  it('GLOBAL: "Mọi thành viên không gian (N)" lấy từ memberCount của không gian đang dùng', () => {
    expect(wrap(<AudiencePanel value={val({ scope: 'GLOBAL' })} />)).toContain(
      'Mọi thành viên không gian (25)',
    );
  });
  it('TEAM: 5 avatar + "+N" (trang trí, ẩn khỏi trình đọc) + MỘT câu sr-only liệt kê tên', () => {
    const h = wrap(<AudiencePanel value={val({ scope: 'TEAM', teamId: 't1' })} />);
    expect(h).toContain('Thành viên nhóm Web (8)');
    expect(
      h.match(/aria-hidden="true"[^>]*title=|title="[^"]*"[^>]*aria-hidden="true"/g),
    ).toBeNull(); // avatar decorative → không tooltip
    expect(h).toContain('+3');
    expect(h.match(/class="sr-only"/g)?.length).toBe(1);
    expect(h).toContain('Gồm Người 1, Người 2, Người 3, Người 4, Người 5 và 3 người khác.');
  });
  it('PROJECT công khai: mọi thành viên không gian; riêng tư: danh sách thành viên dự án', () => {
    const pub = wrap(<AudiencePanel value={val({ scope: 'PROJECT', projectId: 'pub' })} />);
    expect(pub).toContain('Mọi thành viên không gian (25)');
    expect(pub).toContain('công khai');
    const sec = wrap(<AudiencePanel value={val({ scope: 'PROJECT', projectId: 'sec' })} />);
    expect(sec).toContain('Thành viên dự án Dự án sec (7)');
    expect(sec).toContain('Dự án riêng tư: chỉ thành viên dự án thấy.');
    expect(sec).toContain('+2');
  });
  it('chỉ gọi danh sách thành viên dự án khi dự án RIÊNG TƯ (dự án công khai không cần)', () => {
    const s = src('AudiencePanel.tsx');
    expect(s).toMatch(/useProjectMembers\(/);
    expect(s).toMatch(/isPrivate/);
  });
  it('API cũ chưa có memberCount → không in "(undefined)"', () => {
    const qc = seed();
    qc.setQueryData(keys.workspaces.mine, [
      { id: 'w1', name: 'W', slug: 'w', avatarUrl: null, roleName: 'Admin' },
    ]);
    const h = wrap(<AudiencePanel value={val({ scope: 'GLOBAL' })} />, qc);
    expect(h).toContain('Mọi thành viên không gian');
    expect(h).not.toMatch(/undefined|NaN|\(\)/);
  });
});

describe('CopyLinkRow — liên kết trong ứng dụng, nói đúng sự thật', () => {
  it('nút "Sao chép liên kết" + câu nói rõ liên kết không cấp thêm quyền', () => {
    const h = wrap(<CopyLinkRow url="https://x.test/dashboards/d1" unsavedChange={false} />);
    expect(h).toContain('Sao chép liên kết');
    expect(h).toContain('Liên kết chỉ mở được với người có quyền xem ở trên.');
    expect(h).not.toMatch(/công khai|bất kỳ ai|mọi người có liên kết/i);
    expect(h).not.toContain('Thay đổi');
  });
  it('mức chia sẻ đang chọn chưa lưu → nhắc: có hiệu lực sau khi lưu', () => {
    const h = wrap(<CopyLinkRow url="https://x.test/f" unsavedChange />);
    expect(h).toContain('Mức chia sẻ mới chỉ có hiệu lực sau khi bạn lưu.');
  });
  it('sao chép bằng useCopyToClipboard (không gọi clipboard trực tiếp)', () => {
    const s = src('CopyLinkRow.tsx');
    expect(s).toContain('useCopyToClipboard');
    expect(s).not.toContain('navigator.clipboard');
  });
});

describe('SharePanel', () => {
  const base = { onChange: () => undefined, link: undefined };
  it('bảng tổng quan: 4 mức; bộ lọc: 3 mức (không có nhóm)', () => {
    const d = wrap(
      <SharePanel {...base} value={val()} kinds={DASHBOARD_SHARE_KINDS} copy={DASHBOARD_COPY} />,
    );
    expect(d.match(/role="radio"/g)?.length).toBe(4);
    expect(d).toContain('Thành viên nhóm…');
    const f = wrap(
      <SharePanel {...base} value={val()} kinds={FILTER_SHARE_KINDS} copy={FILTER_COPY} />,
    );
    expect(f.match(/role="radio"/g)?.length).toBe(3);
    expect(f).not.toContain('Thành viên nhóm…');
    expect(f).toContain('Chỉ bạn xem được bộ lọc này.');
    expect(d).toContain('Chỉ bạn xem được bảng tổng quan này.');
  });
  it('chọn "theo dự án": ô chọn dự án không có dự án đã lưu trữ; ghi chú dự án riêng tư', () => {
    const h = wrap(
      <SharePanel
        {...base}
        value={val({ scope: 'PROJECT', projectId: 'sec' })}
        kinds={FILTER_SHARE_KINDS}
        copy={FILTER_COPY}
      />,
    );
    expect(h).toContain('Dự án được chia sẻ');
    expect(h).toContain('Dự án riêng tư: chỉ thành viên dự án thấy.');
    expect(h).not.toContain('Dự án old');
  });
  it('khối "Ai có quyền" luôn hiện ngay dưới các mức', () => {
    const h = wrap(
      <SharePanel
        {...base}
        value={val({ scope: 'GLOBAL' })}
        kinds={FILTER_SHARE_KINDS}
        copy={FILTER_COPY}
      />,
    );
    expect(h.indexOf('Ai có quyền xem')).toBeGreaterThan(h.indexOf('role="radiogroup"'));
  });
  it('"Sao chép liên kết" chỉ hiện khi đã lưu (có `link`); chưa lưu thì không', () => {
    const none = wrap(
      <SharePanel {...base} value={val()} kinds={DASHBOARD_SHARE_KINDS} copy={DASHBOARD_COPY} />,
    );
    expect(none).not.toContain('Sao chép liên kết');
    const saved = val({ scope: 'GLOBAL' });
    const withLink = wrap(
      <SharePanel
        {...base}
        value={saved}
        kinds={DASHBOARD_SHARE_KINDS}
        copy={DASHBOARD_COPY}
        link={{ url: 'https://x.test/dashboards/d1', saved }}
      />,
    );
    expect(withLink).toContain('Sao chép liên kết');
    expect(withLink).not.toContain('chỉ có hiệu lực sau khi bạn lưu');
    const changed = wrap(
      <SharePanel
        {...base}
        value={val({ scope: 'PRIVATE' })}
        kinds={DASHBOARD_SHARE_KINDS}
        copy={DASHBOARD_COPY}
        link={{ url: 'https://x.test/dashboards/d1', saved }}
      />,
    );
    expect(changed).toContain('Mức chia sẻ mới chỉ có hiệu lực sau khi bạn lưu.');
  });
  it('chỉ đọc (không phải chủ): không có bộ chọn mức, chỉ có ai-có-quyền + liên kết + câu giải thích', () => {
    const v = val({ scope: 'GLOBAL' });
    const h = wrap(
      <SharePanel
        {...base}
        value={v}
        kinds={FILTER_SHARE_KINDS}
        copy={FILTER_COPY}
        readOnly
        link={{ url: 'https://x.test/filters/f1', saved: v }}
      />,
    );
    expect(h).not.toContain('role="radiogroup"');
    expect(h).toContain('Mọi thành viên không gian (25)');
    expect(h).toContain('Sao chép liên kết');
    expect(h).toContain('Chỉ người tạo bộ lọc mới đổi được phạm vi chia sẻ.');
  });
  it('lỗi hợp lệ được đọc (role=alert)', () => {
    const h = wrap(
      <SharePanel
        {...base}
        value={val({ scope: 'PROJECT' })}
        kinds={FILTER_SHARE_KINDS}
        copy={FILTER_COPY}
        error="Chọn dự án để chia sẻ"
      />,
    );
    expect(h).toMatch(/role="alert"[^>]*>Chọn dự án để chia sẻ/);
  });
});

describe('không có liên kết công khai', () => {
  it('không có token/liên kết ẩn danh trong mã chia sẻ', () => {
    for (const f of [
      'SharePanel.tsx',
      'SharePicker.tsx',
      'AudiencePanel.tsx',
      'CopyLinkRow.tsx',
      'shareModel.ts',
      'audience.ts',
    ]) {
      expect(src(f), f).not.toMatch(/shareToken|publicLink|anyone with|ai có liên kết/i);
    }
  });
});
