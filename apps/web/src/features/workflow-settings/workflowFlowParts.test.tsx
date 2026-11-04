// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import tira from './tiraWorkflow.fixture.json';
import type { Workflow } from './api';
import { layoutWorkflow } from './workflowLayout';
import { buildEdges, buildNodes } from './WorkflowFlowParts';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

import { WorkflowViewDialog } from './WorkflowViewDialog';

const wf = {
  id: 'wf1',
  name: 'Quy trình TIRA',
  description: null,
  isTemplate: false,
  isDefault: false,
  projectId: 'p1',
  ...tira,
} as unknown as Workflow;
const isOpen = true as boolean;
const sid = (name: string) => wf.statuses.find((s) => s.name === name)!.id;

describe('popup xem quy trình dùng chung bố cục với trang cài đặt', () => {
  const layout = layoutWorkflow(wf);

  it('cung dựng từ bố cục: loại cung riêng của sơ đồ (không smoothstep), path lấy từ bố cục, không mũi tên mặc định', () => {
    const edges = buildEdges(layout);
    expect(edges).toHaveLength(layout.edges.length);
    for (const e of edges) {
      expect(e.type).toBe('wf');
      expect(e.type).not.toBe('smoothstep');
      expect(e.markerEnd).toBeUndefined();
      expect(e.data!.path).toBe(layout.edges.find((x) => x.id === e.id)!.path);
    }
  });

  it('node: vị trí theo bố cục, "Hiện tại" đúng trạng thái của việc, huy hiệu "từ mọi trạng thái" qua anyTransitions', () => {
    const nodes = buildNodes(wf, layout, {}, sid('Đang làm'));
    expect(nodes.map((n) => n.position.x)).toEqual(layout.nodes.map((n) => n.x));
    expect(nodes.filter((n) => n.data.isCurrent).map((n) => n.data.label)).toEqual(['Đang làm']);
    expect(nodes.find((n) => n.data.label === 'Cần làm')!.data.isInitial).toBe(true);
    expect(
      nodes.find((n) => n.data.label === 'Không xử lý')!.data.anyTransitions.map((t) => t.name),
    ).toEqual(['Không xử lý']);
    expect(nodes.every((n) => n.data.onDelete === undefined)).toBe(true); // chỉ đọc
  });

  it('popup không còn bố cục cột riêng / cung smoothstep', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/features/workflow-settings/WorkflowViewDialog.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/smoothstep|autoLayout|COL_W/);
    expect(src).toMatch(/layoutWorkflow/);
  });
});

describe('popup xem quy trình: chọn / bỏ chọn bằng Esc', () => {
  beforeEach(() => {
    globalThis.ResizeObserver ??= class {
      observe = () => undefined;
      unobserve = () => undefined;
      disconnect = () => undefined;
    } as never;
    globalThis.DOMMatrixReadOnly ??= class {
      m22 = 1;
    } as never;
    h.get.mockReset();
    h.get.mockResolvedValue({ data: [wf] });
  });
  afterEach(cleanup);

  function open(onClose = vi.fn()) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <WorkflowViewDialog
          open={isOpen}
          onClose={onClose}
          currentStatusId={sid('Đang làm')}
          currentStatusName="Đang làm"
        />
      </QueryClientProvider>,
    );
    return onClose;
  }
  const emphasis = (name: string) =>
    screen
      .getByText(name, { selector: 'span.truncate' })
      .closest('[data-emphasis], .group')!
      .getAttribute('data-emphasis');

  it('mở ra: trạng thái hiện tại được chọn sẵn, đích trực tiếp nổi, nút khác mờ', async () => {
    open();
    await waitFor(() => expect(screen.getAllByText('Review code').length).toBeGreaterThan(0));
    await waitFor(() => expect(emphasis('Đang làm')).toBe('selected'));
    expect(emphasis('Review code')).toBe('direct');
    expect(emphasis('Hoàn thành')).toBe('future');
    expect(emphasis('Đang phân tích')).toBe('future');
  });

  it('bấm node khác chọn node đó; bấm lại bỏ chọn', async () => {
    open();
    await waitFor(() => expect(emphasis('Đang làm')).toBe('selected'));
    fireEvent.click(screen.getByText('Đang test', { selector: 'span.truncate' }));
    await waitFor(() => expect(emphasis('Đang test')).toBe('selected'));
    expect(emphasis('Đang làm')).toBe('direct'); // Test không đạt: Đang test -> Đang làm
    expect(emphasis('Chờ test')).toBe('incoming'); // Bắt đầu test đi vào Đang test
    fireEvent.click(screen.getByText('Đang test', { selector: 'span.truncate' }));
    await waitFor(() =>
      expect(
        screen
          .getByText('Đang test', { selector: 'span.truncate' })
          .closest('.group')!
          .hasAttribute('data-emphasis'),
      ).toBe(false),
    );
  });

  it('Esc: lần đầu (đang ở chọn mặc định) đóng popup; sau khi tự chọn node khác thì Esc chỉ bỏ chọn, không đóng', async () => {
    const onClose = open();
    await waitFor(() => expect(emphasis('Đang làm')).toBe('selected'));
    fireEvent.click(screen.getByText('Review code', { selector: 'span.truncate' }));
    await waitFor(() => expect(emphasis('Review code')).toBe('selected'));
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });
    await waitFor(() =>
      expect(
        screen
          .getByText('Review code', { selector: 'span.truncate' })
          .closest('.group')!
          .hasAttribute('data-emphasis'),
      ).toBe(false),
    );
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
