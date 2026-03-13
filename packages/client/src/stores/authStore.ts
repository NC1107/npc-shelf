import { create } from 'zustand';

interface AuthState {
  accessToken: string | null;
  user: { id: number; username: string; role: string } | null;
  isAuthenticated: boolean;
  setupRequired: boolean | null;
  setAccessToken: (token: string) => void;
  setUser: (user: AuthState['user']) => void;
  setSetupRequired: (required: boolean) => void;
  login: (token: string, user: AuthState['user']) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  setupRequired: null,
  setAccessToken: (token) => set({ accessToken: token }),
  setUser: (user) => set({ user }),
  setSetupRequired: (required) => set({ setupRequired: required }),
  login: (token, user) =>
    set({ accessToken: token, user, isAuthenticated: true }),
  logout: () =>
    set({ accessToken: null, user: null, isAuthenticated: false }),
}));
