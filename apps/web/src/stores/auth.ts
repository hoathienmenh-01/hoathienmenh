import { defineStore } from 'pinia';
import type { PublicUser } from '@xuantoi/shared';
import * as api from '@/api/auth';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({ user: null, loading: false }),
  getters: {
    isAuthenticated: (s) => s.user !== null,
    isAdmin: (s) => s.user?.role === 'ADMIN',
  },
  actions: {
    async hydrate(): Promise<void> {
      try {
        this.user = await api.session();
      } catch {
        this.user = null;
      }
    },
    async login(email: string, password: string, rememberEmail = false): Promise<PublicUser> {
      this.loading = true;
      try {
        this.user = await api.login({ email, password, rememberEmail });
        return this.user;
      } finally {
        this.loading = false;
      }
    },
    async register(email: string, password: string): Promise<PublicUser> {
      this.loading = true;
      try {
        this.user = await api.register({ email, password });
        return this.user;
      } finally {
        this.loading = false;
      }
    },
    async logout(): Promise<void> {
      await api.logout();
      this.user = null;
    },
  },
});
