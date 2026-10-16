import { create } from 'zustand';
import type { AuthMeDto, MembershipDto, PermissionKey, UserDto } from '@tirapro/types';
import { api, refreshAccessToken } from '@/lib/api';
import { setAccessToken } from '@/lib/auth-token';
import { clearSessionCaches } from '@/lib/sessionCache';
import { disconnectSocket } from '@/lib/socket';

interface AuthState {
  status: 'loading' | 'authed' | 'guest';
  user: UserDto | null;
  workspaceId: string | null;
  permissions: PermissionKey[];
  /** Vai trò của người dùng (cấp workspace + từng dự án) — dùng suy ra vai (dev/tester/BA) ở trang chủ. */
  memberships: MembershipDto[];
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    displayName: string;
    workspaceName?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  can: (perm: PermissionKey) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  workspaceId: null,
  permissions: [],
  memberships: [],

  async login(email, password) {
    const res = await api.post<{ accessToken: string }>('/auth/login', { email, password });
    setAccessToken(res.data.accessToken);
    await loadMe(set);
  },

  async register(input) {
    const res = await api.post<{ accessToken: string }>('/auth/register', input);
    setAccessToken(res.data.accessToken);
    await loadMe(set);
  },

  async logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    setAccessToken(null);
    disconnectSocket(); // ngắt socket của phiên cũ → không giữ room/quyền của tài khoản trước
    clearSessionCaches(); // xoá cache theo phiên → không rò dữ liệu sang tài khoản khác
    set({ status: 'guest', user: null, workspaceId: null, permissions: [], memberships: [] });
  },

  async bootstrap() {
    // Dùng chung single-flight refresh với interceptor (không refresh chồng, không xoay refresh-token 2 lần).
    const token = await refreshAccessToken();
    if (!token) {
      set({ status: 'guest', user: null, workspaceId: null, permissions: [], memberships: [] });
      return;
    }
    try {
      await loadMe(set);
    } catch {
      setAccessToken(null);
      set({ status: 'guest', user: null, workspaceId: null, permissions: [], memberships: [] });
    }
  },

  can(perm) {
    const s = get();
    return s.user?.isSystemAdmin === true || s.permissions.includes(perm);
  },
}));

async function loadMe(set: (p: Partial<AuthState>) => void) {
  const me = await api.get<AuthMeDto>('/auth/me');
  set({
    status: 'authed',
    user: me.data.user,
    workspaceId: me.data.workspaceId,
    permissions: me.data.permissions,
    memberships: me.data.memberships ?? [],
  });
}

// Đăng xuất khi refresh thất bại (phát từ api interceptor)
if (typeof window !== 'undefined') {
  window.addEventListener('tirapro:logout', () => {
    setAccessToken(null);
    clearSessionCaches();
    useAuth.setState({
      status: 'guest',
      user: null,
      workspaceId: null,
      permissions: [],
      memberships: [],
    });
  });
}
