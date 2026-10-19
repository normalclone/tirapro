export type PriorityGlyph = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

/**
 * Vị trí của `rank` trong danh sách hạng của workspace (cao = quan trọng) → 1 trong 5 glyph.
 * Suy từ hạng chứ không từ màu: admin sửa được màu/tên/số mức, mũi tên vẫn đúng thứ bậc.
 */
export function priorityGlyph(rank: number, ranks: readonly number[]): PriorityGlyph {
  const sorted = [...new Set(ranks)].sort((a, b) => a - b);
  const n = sorted.length;
  const index = sorted.indexOf(rank);
  if (index < 0 || n < 2) return 'medium';
  if (n === 2) return index === 0 ? 'low' : 'high';
  if (n === 3) return (['low', 'medium', 'high'] as const)[index]!;
  const t = index / (n - 1);
  if (t <= 0.1) return 'lowest';
  if (t < 0.4) return 'low';
  if (t <= 0.6) return 'medium';
  if (t < 0.9) return 'high';
  return 'highest';
}
