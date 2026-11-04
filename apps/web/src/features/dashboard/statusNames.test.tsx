// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { mk } from '@/lib/issueFixture';
import { StatusPill } from '@/components/ui/StatusPill';
import { ResultsTable } from '@/features/saved-filters/ResultsTable';
import { MyIssueRow } from './DashboardPage';

// Không để ô nào gọi mạng thật (jsdom sẽ thử mở socket)
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: vi.fn().mockRejectedValue(new Error('offline')) } };
});

afterEach(cleanup);

const chuaTest = {
  id: 'st',
  workflowId: 'w',
  name: 'Chờ test',
  category: 'IN_PROGRESS',
  color: null,
  order: 3,
  isInitial: false,
} as never;

function withProviders(ui: React.ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('"Việc của tôi": tên trạng thái luôn hiện', () => {
  it('dòng việc có trạng thái "Chờ test" hiện đúng chữ đó (không chỉ chấm màu), kể cả khi màn hẹp', () => {
    render(
      withProviders(
        <ul>
          <MyIssueRow issue={mk('a', { status: chuaTest })} projectKey="DEMO" />
        </ul>,
      ),
    );
    const name = screen.getByText('Chờ test');
    expect(name).toBeTruthy();
    // không bị ẩn dưới `md` (class `hidden`) như chip mặc định
    expect(name.className).not.toContain('hidden');
    expect(name.closest('[title="Trạng thái: Chờ test"]')).toBeTruthy();
  });

  it('StatusPill mặc định vẫn ẩn tên dưới md (bảng/danh sách dày), alwaysShowName thì không', () => {
    const { container, rerender } = render(<StatusPill status={chuaTest} />);
    expect(container.querySelector('.hidden.md\\:inline')?.textContent).toBe('Chờ test');
    rerender(<StatusPill status={chuaTest} alwaysShowName />);
    expect(container.querySelector('.hidden')).toBeNull();
    expect(container.textContent).toBe('Chờ test');
    // tên dài không bị cắt sớm (tooltip vẫn có tên đầy đủ)
    expect(screen.getByText('Chờ test').className).toContain('max-w-[12rem]');
  });
});

describe('bảng kết quả bộ lọc', () => {
  const long = 'Rất dài '.repeat(30).trim();
  const issue = mk('r', { summary: long, status: chuaTest, projectId: 'p1' });
  function table() {
    render(
      withProviders(
        <ResultsTable
          issues={[issue]}
          loading={false}
          hasRun
          error={null}
          page={1}
          onPageChange={() => undefined}
          projectKeyById={new Map([['p1', 'DEMO']])}
          onOpen={() => undefined}
          peekedKey={null}
        />,
      ),
    );
  }
  it('ô tóm tắt có `truncate`, giới hạn rộng và tooltip đủ chữ; các ô khác không xuống dòng', () => {
    table();
    const cell = screen.getAllByTitle(long)[0]!;
    expect(cell.className).toContain('truncate');
    expect(cell.className).toContain('max-w-[28rem]');
    const row = cell.closest('tr')!;
    for (const td of Array.from(row.querySelectorAll('td')).slice(1))
      expect(td.className).toContain('whitespace-nowrap');
  });
  it('ô trạng thái là chip StatusPill hiện tên "Chờ test"', () => {
    table();
    const row = screen.getAllByTitle(long)[0]!.closest('tr')!;
    const pill = within(row).getByTitle('Trạng thái: Chờ test');
    expect(pill.textContent).toBe('Chờ test');
  });
});
