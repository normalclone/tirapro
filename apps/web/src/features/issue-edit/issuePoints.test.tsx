import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { mk } from '@/lib/issueFixture';
import { keys } from '@/lib/queryKeys';

// renderToStaticMarkup đọc "trạng thái khởi tạo" của zustand → thay kho bằng bản chỉ-đọc-state (như roleMatrixTable.test).
vi.mock('@/stores/auth', () => {
  let state: Record<string, unknown> = {
    user: { id: 'u', isSystemAdmin: false },
    permissions: [],
  };
  const useAuth = Object.assign(<T,>(sel: (s: Record<string, unknown>) => T) => sel(state), {
    setState: (p: Record<string, unknown>) => {
      state = { ...state, ...p };
    },
    getState: () => state,
  });
  return { useAuth };
});
import { useAuth } from '@/stores/auth';
import { IssueDifficultyInline, IssueStoryPointsInline } from './IssueProperties';

const src = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');
/** Source không kể chú thích (// và /* *\/) — để kiểm cấm một đoạn mã mà chú thích vẫn nhắc tới. */
const code = (rel: string) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const EXPLAIN = 'Bug · Khó · High = 2×3×1.5 = 9';

function html(issue: IssueDto, o: { admin: boolean; others?: IssueDto[] }) {
  useAuth.setState({ user: { id: 'u', isSystemAdmin: o.admin } as never, permissions: [] });
  const qc = new QueryClient();
  qc.setQueryData(keys.issues.byProject(issue.projectId), [issue, ...(o.others ?? [])]);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <IssueStoryPointsInline issue={issue} />
    </QueryClientProvider>,
  );
}

const bug = (o: Partial<IssueDto> = {}) =>
  mk('b', { storyPoints: 9, pointsExplain: EXPLAIN, ...o });

describe('điểm trên trang việc: chỉ Quản trị dự án chỉnh tay', () => {
  it('người không có project:admin: không có nút sửa, tooltip là lời giải thích điểm (có dấu "=")', () => {
    const h = html(bug(), { admin: false });
    expect(h).not.toContain('<button');
    expect(h).toContain('9 điểm');
    expect(h).toContain(`title="${EXPLAIN}"`);
    expect(h).toContain('=');
  });
  it('người không có quyền cũng không thấy "Tính lại theo công thức" dù việc đã chỉnh tay', () => {
    const h = html(bug({ pointsManual: true }), { admin: false });
    expect(h).toContain('đã chỉnh tay');
    expect(h).not.toContain('Tính lại theo công thức');
  });
  it('Quản trị dự án: bấm để chỉnh tay (nút điểm có tooltip giải thích)', () => {
    const h = html(bug(), { admin: true });
    expect(h).toMatch(/<button[^>]*title="Bug · Khó · High = 2×3×1.5 = 9 Bấm để chỉnh tay\."/);
    expect(h).not.toContain('Tính lại theo công thức');
    expect(h).not.toContain('đã chỉnh tay');
  });
  it('Quản trị dự án + điểm đã chỉnh tay: có chữ "đã chỉnh tay" và nút "Tính lại theo công thức"', () => {
    const h = html(bug({ pointsManual: true }), { admin: true });
    expect(h).toContain('đã chỉnh tay');
    expect(h).toMatch(/<button[^>]*>Tính lại theo công thức<\/button>/);
  });
  it('việc cha có việc con: chỉ đọc kể cả với Quản trị, tooltip "Tổng điểm việc con", không có nút reset', () => {
    const child = mk('c', { parentId: 'b', storyPoints: 4 });
    const h = html(bug({ pointsManual: true }), { admin: true, others: [child] });
    expect(h).not.toContain('<button');
    expect(h).toContain('Tổng điểm việc con');
    expect(h).not.toContain('Tính lại theo công thức');
  });
  it('Epic: chỉ đọc, tooltip tổng điểm các việc trong Epic', () => {
    const h = html(mk('e', { t: 'epic', storyPoints: 12 }), { admin: true });
    expect(h).not.toContain('<button');
    expect(h).toContain('Tổng điểm các việc trong Epic');
  });
  it('nguồn: web không bao giờ gửi storyPoints: null, chỉ gửi giá trị đã qua parsePointsOverride', () => {
    const s = code('IssueProperties.tsx');
    expect(s).not.toMatch(/storyPoints:\s*null/);
    expect(s).toContain('parsePointsOverride');
    expect(s).toContain('useResetPoints');
  });
});

describe('độ khó trên trang việc', () => {
  function diff(issue: IssueDto, admin: boolean) {
    useAuth.setState({
      user: { id: 'u', isSystemAdmin: admin } as never,
      permissions: admin ? ['issue:edit'] : [],
    });
    return renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <IssueDifficultyInline issue={issue} />
      </QueryClientProvider>,
    );
  }
  it('hiện nhãn tiếng Việt của độ khó hiện tại; người chỉ xem không có nút đổi', () => {
    const h = diff(mk('d', { difficulty: 'VERY_HARD' }), false);
    expect(h).toContain('Rất khó');
    expect(h).not.toContain('<button');
  });
  it('người sửa được: có nút chọn độ khó', () => {
    const h = diff(mk('d', { difficulty: 'EASY' }), true);
    expect(h).toContain('Dễ');
    expect(h).toContain('aria-label="Độ khó"');
  });
});

describe('nối vào giao diện (đọc source)', () => {
  it('ô Sprint của việc con bị khoá với lời giải thích "Việc con đi theo sprint của việc cha"', () => {
    expect(src('IssueProperties.tsx')).toMatch(/!canEdit \|\| issue\.parentId/);
    expect(src('IssueProperties.tsx')).toContain('CHILD_SPRINT_TIP');
    expect(src('../issues/CreateIssueModal.tsx')).toContain('CHILD_SPRINT_TIP');
  });
});

describe('hộp Tạo việc: Độ khó thay ô điểm', () => {
  const modal = code('../issues/CreateIssueModal.tsx');
  it('độ khó mặc định "Trung bình" (MEDIUM), có ô chọn "Độ khó"', () => {
    expect(modal).toContain("useState<Difficulty>('MEDIUM')");
    expect(modal).toContain('Độ khó');
  });
  it('không còn ô nhập điểm và không gửi storyPoints khi tạo', () => {
    expect(modal).not.toMatch(/storyPoints/);
    expect(modal).not.toMatch(/Điểm ước lượng/);
    expect(modal).not.toMatch(/id="ci-points"/);
  });
});
