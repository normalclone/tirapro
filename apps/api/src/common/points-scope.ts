import type { Prisma } from '@prisma/client';

/**
 * Điểm của Epic = tổng điểm các việc cấp trên thuộc Epic, và điểm của việc CHA (có ≥1 việc con chưa xoá) = tổng điểm
 * các việc con (`PointsService.rollupEpics` / `rollupParents`). Vì thế mọi phép CỘNG điểm phía server (sprint, báo cáo,
 * burndown, KR, tải công việc…) chỉ đếm VIỆC LÁ: bỏ Epic và bỏ việc đang có việc con chưa xoá — nếu không điểm của cha và
 * của từng việc con bị đếm đôi (và công không ghi đúng cho người làm việc con). Dùng cho các truy vấn chỉ để cộng điểm
 * (số ĐẾM việc giữ nguyên, truy vấn riêng). Hiển thị điểm TỪNG việc không dùng bộ lọc này.
 * `NOT: { type }` (không phải `key: { not: 'EPIC' }`) để loại có chủ đích mà vẫn giữ loại tuỳ chỉnh có `key` null.
 */
export const LEAF_POINTS_ONLY: Prisma.IssueWhereInput = {
  NOT: { type: { key: 'EPIC' } },
  children: { none: { deletedAt: null } },
};

/** Phần chọn thêm để lọc việc lá trong bộ nhớ (`countsTowardPoints`): số việc con chưa xoá. */
export const LIVE_CHILD_COUNT = {
  _count: { select: { children: { where: { deletedAt: null } } } },
} satisfies Prisma.IssueSelect;

/** Cùng ý nghĩa với `LEAF_POINTS_ONLY` cho hàng đã nạp sẵn `type.key` + `_count.children` (cộng điểm trong bộ nhớ). */
export const countsTowardPoints = (issue: {
  type: { key: string | null };
  _count: { children: number };
}): boolean => issue.type.key !== 'EPIC' && issue._count.children === 0;
