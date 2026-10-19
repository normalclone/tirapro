import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UserDto } from '@tirapro/types';
import type { SearchSelectOption } from '@/components/ui/SearchSelect';
import type { RoleOption } from '@/components/ui/RoleMultiSelect';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { registerSessionCleaner } from '@/lib/sessionCache';
import { useSearchUsers } from './api';
import { showTypeToSearchHint } from './userSearch';

/** Người đã thấy trong phiên (từ mọi lần tìm) — tra tên cho giá trị đã chọn khi họ không nằm trong kết quả hiện tại. */
const seenUsers = new Map<string, UserDto>();
registerSessionCleaner(() => seenUsers.clear());

const toOption = (u: UserDto): SearchSelectOption => ({
  value: u.id,
  label: u.displayName,
  hint: u.email,
});

/**
 * MỘT nguồn chọn người phía máy chủ cho mọi bộ chọn (SearchSelect, RoleMultiSelect, danh sách tuỳ biến): debounce 200ms,
 * kết quả cũ không đè mới (khoá truy vấn theo từ khoá), mặc định loại tài khoản khoá, có `projectId` khi ngữ cảnh là một dự án.
 * `resolve*` tra tên theo id kể cả tài khoản đã khoá hoặc người ngoài trang kết quả (includeInactive, 200 người) — để
 * giá trị đã chọn/bản ghi cũ không mất tên.
 */
export function useUserSelect(opts: { projectId?: string; enabled?: boolean } = {}) {
  const { projectId, enabled = true } = opts;
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q, 200);
  const results = useSearchUsers({ projectId, search, enabled });
  const lookup = useSearchUsers({ projectId, includeInactive: true, limit: 200, enabled });
  const users = results.data;

  useEffect(() => {
    for (const u of [...(lookup.data ?? []), ...(users ?? [])]) seenUsers.set(u.id, u);
  }, [lookup.data, users]);

  const options = useMemo(() => (users ?? []).map(toOption), [users]);
  const roleOptions = useMemo<RoleOption[]>(
    () => (users ?? []).map((u) => ({ id: u.id, name: u.displayName })),
    [users],
  );
  const find = useCallback(
    (id: string) =>
      (users ?? []).find((u) => u.id === id) ??
      (lookup.data ?? []).find((u) => u.id === id) ??
      seenUsers.get(id),
    [users, lookup.data],
  );
  const resolveOption = useCallback(
    (id: string) => {
      const u = find(id);
      return u ? toOption(u) : undefined;
    },
    [find],
  );
  const resolveRole = useCallback(
    (id: string): RoleOption | undefined => {
      const u = find(id);
      return u ? { id: u.id, name: u.displayName } : undefined;
    },
    [find],
  );
  return {
    users: users ?? [],
    options,
    roleOptions,
    resolveOption,
    resolveRole,
    onSearchChange: setQ,
    moreHint: showTypeToSearchHint((users ?? []).length, q),
    loading: results.isPending,
  };
}
