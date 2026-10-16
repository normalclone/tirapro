/** Tiêu đề nhóm cần vẽ TRƯỚC lựa chọn thứ `index`: có khi nó mở đầu một nhóm (`group` khác lựa chọn liền trước), ngược lại `null`. */
export function groupHeadingAt(
  options: ReadonlyArray<{ group?: string }>,
  index: number,
): string | null {
  const group = options[index]?.group;
  return group && group !== options[index - 1]?.group ? group : null;
}
