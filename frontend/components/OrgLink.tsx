'use client';
import NextLink from 'next/link';
import type { ComponentProps } from 'react';
import { useOrgPath } from '@/lib/orgPath';

type Props = ComponentProps<typeof NextLink>;

/**
 * Drop-in replacement for next/link that prefixes in-app paths with the
 * current org slug, so `href="/assets"` renders as `/gov-island/assets`.
 * Swap the import and every link in the file becomes org-aware.
 */
export default function OrgLink({ href, ...rest }: Props) {
  const orgPath = useOrgPath();
  return <NextLink href={typeof href === 'string' ? orgPath(href) : href} {...rest} />;
}
