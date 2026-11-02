import { describe, expect, it } from 'vitest';
import type { StatusCategory, Workflow } from './api';
import { layoutWorkflow, NODE_H, NODE_W, PITCH, type LayoutEdge } from './workflowLayout';

type S = [string, StatusCategory];
function mk(statuses: S[], transitions: [string, string | null, string][]) {
  return {
    statuses: statuses.map(([name, category], i) => ({
      id: name,
      name,
      category,
      color: null,
      order: i,
      isInitial: i === 0,
    })),
    transitions: transitions.map(([name, from, to], i) => ({
      id: `t${i}`,
      name,
      fromStatusId: from,
      toStatusId: to,
      order: i,
    })),
  } satisfies Pick<Workflow, 'statuses' | 'transitions'>;
}

const DEV = mk(
  [
    ['Cần làm', 'TODO'],
    ['Đang phân tích', 'TODO'],
    ['Sẵn sàng phát triển', 'TODO'],
    ['Đang làm', 'IN_PROGRESS'],
    ['Review code', 'IN_PROGRESS'],
    ['Chờ test', 'IN_PROGRESS'],
    ['Đang test', 'IN_PROGRESS'],
    ['Hoàn thành', 'DONE'],
    ['Không xử lý', 'DONE'],
  ],
  [
    ['Phân tích', 'Cần làm', 'Đang phân tích'],
    ['Sẵn sàng phát triển', 'Đang phân tích', 'Sẵn sàng phát triển'],
    ['Sẵn sàng phát triển', 'Cần làm', 'Sẵn sàng phát triển'],
    ['Bắt đầu làm', 'Cần làm', 'Đang làm'],
    ['Bắt đầu làm', 'Sẵn sàng phát triển', 'Đang làm'],
    ['Cần làm rõ', 'Sẵn sàng phát triển', 'Đang phân tích'],
    ['Tạm dừng', 'Đang làm', 'Cần làm'],
    ['Gửi review', 'Đang làm', 'Review code'],
    ['Trả lại', 'Review code', 'Đang làm'],
    ['Chuyển test', 'Đang làm', 'Chờ test'],
    ['Chuyển test', 'Review code', 'Chờ test'],
    ['Bắt đầu test', 'Chờ test', 'Đang test'],
    ['Test đạt', 'Đang test', 'Hoàn thành'],
    ['Test không đạt', 'Đang test', 'Đang làm'],
    ['Test không đạt', 'Chờ test', 'Đang làm'],
    ['Không xử lý', null, 'Không xử lý'],
    ['Mở lại', 'Hoàn thành', 'Cần làm'],
    ['Mở lại', 'Không xử lý', 'Cần làm'],
  ],
);

const SCRUM = mk(
  [
    ['To Do', 'TODO'],
    ['In Progress', 'IN_PROGRESS'],
    ['In Review', 'IN_PROGRESS'],
    ['Done', 'DONE'],
  ],
  [
    ['Bắt đầu', 'To Do', 'In Progress'],
    ['Gửi review', 'In Progress', 'In Review'],
    ['Duyệt', 'In Review', 'Done'],
    ['Trả lại', 'In Review', 'In Progress'],
    ['Làm lại', 'In Progress', 'To Do'],
    ['Mở lại', 'Done', 'To Do'],
  ],
);

