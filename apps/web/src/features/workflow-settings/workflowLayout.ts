/**
 * Bố cục sơ đồ quy trình (hàm thuần, không phụ thuộc React/reactflow).
 *
 * - Trạng thái xếp MỘT hàng ngang theo thứ tự quy trình (nhóm TODO → IN_PROGRESS → DONE, rồi `order`).
 * - Chuyển tiếp "tiến" (sang trạng thái đứng sau) vẽ thành cung phía TRÊN hàng node; "lùi" vẽ phía DƯỚI.
 * - Mỗi cung có làn (độ cao) riêng và điểm neo riêng trên cạnh node → không hai đường nào dùng chung một đoạn.
 * - Chuyển tiếp "từ mọi trạng thái" (fromStatusId = null) không vẽ đường: gộp thành huy hiệu trên node đích.
 * - Nhãn là chip đặt trên đoạn ngang của cung, tránh chip khác, node và chân đứng của các cung khác.
 */
import type { StatusCategory, Workflow } from './api';

export const NODE_W = 176;
export const NODE_H = 68;
export const PITCH = 208;
const LANE0 = 36;
const LANE_STEP = 32;
const CORNER = 10;
const LABEL_H = 20;
const SLOT_MARGIN = 16;

const CAT_RANK: Record<StatusCategory, number> = { TODO: 0, IN_PROGRESS: 1, DONE: 2 };

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  /** Chuyển tiếp "từ mọi trạng thái" đi tới node này. */
  anyTransitions: { id: string; name: string }[];
}

type Pt = { x: number; y: number };

export type EdgeDir = 'forward' | 'back';

export interface LayoutEdge {
  id: string;
  name: string;
  source: string;
  target: string;
  dir: EdgeDir;
  /** 0 = làn sát hàng node nhất. */
  lane: number;
  /** Điểm gấp khúc (toạ độ flow) từ node nguồn tới node đích. */
  points: [Pt, Pt, Pt, Pt];
  /** SVG path bo góc đi qua `points`. */
  path: string;
  label: { x: number; y: number; w: number; h: number };
}

export interface WorkflowLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  bounds: { x: number; y: number; width: number; height: number };
}

function estimateLabelWidth(text: string): number {
  return Math.ceil(text.length * 6.3 + 18);
}

type Rect = { x1: number; y1: number; x2: number; y2: number };
const overlap = (a: Rect, b: Rect) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

const at = <T>(a: T[], i: number): T => a[i] as T;

