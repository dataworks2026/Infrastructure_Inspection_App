'use client';
import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

/**
 * Bare /:org lands on the dashboard. Also the landing spot for pre-org-scoping
 * bookmarks: /dashboard is read as org="dashboard", corrected to /:slug by the
 * layout guard, and sent here — so an old link resolves instead of 404-ing.
 */
export default function OrgIndex() {
  const router = useRouter();
  const params = useParams();
  const org = typeof params?.org === 'string' ? params.org : '';
  useEffect(() => {
    router.replace(org ? `/${org}/dashboard` : '/');
  }, [router, org]);
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
