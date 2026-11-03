/** Chọn nhiều công việc để gắn mục tiêu: trạng thái "chọn tất cả" + công tắc chọn/bỏ tất cả (không đụng việc đã chọn ngoài danh sách đang hiện). */
export function pickState(picked: string[], selectable: string[]): 'all' | 'some' | 'none' {
  if (selectable.length === 0) return 'none';
  const n = selectable.filter((id) => picked.includes(id)).length;
  return n === selectable.length ? 'all' : n > 0 ? 'some' : 'none';
}

export function toggleAllPicked(picked: string[], selectable: string[]): string[] {
  return pickState(picked, selectable) === 'all'
    ? picked.filter((id) => !selectable.includes(id))
    : [...picked, ...selectable.filter((id) => !picked.includes(id))];
}