type Seg = { x1: number; y1: number; x2: number; y2: number };
function segs(e: LayoutEdge): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < e.points.length - 1; i++) {
    const p = e.points[i]!;
    const q = e.points[i + 1]!;
    out.push({
      x1: Math.min(p.x, q.x),
      x2: Math.max(p.x, q.x),
      y1: Math.min(p.y, q.y),
      y2: Math.max(p.y, q.y),
    });
  }
  return out;
}
/** Hai đoạn trục-thẳng "chập" khi cùng đường và phần chung có độ dài > 0. */
function share(a: Seg, b: Seg) {
  const aV = a.x1 === a.x2;
  const bV = b.x1 === b.x2;
  if (aV && bV) return a.x1 === b.x1 && Math.min(a.y2, b.y2) > Math.max(a.y1, b.y1);
  if (!aV && !bV) return a.y1 === b.y1 && Math.min(a.x2, b.x2) > Math.max(a.x1, b.x1);
  return false;
}
const rectOf = (e: LayoutEdge) => ({
  x1: e.label.x - e.label.w / 2,
  x2: e.label.x + e.label.w / 2,
  y1: e.label.y - e.label.h / 2,
  y2: e.label.y + e.label.h / 2,
});
const hit = (a: Seg, b: Seg) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

describe.each([
  ['DEV 9 trạng thái', DEV],
  ['Scrum', SCRUM],
])('layoutWorkflow – %s', (_n, wf) => {
  const L = layoutWorkflow(wf);

  it('không có hai cung nào dùng chung một đoạn thẳng', () => {
    L.edges.forEach((ea, i) => {
      for (const eb of L.edges.slice(i + 1))
        for (const a of segs(ea))
          for (const b of segs(eb)) expect(share(a, b), `${ea.name} ~ ${eb.name}`).toBe(false);
    });
  });

  it('nhãn không chồng nhãn khác, node, hay chân đứng của cung khác', () => {
    L.edges.forEach((ea, i) => {
      const r = rectOf(ea);
      for (const eb of L.edges.slice(i + 1))
        expect(hit(r, rectOf(eb)), `${ea.name}/${eb.name}`).toBe(false);
      for (const n of L.nodes)
        expect(hit(r, { x1: n.x, x2: n.x + NODE_W, y1: 0, y2: NODE_H })).toBe(false);
      for (const o of L.edges)
        for (const s of segs(o)) {
          const pad = { x1: s.x1 - 2, x2: s.x2 + 2, y1: s.y1, y2: s.y2 };
          if (s.x1 === s.x2) expect(hit(r, pad), `${ea.name} x ${o.name}`).toBe(false);
        }
    });
  });

  it('cung tiến ở phía trên, cung lùi ở phía dưới', () => {
    for (const e of L.edges) {
      expect(e.dir === 'forward' ? e.points[1].y < 0 : e.points[1].y > NODE_H).toBe(true);
    }
  });

  it('node xếp một hàng theo thứ tự quy trình', () => {
    expect(L.nodes.map((n) => n.x)).toEqual(L.nodes.map((_, i) => i * PITCH));
  });
});

describe('layoutWorkflow – DEV', () => {
  const L = layoutWorkflow(DEV);
  it('"từ mọi trạng thái" gộp thành huy hiệu, không có cung', () => {
    expect(L.edges).toHaveLength(17);
    const node = L.nodes.find((n) => n.id === 'Không xử lý')!;
    expect(node.anyTransitions.map((t) => t.name)).toEqual(['Không xử lý']);
    expect(L.nodes.filter((n) => n.anyTransitions.length)).toHaveLength(1);
  });
  it('cung lùi có làn khác nhau khi chồng khoảng', () => {
    const back = L.edges.filter((e) => e.dir === 'back');
    const lanes = new Set(back.map((e) => e.lane));
    expect(back.length).toBe(7);
    expect(lanes.size).toBeGreaterThan(1);
    const span = (e: LayoutEdge) =>
      [e.source, e.target]
        .map((id) => L.nodes.findIndex((n) => n.id === id))
        .sort((x, y) => x - y) as [number, number];
    for (const a of back)
      for (const b of back) {
        if (a === b) continue;
        const [alo, ahi] = span(a);
        const [blo, bhi] = span(b);
        if (alo < bhi && blo < ahi) expect(a.lane).not.toBe(b.lane);
      }
  });
  it('ổn định: cùng đầu vào cho cùng kết quả', () => {
    expect(layoutWorkflow(DEV)).toEqual(L);
  });
});

