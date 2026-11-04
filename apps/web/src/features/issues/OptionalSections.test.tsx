// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { mk } from '@/lib/issueFixture';
import { LinksPanel } from '@/features/issue-widgets/LinksPanel';
import {
  AddSectionButton,
  OPTIONAL_SECTION_LABELS,
  OptionalSection,
  OptionalSectionsScope,
  sectionHasData,
  type OptionalSectionId,
} from './OptionalSections';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { useAuth } from '@/stores/auth';

const LABELS = Object.entries(OPTIONAL_SECTION_LABELS) as [OptionalSectionId, string][];

const BUG: IssueDto['type'] = {
  id: 'bt',
  name: 'Bug',
  key: 'BUG',
  iconUrl: null,
  color: null,
  hierarchyLevel: 0,
  isSubtask: false,
};

/** Một việc Bug trống ở mọi khối tuỳ chọn. */
const emptyBug = (o: Partial<IssueDto> = {}) =>
  mk('i1', {
    type: BUG,
    acceptanceCriteria: null,
    components: [],
    fixVersions: [],
    environment: null,
    ...o,
  });

interface Api {
  checklist: unknown[];
  links: unknown[];
  docs: unknown[];
}
function mockApi(a: Partial<Api> = {}) {
  const d: Api = { checklist: [], links: [], docs: [], ...a };
  h.get.mockImplementation((url: string) => {
    if (url.endsWith('/checklist')) return Promise.resolve({ data: d.checklist });
    if (url.endsWith('/links')) return Promise.resolve({ data: d.links });
    if (url.startsWith('/wiki/by-issue/')) return Promise.resolve({ data: d.docs });
    return Promise.reject(new Error(`offline ${url}`));
  });
}

function Harness({ issue }: { issue: IssueDto }) {
  return (
    <OptionalSectionsScope issue={issue}>
      {(s) => (
        <>
          {LABELS.map(([id, label]) => (
            <OptionalSection key={id} id={id} sections={s}>
              <h2>{`KHỐI ${label}`}</h2>
              <input aria-label={`ô của ${label}`} />
            </OptionalSection>
          ))}
          <AddSectionButton issue={issue} hidden={s.hidden} onPick={s.open} />
        </>
      )}
    </OptionalSectionsScope>
  );
}

function setup(issue: IssueDto, o: { editor?: boolean } = {}) {
  act(() => {
    useAuth.setState({
      user: { id: 'u', isSystemAdmin: o.editor ?? true } as never,
      permissions: [],
    });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Harness issue={issue} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const shown = () => LABELS.filter(([, l]) => screen.queryByText(`KHỐI ${l}`)).map(([id]) => id);

beforeEach(() => {
  for (const [name, value] of [
    ['scrollIntoView', () => undefined],
    ['hasPointerCapture', () => false],
  ] as const)
    Object.defineProperty(Element.prototype, name, { value, configurable: true, writable: true });
  globalThis.ResizeObserver ??= class {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  } as never;
  h.get.mockReset();
  mockApi();
});
afterEach(cleanup);

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Thêm mục/ }));
  return screen.findByRole('menu');
}

