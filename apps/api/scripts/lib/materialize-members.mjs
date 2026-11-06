/**
 * Dự án công khai chuyển sang "chỉ xem": Organization Member không còn vai trò Developer mặc định ở mọi dự án công khai. Để không ai
 * mất quyền, người ĐÃ LÀM VIỆC trong một dự án công khai (tạo/được giao/bình luận/log giờ/tham gia việc) mà chưa có dòng thành viên
 * dự án thì được tạo dòng với vai trò Developer. Hàm thuần (không DB) để test được.
 *
 * `activeUserIds`: người có hoạt động trong dự án; `memberOnlyIds`: người giữ vai trò "Organization Member" (không phải Quản trị /
 * Người xem — họ vốn đã có/không cần vai trò dự án mặc định); `existingIds`: người đã có ProjectMembership ở dự án.
 * Trả về userId cần tạo, sắp xếp ổn định.
 */
export function selectToMaterialize({ activeUserIds, memberOnlyIds, existingIds }) {
  const member = new Set(memberOnlyIds);
  const existing = new Set(existingIds);
  return [...new Set(activeUserIds)].filter((id) => member.has(id) && !existing.has(id)).sort();
}
