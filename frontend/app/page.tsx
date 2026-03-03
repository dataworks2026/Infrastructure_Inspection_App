'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(isAuthenticated() ? '/dashboard' : '/login');
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
