import { describe, expect, it } from 'vitest';
import tira from './tiraWorkflow.fixture.json';
import type { Workflow } from './api';
import { fitViewport } from './workflowFit';
import {
  edgeEmphasis,
  escapeClears,
  nodeEmphasis,
  reachability,
  toggleSelection,
} from './workflowPaths';

const wf = tira as unknown as Pick<Workflow, 'statuses' | 'transitions'>;
const sid = (name: string) => wf.statuses.find((s) => s.name === name)!.id;
const tr = (name: string, from: string | null, to: string) =>
  wf.transitions.find(
    (t) =>
      t.name === name && t.fromStatusId === (from ? sid(from) : null) && t.toStatusId === sid(to),
  )!.id;

describe('reachability – quy trình TIRA thật, từ "Đang làm"', () => {
  const r = reachability(wf, sid('Đang làm'));
  const names = (ids: Set<string>) =>
    [...ids].map((id) => wf.transitions.find((t) => t.id === id)!).map((t) => `${t.name}`);

  it('direct = đúng các chuyển tiếp đi ra (kể cả "Không xử lý" từ mọi trạng thái)', () => {
    expect(new Set(names(r.direct))).toEqual(
      new Set(['Tạm dừng', 'Gửi review', 'Chuyển test', 'Không xử lý']),
    );
    expect(r.direct.has(tr('Không xử lý', null, 'Không xử lý'))).toBe(true);
  });

  it('future có "Test đạt" (Đang test → Hoàn thành) và không chứa chuyển tiếp nào của direct', () => {
    expect(r.future.has(tr('Test đạt', 'Đang test', 'Hoàn thành'))).toBe(true);
    expect(r.future.has(tr('Bắt đầu test', 'Chờ test', 'Đang test'))).toBe(true);
    for (const id of r.direct) expect(r.future.has(id)).toBe(false);
  });

  it('future bỏ cung quay lại trạng thái đã thăm ("Trả lại", "Test không đạt", "Bắt đầu làm")', () => {
    expect(r.future.has(tr('Trả lại', 'Review code', 'Đang làm'))).toBe(false);
    expect(r.future.has(tr('Test không đạt', 'Đang test', 'Đang làm'))).toBe(false);
    expect(r.future.has(tr('Bắt đầu làm', 'Cần làm', 'Đang làm'))).toBe(false);
  });

  it('incoming = các chuyển tiếp đi vào "Đang làm"', () => {
    expect(new Set(names(r.incoming))).toEqual(
      new Set(['Bắt đầu làm', 'Trả lại', 'Test không đạt']),
    );
    expect(r.incoming.size).toBe(5);
  });

  it('nodes gồm trạng thái chọn, đích direct/future và nguồn incoming', () => {
    for (const n of ['Đang làm', 'Review code', 'Đang test', 'Hoàn thành', 'Cần làm'])
      expect(r.nodes.has(sid(n))).toBe(true);
  });

  it('một chuyển tiếp chỉ thuộc một nhóm direct / future / incoming', () => {
    for (const id of r.direct) expect(r.incoming.has(id)).toBe(false);
    for (const id of r.future) expect(r.incoming.has(id)).toBe(false);
  });
});

describe('reachability – biên', () => {
  const mini = (
    statuses: string[],
    trs: [string, string | null, string][],
  ): Pick<Workflow, 'statuses' | 'transitions'> => ({
    statuses: statuses.map((n, i) => ({
      id: n,
      name: n,
      category: 'TODO',
      color: null,
      order: i,
      isInitial: i === 0,
    })),
    transitions: trs.map(([name, from, to], i) => ({
      id: `t${i}`,
      name,
      fromStatusId: from,
      toStatusId: to,
      order: i,
    })),
  });

  it('vòng A→B→C→A: từ A, future chỉ có B→C; cung C→A (quay về) không thuộc nhóm nào', () => {
    const r = reachability(
      mini(
        ['A', 'B', 'C'],
        [
          ['ab', 'A', 'B'],
          ['bc', 'B', 'C'],
          ['ca', 'C', 'A'],
        ],
      ),
      'A',
    );
    expect([...r.direct]).toEqual(['t0']);
    expect([...r.future]).toEqual(['t1']);
    expect([...r.incoming]).toEqual(['t2']);
  });

  it('hai đường tới cùng một nút ở bậc khác nhau đều được lấy', () => {
    const r = reachability(
      mini(
        ['A', 'B', 'C', 'D'],
        [
          ['ab', 'A', 'B'],
          ['ac', 'A', 'C'],
          ['bd', 'B', 'D'],
          ['cd', 'C', 'D'],
        ],
      ),
      'A',
    );
    expect(r.future).toEqual(new Set(['t2', 't3']));
  });

  it('trạng thái không có chuyển tiếp: rỗng, chỉ có chính nó; id lạ không nổ', () => {
    const r = reachability(mini(['A'], []), 'A');
    expect(r.direct.size + r.future.size + r.incoming.size).toBe(0);
    expect([...r.nodes]).toEqual(['A']);
    expect(reachability(mini(['A'], []), 'zzz').nodes).toEqual(new Set(['zzz']));
  });

  it('vòng tự quay và nguồn không tồn tại bị bỏ qua', () => {
    const r = reachability(
      mini(
        ['A', 'B'],
        [
          ['x', 'A', 'A'],
          ['y', 'ghost', 'B'],
        ],
      ),
      'A',
    );
    expect(r.direct.size + r.future.size + r.incoming.size).toBe(0);
  });
});

