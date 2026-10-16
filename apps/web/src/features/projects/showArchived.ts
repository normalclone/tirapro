import { useState } from 'react';

/** localStorage: bật "Hiện đã lưu trữ" ở danh sách dự án — dùng chung giữa rail và trang Dự án. */
const SHOW_ARCHIVED_KEY = 'tirapro:showArchivedProjects';

/** Chọn "Hiện đã lưu trữ" được nhớ theo trình duyệt (chỉ là tiện ích, không có vẫn chạy). */
export function useShowArchived(): [boolean, (v: boolean) => void] {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(SHOW_ARCHIVED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = (v: boolean) => {
    setShow(v);
    try {
      localStorage.setItem(SHOW_ARCHIVED_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  return [show, set];
}
