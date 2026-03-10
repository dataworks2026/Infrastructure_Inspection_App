import { AuthToken, User } from '@/types';

const TOKEN_KEY = 'mira_token';
const USER_KEY = 'mira_user';

export function saveAuth(token: AuthToken) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token.access_token);
  localStorage.setItem(USER_KEY, JSON.stringify({
    id: token.user_id, email: token.email,
    full_name: token.full_name, username: token.username,
    role: token.role,
    organization_id: token.organization_id,
    organization_name: token.organization_name,
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

/** Update only the user fields in localStorage without touching the JWT token */
export function saveUser(user: User) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_KEY, JSON.stringify({
    id: user.id, email: user.email,
    full_name: user.full_name,
    username: user.username,
    role: user.role,
    organization_id: user.organization_id,
    organization_name: user.organization_name,
  }));
}

export function clearAuth() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
