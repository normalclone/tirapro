import { create } from 'zustand';
import type { AuthMeDto, PermissionKey, UserDto } from '@tirapro/types';
import { api, refreshAccessToken } from '@/lib/api';
import { setAccessToken } from '@/lib/auth-token';
import { queryClient } from '@/lib/queryClient';

interface AuthState {
  status: 'loading' | 'authed' | 'guest';
  user: UserDto | null;
  workspaceId: string | null;
  permissions: PermissionKey[];
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; displayName: string; workspaceName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  can: (perm: PermissionKey) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  workspaceId: null,
  permissions: [],

  async login(email, password) {
    const res = await api.post('/auth/login', { email, password });
    setAccessToken(res.data.accessToken);
    await loadMe(set);
  },

  async register(input) {
    const res = await api.post('/auth/register', input);
    setAccessToken(res.data.accessToken);
    await loadMe(set);
  },

  async logout() {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setAccessToken(null);
    queryClient.clear(); // xoá cache theo phiên → không rò dữ liệu sang tài khoản khác
    set({ status: 'guest', user: null, workspaceId: null, permissions: [] });
  },

  async bootstrap() {
    // Dùng chung single-flight refresh với interceptor (không refresh chồng, không xoay refresh-token 2 lần).
    const token = await refreshAccessToken();
    if (!token) {
      set({ status: 'guest', user: null, workspaceId: null, permissions: [] });
      return;
    }
    try {
      await loadMe(set);
    } catch {
      setAccessToken(null);
      set({ status: 'guest', user: null, workspaceId: null, permissions: [] });
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
  });
}

// Đăng xuất khi refresh thất bại (phát từ api interceptor)
if (typeof window !== 'undefined') {
  window.addEventListener('tirapro:logout', () => {
    setAccessToken(null);
    queryClient.clear();
    useAuth.setState({ status: 'guest', user: null, workspaceId: null, permissions: [] });
  });
}
