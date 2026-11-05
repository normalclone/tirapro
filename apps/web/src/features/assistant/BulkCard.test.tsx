// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistantBulkAssignRowInput } from '@tirapro/types';
import type { Block } from './blocks';
import { BulkCard, BulkCardView, type BulkBlock } from './BulkCard';
import {
  initialAssignState,
  initialMemberState,
  type AssignCard,
  type AssignState,
  type BulkOutcome,
  type MemberCard,
  type MemberState,
} from './bulkPreview';
import type { BulkExecutor } from './bulkRun';

afterEach(cleanup);

const P = (id: string, name: string, email: string) => ({ id, name, email });
const LINH = P('u-linh', 'Phạm Linh', 'linh@x.vn');
const T1 = P('u-t1', 'Nguyễn Thị Thuỷ', 'thuy.nguyen@x.vn');
const T2 = P('u-t2', 'Lê Thủy', 'thuy.le@x.vn');
const row = (n: number, over: Record<string, unknown> = {}) => ({
  issueId: `i${n}`,
  key: `DEMO-${n}`,
  summary: `Việc số ${n}`,
  version: n,
  projectId: 'p1',
  projectKey: 'DEMO',
  current: null,
  points: null,
  allowed: true as boolean | undefined,
  ...over,
});
const assignCard = (over: Partial<AssignCard> = {}): AssignCard => ({
  kind: 'assign',
  rows: [row(1), row(2), row(3)],
  slots: [{ query: 'Linh', person: LINH, options: null }],
  unmatched: [],
  modes: ['one', 'round-robin', 'points'],
  defaultMode: 'one',
  loads: {},
  filterNotes: ['dự án DEMO', 'chưa giao cho ai'],
  filterJql: 'project = "DEMO" AND assignee IS EMPTY ORDER BY key ASC',
  truncated: false,
  missingKeys: [],
  notes: [],
  problems: [],
  ...over,
});
const memberCard = (over: Partial<MemberCard> = {}): MemberCard => ({
  kind: 'add-member',
  slots: [{ query: 'Linh', person: LINH, options: null }],
  unmatched: [],
  projects: [
    { id: 'p1', key: 'DEMO', name: 'Demo', isPrivate: false, allowed: true, members: {} },
    { id: 'p2', key: 'ZED', name: 'Zed', isPrivate: false, allowed: false, members: {} },
  ],
  groupName: null,
  adminRoleIds: [],
  actor: { id: 'u-me', orgAdmin: false },
  roles: [
    { id: 'r-dev', name: 'Developer' },
    { id: 'r-tester', name: 'Tester' },
  ],
  defaultRole: { id: 'r-tester', source: 'parsed', query: 'Tester' },
  info: [],
  notes: [],
  problems: [],
  ...over,
});
const block = (card: AssignCard | MemberCard, over: Partial<BulkBlock> = {}): BulkBlock => ({
  type: 'bulk',
  card,
  status: 'pending',
  ...over,
});

/** Khung giữ state như container thật (View là controlled). */
function Harness({
  b,
  onConfirm = vi.fn(),
  onUndo = vi.fn(),
}: {
  b: BulkBlock;
  onConfirm?: () => void;
  onUndo?: () => void;
}) {
  const [a, setA] = useState<AssignState | null>(() =>
    b.card.kind === 'assign' ? initialAssignState(b.card) : null,
  );
  const [m, setM] = useState<MemberState | null>(() =>
    b.card.kind !== 'assign' ? initialMemberState(b.card) : null,
  );
  return (
    <BulkCardView
      block={b}
      assign={a ? { state: a, set: setA } : null}
      member={m ? { state: m, set: setM } : null}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
      onUndo={onUndo}
    />
  );
}
const confirmBtn = () =>
  screen.getByRole<HTMLButtonElement>('button', {
    name: /^(Giao \d+|Đặt vai trò cho \d+|Gỡ \d+)/,
  });