describe('layoutWorkflow – trường hợp biên', () => {
  it('0 và 1 trạng thái', () => {
    const e = layoutWorkflow(mk([], []));
    expect(e.nodes).toEqual([]);
    expect(e.edges).toEqual([]);
    const one = layoutWorkflow(mk([['A', 'TODO']], []));
    expect(one.nodes).toHaveLength(1);
    expect(Number.isFinite(one.bounds.width)).toBe(true);
  });

  it('vòng lặp và nguồn không tồn tại thành huy hiệu, không mất', () => {
    const wf = mk(
      [
        ['A', 'TODO'],
        ['B', 'DONE'],
      ],
      [
        ['Tự quay', 'A', 'A'],
        ['Ma', 'ghost', 'B'],
        ['Đi', 'A', 'B'],
      ],
    );
    const L = layoutWorkflow(wf);
    expect(L.edges.map((x) => x.name)).toEqual(['Đi']);
    expect(L.nodes.find((n) => n.id === 'A')!.strayTransitions.map((t) => t.name)).toEqual([
      'Tự quay',
    ]);
    expect(L.nodes.find((n) => n.id === 'B')!.strayTransitions.map((t) => t.name)).toEqual(['Ma']);
  });

  it('chuyển tiếp trùng cặp và order bằng nhau vẫn không chung đoạn, kết quả ổn định', () => {
    const wf = mk(
      [
        ['A', 'TODO'],
        ['B', 'TODO'],
        ['C', 'DONE'],
      ],
      [
        ['x', 'A', 'C'],
        ['y', 'A', 'C'],
        ['z', 'C', 'A'],
        ['w', 'C', 'A'],
      ],
    );
    wf.statuses.forEach((s) => (s.order = 0));
    const L = layoutWorkflow(wf);
    expect(L.edges).toHaveLength(4);
    L.edges.forEach((ea, i) => {
      for (const eb of L.edges.slice(i + 1))
        for (const a of segs(ea)) for (const b of segs(eb)) expect(share(a, b)).toBe(false);
    });
    expect(layoutWorkflow(wf)).toEqual(L);
  });

  it('nhóm lạ xếp giữa, không sinh NaN', () => {
    const wf = mk(
      [
        ['A', 'TODO'],
        ['B', 'XYZ' as StatusCategory],
        ['C', 'DONE'],
      ],
      [['t', 'A', 'C']],
    );
    const L = layoutWorkflow(wf);
    expect(L.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C']);
    expect(L.edges[0]!.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(
      true,
    );
  });

  it('25 trạng thái nối vòng: không chung đoạn, nhãn không chồng nhau', () => {
    const names = Array.from({ length: 25 }, (_, i) => `S${i}`);
    const cat = (i: number): StatusCategory => (i < 8 ? 'TODO' : i < 20 ? 'IN_PROGRESS' : 'DONE');
    const tr: [string, string | null, string][] = [];
    names.forEach((n, i) => {
      if (i + 1 < 25) tr.push([`Tiếp ${i}`, n, names[i + 1]!]);
      if (i % 3 === 0 && i + 4 < 25) tr.push([`Nhảy ${i}`, n, names[i + 4]!]);
      if (i % 4 === 0 && i > 2) tr.push([`Lùi ${i}`, n, names[i - 3]!]);
    });
    const L = layoutWorkflow(
      mk(
        names.map((n, i) => [n, cat(i)] as S),
        tr,
      ),
    );
    expect(L.nodes).toHaveLength(25);
    L.edges.forEach((ea, i) => {
      for (const eb of L.edges.slice(i + 1)) {
        for (const a of segs(ea)) for (const b of segs(eb)) expect(share(a, b)).toBe(false);
        expect(hit(rectOf(ea), rectOf(eb)), `${ea.name}/${eb.name}`).toBe(false);
      }
    });
  });
});
