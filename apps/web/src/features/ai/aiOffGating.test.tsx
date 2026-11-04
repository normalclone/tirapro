// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { useAi } from '@/stores/ai';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return {
    ...real,
    api: { get: vi.fn().mockRejectedValue(new Error('offline')), post: vi.fn() },
  };
});

import { AiIssuePanel } from './AiIssuePanel';
import { AssigneeSuggestButton } from './AssigneeSuggestButton';

function wrap(ui: React.ReactNode) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}
const setAi = (enabled: boolean) => act(() => useAi.getState().set(enabled));

beforeEach(() => setAi(true));
afterEach(() => {
  cleanup();
  setAi(true);
});

describe('tắt "Trợ lý AI" ở thanh trên: mọi gợi ý AI biến mất', () => {
  const button = <AssigneeSuggestButton projectId="p" issueId="i" onPick={() => undefined} />;

  it('AssigneeSuggestButton: tắt → không vẽ gì; bật → có nút "Gợi ý"', () => {
    setAi(false);
    const { container, rerender } = render(wrap(button));
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
    setAi(true);
    rerender(wrap(button));
    expect(screen.getByRole('button', { name: /Gợi ý/ })).toBeTruthy();
  });

  it('AiIssuePanel (thẻ "Trợ lý AI": Tóm tắt, Gợi ý ưu tiên & độ khó): tắt → không vẽ gì; bật → có', () => {
    setAi(false);
    const { container, rerender } = render(wrap(<AiIssuePanel issueId="i" />));
    expect(container.textContent).toBe('');
    setAi(true);
    rerender(wrap(<AiIssuePanel issueId="i" />));
    expect(screen.getByRole('button', { name: /Tóm tắt/ })).toBeTruthy();
    expect(screen.getByText('Trợ lý AI')).toBeTruthy();
  });

  it('dạng "bare" cũng tắt theo', () => {
    setAi(false);
    const { container } = render(wrap(<AiIssuePanel issueId="i" variant="bare" />));
    expect(container.textContent).toBe('');
  });
});
