import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AllocationBudgetList } from './AllocationBudgetList';
import { allocationBudgets, type BudgetAllocation } from './allocationBudget';

const A = (
  userId: string,
  projectId: string,
  percent: number,
  s: string,
  e: string,
): BudgetAllocation => ({
  userId,
  projectId,
  percent,
  startDate: s,
  endDate: e,
  project: { id: projectId, key: projectId.toUpperCase(), name: projectId },
  user: { id: userId, displayName: `Người ${userId}` },
});
const FROM = '2026-10-19';
const TO = '2026-10-25';
const html = (allocs: BudgetAllocation[], only?: string[]) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <AllocationBudgetList budgets={allocationBudgets(allocs, FROM, TO)} only={only} />
    </QueryClientProvider>,
  );

describe('AllocationBudgetList (171)', () => {
  it('mỗi người một đồng hồ role=meter, tên truy cập có tên người; tông strict', () => {
    const h = html([A('u1', 'p1', 60, FROM, TO)]);
    expect(h).toContain('role="meter"');
    expect(h).toContain('aria-label="Ngân sách thời gian của Người u1"');
    expect(h).toContain('Đỉnh 60/100 %');
    expect(h).not.toContain('bg-danger');
  });
  it('vượt 100%: đồng hồ đỏ "Vượt 30%" + dòng cảnh báo "đỉnh 130% vào 21/10" + số ngày vượt', () => {
    const h = html([A('u1', 'p1', 60, FROM, TO), A('u1', 'p2', 70, '2026-10-21', TO)]);
    expect(h).toContain('Vượt 30%');
    expect(h).toContain('bg-danger');
    expect(h).toContain('Đỉnh 130% vào 21/10');
    expect(h).toContain('3 ngày (T2–T6) vượt 100%');
    expect(h).not.toContain('ngày làm việc');
  });
  it('chia theo dự án tại ngày đỉnh, bằng chữ', () => {
    const h = html([A('u1', 'p1', 60, FROM, TO), A('u1', 'p2', 70, '2026-10-21', TO)]);
    const text = h.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '');
    expect(text).toContain('P2 70% · P1 60%');
  });
  it('nói rõ CHƯA trừ nghỉ phép/ngày lễ và chỉ tới tab Khối lượng', () => {
    const h = html([A('u1', 'p1', 60, FROM, TO)]);
    const text = h.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '');
    expect(text).toContain('Chưa trừ nghỉ phép/ngày lễ — xem tab Khối lượng');
  });
  it('không vượt: không có dòng cảnh báo', () => {
    const h = html([A('u1', 'p1', 60, FROM, TO)]);
    expect(h).not.toContain('vượt 100%');
  });
  it('lọc `only` chỉ hiện những người đó (bảng đang lọc theo dự án) nhưng số liệu vẫn là tổng mọi dự án', () => {
    const h = html([A('u1', 'p1', 60, FROM, TO), A('u2', 'p1', 50, FROM, TO)], ['u2']);
    expect(h).toContain('Người u2');
    expect(h).not.toContain('Người u1');
  });
  it('không có ai → không vẽ gì', () => {
    expect(html([])).toBe('');
  });
});
