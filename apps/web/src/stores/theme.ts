import { create } from 'zustand';

type Theme = 'light' | 'dark';

function current(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try { localStorage.setItem('tirapro-theme', theme); } catch { /* ignore */ }
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (t: Theme) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  theme: current(),
  toggle: () => set((s) => { const t = s.theme === 'dark' ? 'light' : 'dark'; apply(t); return { theme: t }; }),
  set: (t) => { apply(t); set({ theme: t }); },
}));