describe('BulkCardView — giao việc', () => {
  it('hiện bộ lọc + JQL, từng việc kèm người nhận hiện tại, và người nhận LUÔN kèm email', () => {
    render(
      <Harness
        b={block(assignCard({ rows: [row(1, { current: P('u-an', 'An Nguyễn', 'an@x.vn') })] }))}
      />,
    );
    expect(screen.getByText('Bộ lọc: dự án DEMO')).toBeTruthy();
    expect(screen.getByText(/JQL: project = "DEMO"/)).toBeTruthy();
    expect(screen.getByText('Hiện: An Nguyễn (an@x.vn)')).toBeTruthy();
    expect(
      within(screen.getByLabelText('Tóm tắt người nhận')).getByText(/Phạm Linh \(linh@x\.vn\)/),
    ).toBeTruthy();
    expect(confirmBtn().disabled).toBe(false);
    expect(confirmBtn().textContent).toBe('Giao 1 việc');
  });

  it('TÊN MƠ HỒ: Xác nhận bị khoá + lý do; hiện cả hai người kèm email; chọn một mới mở khoá', () => {
    const onConfirm = vi.fn();
    render(
      <Harness
        onConfirm={onConfirm}
        b={block(assignCard({ slots: [{ query: 'Thuỷ', person: null, options: [T1, T2] }] }))}
      />,
    );
    expect(confirmBtn().disabled).toBe(true);
    fireEvent.click(confirmBtn());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('“Thuỷ” khớp 2 người — chọn một:')).toBeTruthy();
    expect(screen.getByText('thuy.nguyen@x.vn')).toBeTruthy();
    expect(screen.getByText('thuy.le@x.vn')).toBeTruthy();
    expect(
      within(screen.getByLabelText('Chưa xác nhận được vì')).getByText(/Chọn người cho: “Thuỷ”/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Lê Thủy/ }));
    expect(confirmBtn().disabled).toBe(false);
    fireEvent.click(confirmBtn());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Chưa xác nhận được vì')).toBeNull();
  });

  it('lỗi chặn (cặp trùng việc) và tên không thấy cũng khoá Xác nhận', () => {
    render(
      <Harness
        b={block(
          assignCard({ problems: ['DEMO-1 được nêu cho hai người khác nhau'], unmatched: ['Zzz'] }),
        )}
      />,
    );
    expect(confirmBtn().disabled).toBe(true);
    expect(screen.getByText('DEMO-1 được nêu cho hai người khác nhau')).toBeTruthy();
    expect(screen.getByText('Không thấy người “Zzz” trong tổ chức.')).toBeTruthy();
  });

  it('dòng không đủ quyền hiện "Không đủ quyền" và không tính vào nút; chuyển cách chia cập nhật ngay', () => {
    const card = assignCard({
      rows: [row(1), row(2), row(3, { allowed: false, projectKey: 'ZED' })],
      slots: [
        { query: 'Linh', person: LINH, options: null },
        { query: 'An', person: P('u-an', 'An Nguyễn', 'an@x.vn'), options: null },
      ],
      defaultMode: 'round-robin',
    });
    render(<Harness b={block(card)} />);
    expect(screen.getByText('Không đủ quyền')).toBeTruthy();
    expect(confirmBtn().textContent).toBe('Giao 2 việc');
    expect(screen.getByText(/Phạm Linh \(linh@x\.vn\)/).parentElement!.textContent).toContain(
      '1 việc',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Một người' }));
    expect(screen.getByText(/Phạm Linh \(linh@x\.vn\)/).parentElement!.textContent).toContain(
      '2 việc',
    );
  });

  it('cảnh báo: danh sách bị cắt, mã không thấy, ghi chú số bị bỏ qua', () => {
    render(
      <Harness
        b={block(
          assignCard({
            truncated: true,
            missingKeys: ['DEMO-9'],
            notes: ['Mình bỏ qua số 15 vì không nối với danh sách mã (không phải mã việc).'],
          }),
        )}
      />,
    );
    expect(screen.getByText(/Còn nhiều việc hơn trang kết quả đầu tiên/)).toBeTruthy();
    expect(
      screen.getByText(/Không thấy \(sai mã hoặc bạn không có quyền xem\): DEMO-9/),
    ).toBeTruthy();
    expect(screen.getByText(/bỏ qua số 15/)).toBeTruthy();
  });
});

