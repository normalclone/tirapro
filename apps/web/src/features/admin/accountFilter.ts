import { normalizeVi } from '@/lib/text';

export type AccountStatusFilter = 'ACTIVE' | 'DEACTIVATED';

interface Filterable {
  displayName: string;
  email: string;
  status: string;
}

/**
 * Lọc danh sách tài khoản phía client (danh sách "all-in-one", không phân trang): tìm theo tên/email KHÔNG phân biệt
 * dấu tiếng Việt và hoa thường ("binh" khớp "Bình"), kết hợp lọc theo trạng thái.
 */
export function filterAccounts<T extends Filterable>(
  users: readonly T[],
  opts: { search?: string; status?: AccountStatusFilter },
): T[] {
  const q = normalizeVi(opts.search ?? '');
  return users.filter((u) => {
    if (opts.status && u.status !== opts.status) return false;
    if (!q) return true;
    return normalizeVi(u.displayName).includes(q) || normalizeVi(u.email).includes(q);
  });
}