describe('nhấn mạnh và chọn', () => {
  const r = reachability(wf, sid('Đang làm'));
  it('cung: direct > incoming > future, còn lại mờ; không chọn thì không nhấn mạnh', () => {
    expect(edgeEmphasis(null, 'x')).toBeNull();
    expect(edgeEmphasis(r, tr('Gửi review', 'Đang làm', 'Review code'))).toBe('direct');
    expect(edgeEmphasis(r, tr('Trả lại', 'Review code', 'Đang làm'))).toBe('incoming');
    expect(edgeEmphasis(r, tr('Test đạt', 'Đang test', 'Hoàn thành'))).toBe('future');
    expect(edgeEmphasis(r, tr('Phân tích', 'Cần làm', 'Đang phân tích'))).toBe('future');
    expect(edgeEmphasis(r, tr('Mở lại', 'Hoàn thành', 'Cần làm'))).toBe('dim');
  });
  it('node: selected / direct / future / incoming / dim', () => {
    const id = sid('Đang làm');
    expect(nodeEmphasis(r, id, id)).toBe('selected');
    expect(nodeEmphasis(r, id, sid('Review code'))).toBe('direct');
    expect(nodeEmphasis(r, id, sid('Hoàn thành'))).toBe('future');
    expect(nodeEmphasis(null, null, sid('Review code'))).toBeNull();
  });
  it('bấm lại cùng node thì bỏ chọn; bấm node khác thì chuyển chọn', () => {
    expect(toggleSelection('a', 'a')).toBeNull();
    expect(toggleSelection('a', 'b')).toBe('b');
    expect(toggleSelection(null, 'b')).toBe('b');
  });
  it('Esc bỏ chọn chỉ khi khác trạng thái mặc định (để popup còn đóng được bằng Esc)', () => {
    expect(escapeClears('b', 'a')).toBe(true);
    expect(escapeClears('a', 'a')).toBe(false);
    expect(escapeClears(null, 'a')).toBe(false);
    expect(escapeClears('a', null)).toBe(true);
  });
});

describe('fitViewport', () => {
  const bounds = { x: 0, y: -60, width: 1000, height: 300 };
  it('khung rộng: lấp chiều ngang với lề 10%, canh giữa', () => {
    const v = fitViewport({ bounds, size: { width: 1200, height: 600 } })!;
    expect(v.zoom).toBeCloseTo(0.96, 2); // (1200 - 240) / 1000
    expect(v.x).toBeCloseTo(120, 0);
  });
  it('đồ thị rất rộng: không thu dưới 0.5, bắt đầu từ mép trái (kéo để xem tiếp)', () => {
    const v = fitViewport({
      bounds: { ...bounds, width: 4000 },
      size: { width: 1200, height: 600 },
    })!;
    expect(v.zoom).toBe(0.5);
    expect(v.x).toBeCloseTo(120, 0);
  });
  it('đồ thị nhỏ không phóng quá maxZoom', () => {
    const v = fitViewport({
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      size: { width: 1200, height: 600 },
    })!;
    expect(v.zoom).toBe(1.25);
  });
  it('khung chưa có kích thước (ẩn / chưa đo) thì không canh', () => {
    expect(fitViewport({ bounds, size: { width: 0, height: 0 } })).toBeNull();
  });
});