describe('BulkCardView — thành viên', () => {
  it('chưa có vai trò → Xác nhận khoá; có vai trò (từ lệnh) → mở; dòng không đủ quyền hiện rõ; tên + email từng người', () => {
    const noRole = memberCard({ defaultRole: { id: null, source: 'none' } });
    const { unmount } = render(<Harness b={block(noRole)} />);
    expect(confirmBtn().disabled).toBe(true);
    expect(screen.getByText('Chọn vai trò cho người được thêm.')).toBeTruthy();
    expect(screen.getByText('Lệnh không nêu vai trò — hãy chọn.')).toBeTruthy();
    unmount();
    render(<Harness b={block(memberCard())} />);
    expect(confirmBtn().disabled).toBe(false);
    expect(confirmBtn().textContent).toBe('Đặt vai trò cho 1 dòng');
    expect(screen.getByText('Lấy từ lệnh “Tester”.')).toBeTruthy();
    expect(screen.getAllByText('Phạm Linh (linh@x.vn)').length).toBe(2); // một dòng mỗi dự án
    expect(screen.getByText('Không đủ quyền')).toBeTruthy();
    expect(screen.getByText('Bạn không phải quản trị của dự án ZED.')).toBeTruthy();
  });

  it('bỏ dòng làm nút đếm lại; hết dòng thì khoá; "Lấy lại" khôi phục', () => {
    render(<Harness b={block(memberCard())} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ dòng Phạm Linh DEMO' }));
    expect(screen.getByText('Không có dòng nào cần ghi.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^Đặt vai trò cho 0 dòng$/ }).hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Lấy lại dòng Phạm Linh DEMO' }));
    expect(confirmBtn().disabled).toBe(false);
  });

  it('gỡ: nói rõ chỉ gỡ được vai trò riêng và dòng không có gì để gỡ', () => {
    const card = memberCard({
      kind: 'remove-member',
      roles: [],
      defaultRole: { id: null, source: 'none' },
      slots: [
        { query: 'Linh', person: LINH, options: null },
        { query: 'An', person: P('u-an', 'An', 'an@x.vn'), options: null },
      ],
      projects: [
        {
          id: 'p1',
          key: 'DEMO',
          name: 'Demo',
          isPrivate: false,
          allowed: true,
          members: {
            'u-linh': { roleIds: ['r-dev'], roleNames: ['Developer'], isOverride: false },
            'u-an': { roleIds: ['r-tester'], roleNames: ['Tester'], isOverride: true },
          },
        },
      ],
    });
    render(<Harness b={block(card)} />);
    expect(screen.getByText(/Chỉ gỡ được vai trò riêng của dự án/)).toBeTruthy();
    expect(
      screen.getByText(
        /Không có vai trò riêng để gỡ — người này vẫn thuộc dự án theo vai trò mặc định/,
      ),
    ).toBeTruthy();
    expect(confirmBtn().textContent).toBe('Gỡ 1 dòng');
  });
});

const OUTCOME: BulkOutcome = {
  title: 'Đã giao 2 việc (bỏ qua 1)',
  counts: { ok: 2, skipped: 1, failed: 0 },
  rows: [
    { label: 'DEMO-1 · Việc 1', detail: '→ Phạm Linh', status: 'ok' },
    { label: 'DEMO-2 · Việc 2', detail: '→ Phạm Linh', status: 'ok' },
    {
      label: 'DEMO-3 · Việc 3',
      detail: '→ Phạm Linh',
      status: 'skipped',
      reason: 'Việc đã được sửa sau lúc xem trước — mình không ghi đè.',
    },
  ],
  undo: {
    kind: 'assign',
    rows: [{ issueId: 'i1', version: 2, assigneeId: null }],
    labels: { i1: 'DEMO-1' },
  },
};