function roundedPath(pts: { x: number; y: number }[], r: number): string {
  const first = at(pts, 0);
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = at(pts, i - 1);
    const c = at(pts, i);
    const n = at(pts, i + 1);
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(n.x - c.x, n.y - c.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const a = { x: c.x + ((p.x - c.x) / l1) * rr, y: c.y + ((p.y - c.y) / l1) * rr };
    const b = { x: c.x + ((n.x - c.x) / l2) * rr, y: c.y + ((n.y - c.y) / l2) * rr };
    d += ` L ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const last = at(pts, pts.length - 1);
  return `${d} L ${last.x} ${last.y}`;
}

interface Arc {
  id: string;
  name: string;
  from: number;
  to: number;
  dir: EdgeDir;
  lo: number;
  hi: number;
  lane: number;
}

export function layoutWorkflow(wf: Pick<Workflow, 'statuses' | 'transitions'>): WorkflowLayout {
  const sorted = [...wf.statuses].sort(
    (a, b) => CAT_RANK[a.category] - CAT_RANK[b.category] || a.order - b.order,
  );
  const idx = new Map(sorted.map((s, i) => [s.id, i]));
  const anyBy = new Map<string, { id: string; name: string }[]>();
  const arcs: Arc[] = [];

  for (const t of wf.transitions) {
    const to = idx.get(t.toStatusId);
    if (to === undefined) continue;
    if (t.fromStatusId == null) {
      const list = anyBy.get(t.toStatusId) ?? [];
      list.push({ id: t.id, name: t.name });
      anyBy.set(t.toStatusId, list);
      continue;
    }
    const from = idx.get(t.fromStatusId);
    if (from === undefined || from === to) continue;
    arcs.push({
      id: t.id,
      name: t.name,
      from,
      to,
      dir: to > from ? 'forward' : 'back',
      lo: Math.min(from, to),
      hi: Math.max(from, to),
      lane: 0,
    });
  }

  // Gán làn: cung ngắn trước; làn = 1 + làn lớn nhất của các cung (cùng phía) chồng khoảng với nó.
  for (const dir of ['forward', 'back'] as const) {
    const side = arcs
      .filter((a) => a.dir === dir)
      .sort((a, b) => a.hi - a.lo - (b.hi - b.lo) || a.lo - b.lo || a.id.localeCompare(b.id));
    const done: Arc[] = [];
    for (const a of side) {
      let lane = 0;
      for (const o of done) if (a.lo < o.hi && o.lo < a.hi) lane = Math.max(lane, o.lane + 1);
      a.lane = lane;
      done.push(a);
    }
  }

  // Điểm neo: mỗi (node, phía) chia các đầu cung thành nhóm trái/phải; cung cao hơn nằm ngoài hơn → không cắt nhau.
  type End = { arc: Arc; role: 'src' | 'tgt'; partner: number };
  const ends = new Map<string, End[]>();
  const sideOf = (a: Arc) => (a.dir === 'forward' ? 'top' : 'bottom');
  const push = (node: number, a: Arc, role: 'src' | 'tgt') => {
    const key = `${node}:${sideOf(a)}`;
    const list = ends.get(key) ?? [];
    list.push({ arc: a, role, partner: role === 'src' ? a.to : a.from });
    ends.set(key, list);
  };
  for (const a of arcs) {
    push(a.from, a, 'src');
    push(a.to, a, 'tgt');
  }
  const slotX = new Map<string, number>(); // `${arcId}:${role}` → x
  for (const [key, list] of ends) {
    const node = Number(key.split(':')[0]);
    const left = list.filter((e) => e.partner < node).sort((a, b) => a.arc.lane - b.arc.lane);
    const right = list.filter((e) => e.partner > node).sort((a, b) => b.arc.lane - a.arc.lane);
    const ordered = [...left, ...right];
    ordered.forEach((e, k) => {
      const x =
        node * PITCH + SLOT_MARGIN + ((NODE_W - 2 * SLOT_MARGIN) * (k + 1)) / (ordered.length + 1);
      slotX.set(`${e.arc.id}:${e.role}`, Math.round(x));
    });
  }

  const laneY = (a: Arc) =>
    a.dir === 'forward' ? -(LANE0 + a.lane * LANE_STEP) : NODE_H + LANE0 + a.lane * LANE_STEP;

  const edges: LayoutEdge[] = arcs.map((a) => {
    const sx = slotX.get(`${a.id}:src`)!;
    const tx = slotX.get(`${a.id}:tgt`)!;
    const y = laneY(a);
    const edge0 = a.dir === 'forward' ? 0 : NODE_H;
    const points: [Pt, Pt, Pt, Pt] = [
      { x: sx, y: edge0 },
      { x: sx, y },
      { x: tx, y },
      { x: tx, y: edge0 },
    ];
    return {
      id: a.id,
      name: a.name,
      source: at(sorted, a.from).id,
      target: at(sorted, a.to).id,
      dir: a.dir,
      lane: a.lane,
      points,
      path: roundedPath(points, CORNER),
      label: { x: (sx + tx) / 2, y, w: estimateLabelWidth(a.name), h: LABEL_H },
    };
  });

  placeLabels(edges, sorted.length);

  const maxLane = (dir: EdgeDir) =>
    edges.filter((e) => e.dir === dir).reduce((m, e) => Math.max(m, e.lane + 1), 0);
  const top = -(maxLane('forward') ? LANE0 + (maxLane('forward') - 1) * LANE_STEP + LABEL_H : 0);
  const bottom =
    NODE_H + (maxLane('back') ? LANE0 + (maxLane('back') - 1) * LANE_STEP + LABEL_H : 0);
  const width = Math.max(1, sorted.length) * PITCH - (PITCH - NODE_W);

  return {
    nodes: sorted.map((s, i) => ({
      id: s.id,
      x: i * PITCH,
      y: 0,
      anyTransitions: anyBy.get(s.id) ?? [],
    })),
    edges,
    bounds: { x: 0, y: top, width, height: bottom - top },
  };
}

/** Đặt chip nhãn dọc đoạn ngang của cung, tránh chip khác và chân đứng của mọi cung. */
function placeLabels(edges: LayoutEdge[], nodeCount: number) {
  const legs: { edge: string; rect: Rect }[] = [];
  for (const e of edges) {
    const [a, b, c, d] = e.points;
    const pairs: [Pt, Pt][] = [
      [a, b],
      [c, d],
    ];
    for (const [p, q] of pairs) {
      legs.push({
        edge: e.id,
        rect: {
          x1: p.x - 3,
          x2: p.x + 3,
          y1: Math.min(p.y, q.y),
          y2: Math.max(p.y, q.y),
        },
      });
    }
  }
  const nodeRects: Rect[] = Array.from({ length: nodeCount }, (_, i) => ({
    x1: i * PITCH,
    x2: i * PITCH + NODE_W,
    y1: 0,
    y2: NODE_H,
  }));
  const placed: Rect[] = [];
  const order = [...edges].sort((a, b) => a.lane - b.lane);
  for (const e of order) {
    const [, m1, m2] = e.points;
    const xa = Math.min(m1.x, m2.x);
    const xb = Math.max(m1.x, m2.x);
    const { w, h, y } = e.label;
    const mid = (xa + xb) / 2;
    const half = w / 2;
    const cands: number[] = [mid];
    for (let dx = 6; dx <= (xb - xa) / 2; dx += 6) cands.push(mid - dx, mid + dx);
    let best = mid;
    let bestScore = Infinity;
    for (const cx of cands) {
      const r: Rect = { x1: cx - half, x2: cx + half, y1: y - h / 2, y2: y + h / 2 };
      let score = 0;
      if (cx - half < xa + 2 || cx + half > xb - 2) score += 1; // tràn khỏi đoạn ngang của chính nó
      for (const l of legs) if (overlap(r, l.rect)) score += 1;
      for (const p of placed) if (overlap(r, p)) score += 1;
      for (const n of nodeRects) if (overlap(r, n)) score += 1;
      if (score < bestScore) {
        bestScore = score;
        best = cx;
        if (score === 0) break;
      }
    }
    e.label.x = best;
    placed.push({ x1: best - half, x2: best + half, y1: y - h / 2, y2: y + h / 2 });
  }
}
