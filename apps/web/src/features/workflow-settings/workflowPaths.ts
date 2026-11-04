/**
 * Đường đi từ một trạng thái trong sơ đồ quy trình (hàm thuần).
 *
 * - `direct`: chuyển tiếp ĐI RA trực tiếp từ trạng thái (kể cả "từ mọi trạng thái" — chuyển tiếp không có nguồn áp dụng cho mọi trạng thái).
 * - `future`: chuyển tiếp còn lại có thể đi tiếp SAU đó — duyệt theo bề rộng (BFS) và chỉ lấy cung tiến ra xa trạng thái đã chọn
 *   (đích xa hơn nguồn theo số bước); cung quay về trạng thái đã thăm hoặc nối ngang cùng bậc bị bỏ để vòng lặp không lấn át.
 * - `incoming`: chuyển tiếp ĐI VÀO trạng thái (để thấy "làm sao tới đây").
 */
import type { Workflow } from './api';

export type PathWorkflow = Pick<Workflow, 'statuses' | 'transitions'>;

export interface Reachability {
  direct: Set<string>;
  future: Set<string>;
  incoming: Set<string>;
  /** Trạng thái đã chọn + mọi trạng thái nằm trên đường đi (đích của direct/future, nguồn của incoming). */
  nodes: Set<string>;
  directNodes: Set<string>;
  futureNodes: Set<string>;
  incomingNodes: Set<string>;
}

export function reachability(wf: PathWorkflow, statusId: string): Reachability {
  const known = new Set(wf.statuses.map((s) => s.id));
  const out = new Map<string, PathWorkflow['transitions']>();
  const direct = new Set<string>();
  const incoming = new Set<string>();
  const depth = new Map<string, number>([[statusId, 0]]);
  const queue: string[] = [];
  const directNodes = new Set<string>();
  const incomingNodes = new Set<string>();

  for (const t of wf.transitions) {
    if (!known.has(t.toStatusId)) continue;
    if (t.fromStatusId == null) {
      // "Từ mọi trạng thái": đi ra được từ trạng thái đang xét (trừ khi chính là đích).
      if (t.toStatusId !== statusId) {
        direct.add(t.id);
        directNodes.add(t.toStatusId);
      }
      continue;
    }
    if (!known.has(t.fromStatusId) || t.fromStatusId === t.toStatusId) continue;
    const list = out.get(t.fromStatusId) ?? [];
    list.push(t);
    out.set(t.fromStatusId, list);
    if (t.fromStatusId === statusId) {
      direct.add(t.id);
      directNodes.add(t.toStatusId);
    }
    if (t.toStatusId === statusId) {
      incoming.add(t.id);
      incomingNodes.add(t.fromStatusId);
    }
  }

  for (const id of directNodes) {
    depth.set(id, 1);
    queue.push(id);
  }
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head]!;
    for (const t of out.get(u) ?? []) {
      if (depth.has(t.toStatusId)) continue;
      depth.set(t.toStatusId, depth.get(u)! + 1);
      queue.push(t.toStatusId);
    }
  }

  const future = new Set<string>();
  const futureNodes = new Set<string>();
  for (const [from, list] of out) {
    if (from === statusId || !depth.has(from)) continue;
    for (const t of list) {
      if ((depth.get(t.toStatusId) ?? -1) > depth.get(from)!) {
        future.add(t.id);
        futureNodes.add(t.toStatusId);
      }
    }
  }

  const nodes = new Set<string>([statusId]);
  for (const s of [directNodes, futureNodes, incomingNodes]) for (const id of s) nodes.add(id);
  return { direct, future, incoming, nodes, directNodes, futureNodes, incomingNodes };
}

/** Vai trò hiển thị của cung/node so với trạng thái đang chọn. */
export type Emphasis = 'direct' | 'future' | 'incoming' | 'dim';
export type NodeEmphasis = Emphasis | 'selected';

/** Cung: direct > incoming > future; còn lại mờ. `null` chọn = không nhấn mạnh gì (mọi thứ bình thường). */
export function edgeEmphasis(r: Reachability | null, transitionId: string): Emphasis | null {
  if (!r) return null;
  if (r.direct.has(transitionId)) return 'direct';
  if (r.incoming.has(transitionId)) return 'incoming';
  if (r.future.has(transitionId)) return 'future';
  return 'dim';
}

export function nodeEmphasis(
  r: Reachability | null,
  selectedId: string | null,
  statusId: string,
): NodeEmphasis | null {
  if (!r || !selectedId) return null;
  if (statusId === selectedId) return 'selected';
  if (r.directNodes.has(statusId)) return 'direct';
  if (r.incomingNodes.has(statusId)) return 'incoming';
  if (r.futureNodes.has(statusId)) return 'future';
  return 'dim';
}

/** Bấm node đã chọn → bỏ chọn; bấm node khác → chọn node đó. */
export const toggleSelection = (current: string | null, clicked: string): string | null =>
  current === clicked ? null : clicked;

/**
 * Phím Esc: bỏ chọn khi người dùng đã tự chọn khác mặc định (`restingId`: trạng thái chọn sẵn của bề mặt, vd trạng thái hiện tại
 * trong popup xem quy trình). Đang ở trạng thái mặc định/không chọn thì để Esc đi tiếp (đóng popup).
 */
export const escapeClears = (selectedId: string | null, restingId: string | null): boolean =>
  selectedId !== null && selectedId !== restingId;
