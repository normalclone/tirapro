/** Kẹp về [0,1]. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * % hoàn thành (0–100, làm tròn) của một Key Result: `(value - start) / (target - start)` kẹp [0,1]; đo ngược
 * (start 6, target 0) vẫn đúng. start = target thì đạt/không đạt (100/0). MỘT công thức cho `toDto` và lịch sử.
 */
export function krProgress(start: number, target: number, value: number): number {
  const span = target - start;
  const ratio = span === 0 ? (value >= target ? 1 : 0) : clamp01((value - start) / span);
  return Math.round(ratio * 100) || 0; // `|| 0`: tránh -0 khi đo ngược và chưa nhúc nhích
}
