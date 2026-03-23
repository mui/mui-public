'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';

interface NpmDownloadsLinkProps extends Omit<React.ComponentProps<typeof Link>, 'href'> {
  packages?: string[];
  baseline?: string | null;
  children: React.ReactNode;
}

export const NPM_DOWNLOADS_PATH = '/npm-downloads';

export function NpmDownloadsLink({
  packages,
  baseline,
  children,
  ...props
}: NpmDownloadsLinkProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const isOnDownloadsPage = pathname === NPM_DOWNLOADS_PATH;

  const href = React.useMemo(() => {
    const newParams = new URLSearchParams(searchParams.toString());

    if (packages !== undefined) {
      newParams.set('packages', packages.join(','));
    }
    if (baseline !== undefined) {
      if (baseline === null) {
        newParams.delete('baseline');
      } else {
        newParams.set('baseline', baseline);
      }
    }

    return `${NPM_DOWNLOADS_PATH}?${newParams}`;
  }, [searchParams, packages, baseline]);

  // Only replace history and prevent scroll when already on the downloads page
  const shouldReplace = isOnDownloadsPage;
  const shouldPreventScroll = isOnDownloadsPage;

  return (
    <Link href={href} replace={shouldReplace} scroll={!shouldPreventScroll} {...props}>
      {children}
    </Link>
  );
}
