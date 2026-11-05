// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DASHBOARD_TEMPLATES } from '@tirapro/shared';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get } };
});

import { DataScopeDialog } from './DataScopeDialog';
import type { DataScopeValue } from './dataScopeModel';

const ORG: DataScopeValue = { dataScope: 'ORG', scopeProjectId: '', scopeProgramId: '' };
const PROJ: DataScopeValue = { dataScope: 'PROJECT', scopeProjectId: 'p1', scopeProgramId: '' };

let canUseOrgScope = false;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  canUseOrgScope = false;
  h.get.mockReset();
  h.get.mockImplementation((url: string) => {
    if (url === '/dashboard-templates')
      return Promise.resolve({ data: { templates: DASHBOARD_TEMPLATES, canUseOrgScope } });
    if (url === '/projects')
      return Promise.resolve({
        data: [
          { id: 'p1', key: 'AAA', name: 'Alpha', isArchived: false },
          { id: 'p2', key: 'BBB', name: 'Beta', isArchived: false },
        ],
      });
    if (url === '/programs')
      return Promise.resolve({ data: [{ id: 'g1', name: 'Đối tác', projectCount: 2 }] });
    return Promise.reject(new Error(`offline ${url}`));
  });
});
afterEach(cleanup);

// Hộp luôn mở trong test (đọc qua biến, đúng hợp đồng Dialog: không `open` trần).
const shown = { open: true };

function open(current: DataScopeValue, chosen?: DataScopeValue) {
  const onApply = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DataScopeDialog
        open={shown.open}
        onOpenChange={() => undefined}
        current={current}
        chosen={chosen}
        onApply={onApply}
      />
    </QueryClientProvider>,
  );
  return { onApply, user: userEvent.setup() };
}

describe('DataScopeDialog (cài đặt dashboard)', () => {
  it('Xong khi KHÔNG đổi gì → onApply(undefined): không đánh dấu đã đổi, không gửi lại phạm vi', async () => {
    const { onApply, user } = open(PROJ);
    await user.click(await screen.findByRole('button', { name: 'Xong' }));
    expect(onApply).toHaveBeenCalledWith(undefined);
  });

  it('đổi sang dự án khác → onApply(giá trị mới)', async () => {
    const { onApply, user } = open(PROJ);
    await user.click(await screen.findByRole('button', { name: 'Dự án' }));
    await user.click(await screen.findByRole('option', { name: /Beta/ }));
    await user.click(screen.getByRole('button', { name: 'Xong' }));
    expect(onApply).toHaveBeenCalledWith({
      dataScope: 'PROJECT',
      scopeProjectId: 'p2',
      scopeProgramId: '',
    });
  });

  it('người không phải admin: đổi sang Toàn tổ chức bị khoá; nhưng dashboard đang ở ORG thì giữ được', async () => {
    const a = open(PROJ);
    const org = await screen.findByRole('radio', { name: 'Toàn tổ chức' });
    expect(org.getAttribute('aria-disabled')).toBe('true');
    expect(a.onApply).not.toHaveBeenCalled();
    cleanup();
    const b = open(ORG);
    await waitFor(() =>
      expect(
        screen.getByRole('radio', { name: 'Toàn tổ chức' }).getAttribute('aria-disabled'),
      ).toBeNull(),
    );
    await b.user.click(screen.getByRole('button', { name: 'Xong' }));
    expect(b.onApply).toHaveBeenCalledWith(undefined);
  });

  it('nhóm đã xoá (GROUP không còn id): không cho Xong cho tới khi chọn lại nhóm', async () => {
    open({ dataScope: 'GROUP', scopeProjectId: '', scopeProgramId: '' });
    const done = await screen.findByRole('button', { name: 'Xong' });
    expect((done as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Chọn nhóm dự án\./)).toBeTruthy();
  });
});