describe('BulkCardView — kết quả + Hoàn tác', () => {
  it('đã xong: tiêu đề, từng dòng kèm lý do bỏ qua, nút Hoàn tác (không còn Xác nhận)', () => {
    const onUndo = vi.fn();
    render(
      <Harness onUndo={onUndo} b={block(assignCard(), { status: 'done', outcome: OUTCOME })} />,
    );
    expect(screen.getByText('Đã giao 2 việc (bỏ qua 1)')).toBeTruthy();
    expect(
      screen.getByText('Việc đã được sửa sau lúc xem trước — mình không ghi đè.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Giao \d+/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
  it('không có gì đã đổi → không có nút Hoàn tác', () => {
    render(
      <Harness b={block(assignCard(), { status: 'done', outcome: { ...OUTCOME, undo: null } })} />,
    );
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
  });
  it('đang hoàn tác: nút khoá; đã hoàn tác: nêu số dòng + dòng bị sửa sau đó, hết nút', () => {
    const undoing = render(
      <Harness b={block(assignCard(), { status: 'undoing', outcome: OUTCOME })} />,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Hoàn tác' }).disabled).toBe(true);
    undoing.unmount();
    render(
      <Harness
        b={block(assignCard(), {
          status: 'undone',
          outcome: OUTCOME,
          undoOutcome: {
            title: 'Đã hoàn tác 1 dòng (bỏ qua 1 — đã bị sửa sau đó nên không đụng vào)',
            counts: { ok: 1, skipped: 1, failed: 0 },
            undo: null,
            rows: [
              {
                label: 'DEMO-2',
                detail: '→ người phụ trách cũ',
                status: 'skipped',
                reason: 'Việc đã được sửa',
              },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText(/Đã hoàn tác 1 dòng/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
  });
  it('đã bỏ / bị ngắt giữa chừng: chỉ có chữ, không có nút nào để chạy lại', () => {
    const c = render(<Harness b={block(assignCard(), { status: 'cancelled' })} />);
    expect(screen.getByText('Đã bỏ lệnh này.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    c.unmount();
    render(<Harness b={block(assignCard(), { status: 'interrupted' })} />);
    expect(screen.getByText(/Mình không tự chạy lại/)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
  it('lỗi gọi máy chủ: hiện lý do và cho xác nhận lại', () => {
    render(<Harness b={block(assignCard(), { status: 'failed', error: 'Mất kết nối.' })} />);
    expect(screen.getByRole('alert').textContent).toContain('Mất kết nối.');
    expect(confirmBtn().disabled).toBe(false);
  });
});

/* ------------------------------ container ------------------------------ */

function mount(initial: BulkBlock, executor: BulkExecutor) {
  const patches: Array<Record<string, unknown>> = [];
  function Host() {
    const [b, setB] = useState<BulkBlock>(initial);
    return (
      <BulkCard
        messageId="m1"
        block={b}
        executor={executor}
        patch={(a) => {
          patches.push(a);
          setB((cur) => ({
            ...cur,
            status: a.status,
            outcome: a.outcome ?? cur.outcome,
            undoOutcome: a.undoOutcome ?? cur.undoOutcome,
            error: a.error,
          }));
        }}
      />
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Host />
    </QueryClientProvider>,
  );
  return patches;
}
const okAssign = (rows: AssistantBulkAssignRowInput[]) =>
  Promise.resolve({
    results: rows.map((r) => ({
      issueId: r.issueId,
      key: null,
      status: 'ok' as const,
      previousAssigneeId: 'old',
      assigneeId: r.assigneeId,
      version: r.version + 1,
    })),
  });

describe('BulkCard (container) — xác nhận / hoàn tác', () => {
  it('Xác nhận gọi máy chủ ĐÚNG MỘT LẦN (bấm đúp không chạy hai lần), hiện kết quả, rồi Hoàn tác gửi đúng yêu cầu đảo ngược', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const assign = vi.fn(async (rows: AssistantBulkAssignRowInput[]) => {
      await gate;
      return okAssign(rows);
    });
    const executor: BulkExecutor = { assign, members: vi.fn() };
    const patches = mount(block(assignCard()), executor);
    const btn = confirmBtn();
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(patches.map((p) => p.status)).toEqual(['running']);
    await act(() => {
      release();
      return Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('Đã giao 3 việc')).toBeTruthy());
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0]![0]).toEqual([
      { issueId: 'i1', version: 1, assigneeId: 'u-linh' },
      { issueId: 'i2', version: 2, assigneeId: 'u-linh' },
      { issueId: 'i3', version: 3, assigneeId: 'u-linh' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    await waitFor(() => expect(screen.getByText(/Đã hoàn tác 3 dòng/)).toBeTruthy());
    expect(assign).toHaveBeenCalledTimes(2);
    expect(assign.mock.calls[1]![0]).toEqual([
      { issueId: 'i1', version: 2, assigneeId: 'old' },
      { issueId: 'i2', version: 3, assigneeId: 'old' },
      { issueId: 'i3', version: 4, assigneeId: 'old' },
    ]);
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
  });

  it('lỗi gọi máy chủ → thẻ "failed" kèm lý do; không có kết quả giả', async () => {
    const executor: BulkExecutor = {
      assign: vi.fn(() => Promise.reject(new Error('Mất mạng'))),
      members: vi.fn(),
    };
    const patches = mount(block(assignCard()), executor);
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(patches.at(-1)).toMatchObject({ status: 'failed' });
    expect(screen.queryByText(/Đã giao/)).toBeNull();
  });

  it('Hoàn tác lỗi mạng → quay về "done" để bấm lại được', async () => {
    const assign = vi
      .fn<(rows: AssistantBulkAssignRowInput[]) => ReturnType<typeof okAssign>>()
      .mockImplementationOnce(okAssign)
      .mockRejectedValueOnce(new Error('Mất mạng'))
      .mockImplementation(okAssign);
    mount(block(assignCard()), { assign, members: vi.fn() });
    fireEvent.click(confirmBtn());
    await waitFor(() => screen.getByText('Đã giao 3 việc'));
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Hoàn tác' }).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    await waitFor(() => screen.getByText(/Đã hoàn tác 3 dòng/));
  });

  it('thẻ thành viên: Xác nhận gọi API thành viên (không phải API giao việc)', async () => {
    const members = vi.fn(
      (
        rows: Array<{
          projectId: string;
          userId: string;
          expect: string[] | null;
          set: string[] | null;
        }>,
      ) =>
        Promise.resolve({
          results: rows.map((r) => ({
            projectId: r.projectId,
            userId: r.userId,
            status: 'ok' as const,
            before: r.expect,
            after: r.set,
          })),
        }),
    );
    const assign = vi.fn();
    mount(block(memberCard()), { assign, members });
    fireEvent.click(confirmBtn());
    await waitFor(() => screen.getByText(/Đã đặt vai trò cho 1 dòng/));
    expect(assign).not.toHaveBeenCalled();
    expect(members.mock.calls[0]![0]).toEqual([
      { projectId: 'p1', userId: 'u-linh', expect: null, set: ['r-tester'] },
    ]);
  });
});

describe('kiểu Block', () => {
  it('khối bulk nằm trong union Block', () => {
    const b: Block = block(assignCard());
    expect(b.type).toBe('bulk');
  });
});

describe('M3 — lỗi giữa chừng / bị ngắt: tải lại xem trước từ trạng thái máy chủ', () => {
  it('Xác nhận lỗi mạng → gọi onRefresh với thông báo "có thể đã áp dụng một phần … không có Hoàn tác"', async () => {
    const onRefresh = vi.fn(() => Promise.resolve(true));
    const executor: BulkExecutor = {
      assign: vi.fn(() => Promise.reject(new Error('Mất mạng'))),
      members: vi.fn(),
    };
    function Host() {
      const [b, setB] = useState<BulkBlock>(block(assignCard(), { raw: 'giao DEMO-1 cho Linh' }));
      return (
        <QueryClientProvider client={new QueryClient()}>
          <BulkCard
            messageId="m1"
            block={b}
            executor={executor}
            onRefresh={onRefresh}
            patch={(a) => setB((cur) => ({ ...cur, status: a.status, error: a.error }))}
          />
        </QueryClientProvider>
      );
    }
    render(<Host />);
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    const notice = (onRefresh.mock.calls[0] as unknown as [string])[0];
    expect(notice).toContain('Mất mạng');
    expect(notice).toContain('Có thể đã áp dụng một phần — đã tải lại xem trước');
    expect(notice).toContain('không có Hoàn tác');
  });
  it('thẻ có thông báo hiện thông báo; thẻ bị ngắt có nút "Tải lại xem trước" (chỉ khi có câu lệnh gốc + onRefresh)', () => {
    const withNotice = render(
      <Harness
        b={block(assignCard(), { notice: 'Có thể đã áp dụng một phần — đã tải lại xem trước.' })}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('Có thể đã áp dụng một phần');
    withNotice.unmount();
    const onRefresh = vi.fn();
    render(
      <BulkCardView
        block={block(assignCard(), { status: 'interrupted', raw: 'giao DEMO-1 cho Linh' })}
        assign={null}
        member={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onUndo={vi.fn()}
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByText(/không có Hoàn tác/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại xem trước' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
  it('bị ngắt mà không có câu lệnh gốc → không có nút', () => {
    render(<Harness b={block(assignCard(), { status: 'interrupted' })} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('M1 — dòng bị chặn hiện rõ trên thẻ', () => {
  it('"Bị chặn" kèm lý do; không tính vào nút', () => {
    const card = memberCard({
      kind: 'remove-member',
      roles: [{ id: 'r-admin', name: 'Project Admin' }],
      adminRoleIds: ['r-admin'],
      actor: { id: 'u-linh', orgAdmin: false },
      defaultRole: { id: null, source: 'none' },
      projects: [
        {
          id: 'p1',
          key: 'DEMO',
          name: 'Demo',
          isPrivate: false,
          allowed: true,
          members: {
            'u-linh': { roleIds: ['r-admin'], roleNames: ['Project Admin'], isOverride: true },
          },
        },
      ],
    });
    render(<Harness b={block(card)} />);
    expect(screen.getByText('Bị chặn')).toBeTruthy();
    expect(screen.getByText(/tự bỏ quyền quản trị của chính mình/)).toBeTruthy();
    expect(screen.getByText('Không có dòng nào cần ghi.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Gỡ 0 dòng$/ }).hasAttribute('disabled')).toBe(true);
  });
});
