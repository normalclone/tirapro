import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  UserCircle,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/stores/theme';

export interface AccountItem {
  key: 'account' | 'docs' | 'admin' | 'theme' | 'logout';
  label: string;
  Icon: LucideIcon;
  onSelect: () => void;
  /** Bấm xong KHÔNG đóng menu/sheet (đổi giao diện: để thấy kết quả ngay). */
  keepOpen?: boolean;
  /** Hành động phá huỷ/đăng xuất: nhấn màu danger và đứng riêng một nhóm. */
  danger?: boolean;
}

/**
 * Các mục tài khoản — nguồn DUY NHẤT cho menu người dùng desktop (`UserMenu`) và sheet "Tôi" trên mobile
 * (`MobileSheets`). Thứ tự: Tài khoản, Hướng dẫn sử dụng, [Quản trị hệ thống], Giao diện sáng/tối, Đăng xuất.
 */
export function useAccountItems(): AccountItem[] {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  if (!user) return [];
  const items: (AccountItem | false)[] = [
    { key: 'account', label: 'Tài khoản', Icon: UserCircle, onSelect: () => navigate('/account') },
    {
      key: 'docs',
      label: 'Hướng dẫn sử dụng',
      Icon: BookOpen,
      onSelect: () => navigate('/documentation'),
    },
    user.isSystemAdmin && {
      key: 'admin',
      label: 'Quản trị hệ thống',
      Icon: ShieldCheck,
      onSelect: () => navigate('/admin'),
    },
    {
      key: 'theme',
      label: theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối',
      Icon: theme === 'dark' ? Sun : Moon,
      onSelect: toggle,
      keepOpen: true,
    },
    {
      key: 'logout',
      label: 'Đăng xuất',
      Icon: LogOut,
      onSelect: () => void logout(),
      danger: true,
    },
  ];
  return items.filter((i): i is AccountItem => i !== false);
}
