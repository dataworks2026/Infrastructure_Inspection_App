import { AuthToken, User } from '@/types';

const TOKEN_KEY = 'mira_token';
const USER_KEY = 'mira_user';

export function saveAuth(token: AuthToken) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token.access_token);
  localStorage.setItem(USER_KEY, JSON.stringify({
    id: token.user_id, email: token.email,
    full_name: token.full_name, role: token.role
  }));
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): User | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearAuth() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
