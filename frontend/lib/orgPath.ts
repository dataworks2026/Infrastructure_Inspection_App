'use client';
import { useParams, usePathname } from 'next/navigation';

/** Routes that live outside the /[org] segment and must never be prefixed. */
const GLOBAL_ROUTES = ['/login'];

/**
 * Prefix an in-app path with the org slug: '/assets' -> '/gov-island/assets'.
 * Leaves alone: external/relative paths, global routes (login), and paths
 * that already carry the slug (so double-prefixing is impossible).
 */
export function withOrg(org: string | undefined, path: string): string {
  if (!org || !path.startsWith('/')) return path;
  if (GLOBAL_ROUTES.some(r => path === r || path.startsWith(`${r}/`))) return path;
  if (path === `/${org}` || path.startsWith(`/${org}/`)) return path;
  return `/${org}${path}`;
}

/** The org slug from the current URL, or undefined outside the [org] segment. */
export function useOrgSlug(): string | undefined {
  const params = useParams();
  const org = params?.org;
  return typeof org === 'string' ? org : undefined;
}

/** Returns a fn that prefixes an app path with the current org slug. */
export function useOrgPath() {
  const org = useOrgSlug();
  return (path: string) => withOrg(org, path);
}

/**
 * The current path with the org segment removed: '/gov-island/assets' -> '/assets'.
 * Use this for route COMPARISONS (active nav state, breadcrumbs, tour steps) so
 * they keep matching plain paths like '/dashboard' after org-scoping.
 */
export function useAppPathname(): string {
  const pathname = usePathname();
  const org = useOrgSlug();
  if (!org || !pathname.startsWith(`/${org}`)) return pathname;
  return pathname.slice(`/${org}`.length) || '/';
}