describe('khối tuỳ chọn của trang việc', () => {
  it('việc rỗng ở cả 8 khối: không vẽ khối nào, chỉ có nút "+ Thêm mục" với đủ 8 nhãn tiếng Việt', async () => {
    const user = setup(emptyBug());
    await screen.findByRole('button', { name: /Thêm mục/ });
    for (const u of ['/issues/i1/checklist', '/issues/i1/links', '/wiki/by-issue/i1'])
      await waitFor(() => expect(h.get).toHaveBeenCalledWith(u)); // ba truy vấn đã chạy xong
    expect(shown()).toEqual([]);
    const menu = await openMenu(user);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual([
      'Tiêu chí chấp nhận',
      'Các bước cần làm',
      'Thành phần',
      'Sửa ở phiên bản',
      'Bị ảnh hưởng ở phiên bản',
      'Liên kết',
      'Tài liệu liên quan',
      'Thông tin môi trường',
    ]);
  });

  it('chọn "Liên kết": khối Liên kết hiện, mục đó biến khỏi menu; con trỏ vào ô nhập của khối', async () => {
    const user = setup(emptyBug());
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Liên kết' }));
    expect(await screen.findByText('KHỐI Liên kết')).toBeTruthy();
    expect(shown()).toEqual(['links']);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('ô của Liên kết')),
    );
    const menu2 = await openMenu(user);
    const names = within(menu2)
      .getAllByRole('menuitem')
      .map((m) => m.textContent);
    expect(names).not.toContain('Liên kết');
    expect(names).toHaveLength(7);
  });

  it('có dữ liệu thì hiện sẵn, không cần bấm: tiêu chí chấp nhận / thành phần / phiên bản / môi trường', async () => {
    setup(
      emptyBug({
        acceptanceCriteria: '- [ ] Đăng nhập được',
        components: [{ id: 'c', name: 'API' }],
        fixVersions: [{ id: 'v', name: '1.0', type: 'FIX' }],
        environment: { env: 'PRODUCTION' },
      } as unknown as Partial<IssueDto>),
    );
    await screen.findByRole('button', { name: /Thêm mục/ });
    expect(shown()).toEqual(['acceptance', 'components', 'fixVersions', 'environment']);
  });

  it('checklist / liên kết / tài liệu có ≥ 1 mục (từ truy vấn) thì hiện; chưa nạp xong thì chưa hiện', async () => {
    mockApi({ checklist: [{ id: 1 }], links: [{ id: 2 }], docs: [{ id: 3 }] });
    setup(emptyBug());
    await waitFor(() => expect(shown()).toEqual(['checklist', 'links', 'docs']));
  });

  it('khối chỉ ẩn khi đang tải: truy vấn treo thì khối chưa hiện (không nhấp nháy), về sau có dữ liệu thì hiện', async () => {
    let release!: (v: unknown) => void;
    h.get.mockImplementation((url: string) =>
      url.endsWith('/links') ? new Promise((r) => (release = r)) : Promise.resolve({ data: [] }),
    );
    setup(emptyBug());
    await screen.findByRole('button', { name: /Thêm mục/ });
    expect(shown()).toEqual([]);
    act(() => release({ data: [{ id: 9 }] }));
    await waitFor(() => expect(shown()).toEqual(['links']));
  });

  it('khối ĐÃ có dữ liệu không biến mất khi mục cuối bị xoá cùng phiên (chốt hiện); đổi sang việc khác thì thả', async () => {
    mockApi({ links: [{ id: 1 }] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      useAuth.setState({ user: { id: 'u', isSystemAdmin: true } as never, permissions: [] });
    });
    const tree = (i: IssueDto) => (
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Harness issue={i} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(tree(emptyBug()));
    await waitFor(() => expect(shown()).toEqual(['links']));
    mockApi({ links: [] }); // xoá mục cuối
    await act(() => qc.invalidateQueries());
    await waitFor(() =>
      expect(
        h.get.mock.calls.filter((c) => String(c[0]).endsWith('/links')).length,
      ).toBeGreaterThan(1),
    );
    expect(shown()).toEqual(['links']); // vẫn còn khối, kèm ô thêm
    expect(screen.getByLabelText('ô của Liên kết')).toBeTruthy();
    rerender(tree({ ...emptyBug(), id: 'i2', key: 'I2' }));
    await waitFor(() => expect(shown()).toEqual([]));
  });

  it('`only` giới hạn truy vấn: bề mặt không có "Tài liệu liên quan" thì không gọi /wiki/by-issue', async () => {
    const issue = emptyBug();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <OptionalSectionsScope issue={issue} only={['checklist', 'links', 'components']}>
            {() => null}
          </OptionalSectionsScope>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/issues/i1/links'));
    expect(h.get).toHaveBeenCalledWith('/issues/i1/checklist');
    expect(h.get.mock.calls.map((c) => String(c[0])).some((u) => u.startsWith('/wiki/'))).toBe(
      false,
    );
  });

  it('người chỉ xem (không có quyền sửa) không thấy nút', async () => {
    setup(emptyBug(), { editor: false });
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Thêm mục/ })).toBeNull();
  });

  it('việc không phải Bug không đề nghị "Thông tin môi trường"; đủ khối thì nút biến mất', async () => {
    const story = mk('s1', {
      acceptanceCriteria: null,
      components: [],
      fixVersions: [],
      environment: null,
    });
    const user = setup(story);
    const menu = await openMenu(user);
    expect(within(menu).queryByRole('menuitem', { name: 'Thông tin môi trường' })).toBeNull();
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(7);
  });

  it('mở rồi đổi sang việc khác thì trạng thái "đã mở" được đặt lại', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      useAuth.setState({ user: { id: 'u', isSystemAdmin: true } as never, permissions: [] });
    });
    const user = userEvent.setup();
    const tree = (i: IssueDto) => (
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Harness issue={i} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(tree(emptyBug()));
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Thành phần' }));
    expect(await screen.findByText('KHỐI Thành phần')).toBeTruthy();
    rerender(tree({ ...emptyBug(), id: 'i2', key: 'I2' }));
    await waitFor(() => expect(screen.queryByText('KHỐI Thành phần')).toBeNull());
  });
});

describe('nguồn dữ liệu của từng khối (hàm thuần)', () => {
  const base = emptyBug();
  it('tiêu chí trắng/chỉ khoảng trắng coi như rỗng', () => {
    expect(sectionHasData('acceptance', { ...base, acceptanceCriteria: '  \n ' }, {})).toBe(false);
    expect(sectionHasData('acceptance', { ...base, acceptanceCriteria: '- [ ] a' }, {})).toBe(true);
  });
  it('phiên bản tách theo loại FIX / AFFECTS', () => {
    const i = { ...base, fixVersions: [{ id: 'v', name: '1', type: 'AFFECTS' }] } as IssueDto;
    expect(sectionHasData('fixVersions', i, {})).toBe(false);
    expect(sectionHasData('affectsVersions', i, {})).toBe(true);
  });
  it('số mục chưa nạp (undefined) coi như chưa có', () => {
    expect(sectionHasData('links', base, {})).toBe(false);
    expect(sectionHasData('links', base, { links: 1 })).toBe(true);
  });
});

describe('khối thật vào thẳng chế độ nhập khi vừa mở', () => {
  it('LinksPanel autoOpen: mở sẵn form thêm liên kết (không còn nút "Thêm liên kết" rồi mới bấm)', async () => {
    mockApi();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LinksPanel issueId="i1" canEdit autoOpen />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: /Thêm liên kết/ })).toBeNull());
  });
});
