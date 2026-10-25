/**
 * Chạy `fn` cho từng phần tử với tối đa `limit` việc đồng thời; kết quả giữ đúng thứ tự `items`.
 * `fn` ném lỗi → lỗi đầu tiên được ném lại sau khi các việc đang chạy kết thúc (không bắt đầu việc mới).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  const settled = await Promise.allSettled(workers);
  const bad = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (bad) throw bad.reason;
  return results;
}
