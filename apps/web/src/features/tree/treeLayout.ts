/**
 * Bố cục cột của Cây việc (TIRA-BUG-21). Giữ MỌI cột ở bề rộng của chúng — khung xem nhanh (30rem) hay cửa sổ hẹp làm bảng chật
 * thì bảng CUỘN NGANG trong khung chứa, không bóp cột: cột tiêu đề có sàn `TITLE_MIN_REM` (đủ cho loại + mã + chữ tiêu đề + hạn,
 * các mảnh `shrink-0`), mmọi hàng (kể cả hàng tiêu đề cột) cùng một lưới nên luôn thẳng hàng.
 *
 * Tailwind chỉ nhận class viết nguyên chuỗi nên hai hằng class bên dưới là literal; `treeLayout.test.ts` kiểm chúng khớp số liệu
 * (sàn bảng = cột + khoảng cách + lề hàng) để đổi một cột mà quên sàn sẽ đỏ test.
 */
export const TREE_COLUMNS_REM = { title: 26, status: 9, assignee: 11, priority: 6, points: 4.5 };
/** `gap-3` giữa các cột và `px-3` hai bên mỗi hàng (rem). */
export const TREE_GAP_REM = 0.75;
export const TREE_ROW_PAD_REM = 0.75;

/**
 * Hàng tiêu đề + mọi hàng dữ liệu. Dưới `sm` chỉ còn cột tiêu đề (4 cột phụ không vừa 390px): trạng thái hiện bằng chấm màu cạnh mã,
 * hạn chót vẫn có nhãn.
 */
export const GRID_COLS =
  'grid grid-cols-[minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(26rem,1fr)_9rem_11rem_6rem_4.5rem]';

/** Sàn bề rộng của khung bảng từ `sm` trở lên: hẹp hơn thì khung chứa cuộn ngang (các hàng không co dưới sàn này). */
export const TREE_TABLE_MIN_W_CLS = 'sm:min-w-[61rem]';
