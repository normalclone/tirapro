// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { CommandPalette } from './CommandPalette';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = vi.fn();

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: vi.fn().mockRejectedValue(new Error('offline')) } };
});

afterEach(cleanup);

function Probe() {
  return <p data-testid="loc">{useLocation().pathname}</p>;
}

describe('Cmd+K: "Của tôi"', () => {
  it('mở bảng lệnh, gõ "viec cua toi" → mục "Của tôi"; chọn → sang /me', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <CommandPalette />
          <Probe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    act(() => {
      window.dispatchEvent(new Event('tirapro:command'));
    });
    const input = await screen.findByPlaceholderText(/Tìm công việc/);
    fireEvent.change(input, { target: { value: 'việc của tôi' } });
    const item = await screen.findByRole('option', { name: 'Của tôi' });
    fireEvent.click(item);
    expect(screen.getByTestId('loc').textContent).toBe('/me');
  });

  it('gõ "me" hoặc "cá nhân" cũng ra mục này', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <CommandPalette />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    act(() => {
      window.dispatchEvent(new Event('tirapro:command'));
    });
    const input = await screen.findByPlaceholderText(/Tìm công việc/);
    for (const q of ['me', 'cá nhân']) {
      fireEvent.change(input, { target: { value: q } });
      expect(await screen.findByRole('option', { name: 'Của tôi' })).toBeTruthy();
    }
  });
});
