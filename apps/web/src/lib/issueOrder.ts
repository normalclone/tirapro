/** Sắp xếp task: ưu tiên cao trước, rồi tới trạng thái (To Do → Đang làm → Hoàn thành). */

type Orderable = {
  priority: { rank: number } | null;
  status: { category: string };
  rank: string;
};

const CATEGORY_ORDER: Record<string, number> = { TODO: 0, IN_PROGRESS: 1, DONE: 2 };

/**
 * So sánh theo độ ưu tiên (rank cao = ưu tiên cao → đứng trước), sau đó tới trạng thái,
 * cuối cùng giữ ổn định theo LexoRank. Issue không có priority xếp sau cùng.
 */
export function byPriorityThenStatus(a: Orderable, b: Orderable): number {
  const pa = a.priority?.rank ?? -Infinity;
  const pb = b.priority?.rank ?? -Infinity;
  if (pa !== pb) return pb - pa;
  const ca = CATEGORY_ORDER[a.status.category] ?? 99;
  const cb = CATEGORY_ORDER[b.status.category] ?? 99;
  if (ca !== cb) return ca - cb;
  return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
}
