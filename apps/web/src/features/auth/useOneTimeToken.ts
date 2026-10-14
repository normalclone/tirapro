import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

/**
 * Đọc `?token=` từ URL vào state rồi xoá nó khỏi thanh địa chỉ (replace) để token một-lần không nằm lại
 * trong lịch sử trình duyệt / Referer. State giữ giá trị nên xoá khỏi URL không làm mất token.
 */
export function useOneTimeToken(): string {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [token] = useState(() => params.get('token') ?? '');
  useEffect(() => {
    if (token) navigate(location.pathname, { replace: true });
    // Chỉ chạy một lần lúc mở trang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return token;
}
