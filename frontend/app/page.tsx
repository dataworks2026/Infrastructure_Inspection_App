'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, getUser, saveUser } from '@/lib/auth';
import { authApi } from '@/lib/api';
import type { User } from '@/types';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
      return;
    }
    const slug = getUser()?.organization_slug;
    if (slug) {
      router.replace(`/${slug}/dashboard`);
      return;
    }
    // Session predates org-scoped URLs (no slug cached) — ask the server for it
    // so existing logins keep working without forcing a re-login.
    authApi.me()
      .then((fresh: User) => {
        saveUser(fresh);
        router.replace(fresh.organization_slug ? `/${fresh.organization_slug}/dashboard` : '/login');
      })
      .catch(() => router.replace('/login'));
  }, [router]);
  return (
    <div className="min-h-screen bg-mira-bg flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-2 border-mira-blue border-t-transparent rounded-full animate-spin" />
        <div className="text-mira-muted text-sm font-medium">Loading Mira Intel...</div>
      </div>
    </div>
  );
}
