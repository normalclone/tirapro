import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProfilePanel } from './ProfilePanel';

// renderToStaticMarkup đọc state khởi tạo của zustand → giả lập selector thay vì setState.
const state = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));
vi.mock('@/stores/auth', () => ({
  useAuth: (sel: (s: { user: unknown }) => unknown) => sel({ user: state.user }),
}));

const HINT = 'Chỉ quản trị hệ thống đổi được họ tên, email và ảnh đại diện.';

function html(isSystemAdmin: boolean) {
  state.user = {
    id: 'u1',
    displayName: 'Bình',
    email: 'b@x',
    avatarUrl: 'http://x/a.png',
    timezone: 'Asia/Ho_Chi_Minh',
    locale: 'vi',
    isSystemAdmin,
  };
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ProfilePanel />
    </QueryClientProvider>,
  );
}

describe('ProfilePanel — họ tên/ảnh chỉ quản trị hệ thống', () => {
  it('người thường: ô họ tên chỉ đọc + gợi ý, không có nút gỡ ảnh', () => {
    const out = html(false);
    expect(out).toContain(HINT);
    expect(out).toMatch(
      /<input(?=[^>]*placeholder="Nguyễn Văn A")(?=[^>]*readonly="")(?=[^>]*aria-readonly="true")/,
    );
    expect(out).not.toMatch(/<input(?=[^>]*placeholder="Nguyễn Văn A")(?=[^>]*disabled="")/);
    expect(out).toMatch(/<button(?=[^>]*disabled="")[^>]*>(?:(?!<\/button>).)*Đổi ảnh/s);
    expect(out).not.toContain('Gỡ');
  });
  it('quản trị hệ thống: không có gợi ý, ô họ tên sửa được', () => {
    const out = html(true);
    expect(out).not.toContain(HINT);
    expect(out).not.toMatch(
      /<input(?=[^>]*placeholder="Nguyễn Văn A")(?=[^>]*(?:readonly|disabled)="")/,
    );
    expect(out).toContain('Gỡ');
  });
});
