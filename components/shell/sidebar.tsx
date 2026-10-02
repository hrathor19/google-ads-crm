'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/components/providers/permission-provider';
import { BrandMark } from './brand-mark';
import { NAV_SECTIONS, type NavItem } from './nav-items';

/**
 * The sidebar, following Counselling CRM's pattern so the two apps feel like
 * one product: 64px collapsed, 256px expanded, and hovering a collapsed rail
 * expands it as an overlay rather than pushing the page around.
 *
 * It does not scroll with the page. The shell gives the viewport a fixed
 * height and scrolls only the main column, so the nav stays put — which is
 * both what you expect from an application and what stops the brand sliding
 * off the top on a long report.
 */

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export function Sidebar({
  collapsed = false,
  onCollapse,
  onClose,
}: {
  collapsed?: boolean;
  onCollapse?: () => void;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const { can, canAny, user } = usePermissions();
  const [hovered, setHovered] = useState(false);

  // Collapsed, but hovered, reads as expanded — without changing the layout
  // underneath, because the rail is positioned over the content.
  const isExpanded = !collapsed || hovered;

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        canAny(...item.requires) && (item.requiresAll ?? []).every(([m, a]) => can(m, a))
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <aside
      onMouseEnter={() => collapsed && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        // h-dvh rather than h-screen: 100vh does not shrink for a mobile
        // browser's address bar, which pushes the last nav item below the fold
        // with no way to reach it.
        'flex h-dvh flex-col overflow-hidden border-r bg-card',
        'transition-[width] duration-300 ease-in-out',
        isExpanded ? 'w-64' : 'w-16',
        collapsed && hovered && 'shadow-2xl'
      )}
    >
      {/* ── Brand ── */}
      <div className="flex h-16 shrink-0 items-center border-b">
        {isExpanded ? (
          <div className="flex w-full items-center gap-2.5 px-4">
            <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2.5">
              <BrandMark className="h-6 w-7 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-bold leading-tight tracking-tight">
                  KollegeApply
                </span>
                <span className="mt-0.5 block text-[10px] leading-none tracking-wide text-muted-foreground">
                  Ads CRM
                </span>
              </span>
            </Link>

            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                title={collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
                aria-label={collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
                className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
              >
                {collapsed ? (
                  <ChevronsRight className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            )}

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close menu"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex w-full flex-col items-center justify-center gap-1 py-2">
            <Link href="/dashboard" aria-label="KollegeApply Ads CRM">
              <BrandMark className="h-5 w-6" />
            </Link>
            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                title="Pin sidebar open"
                aria-label="Pin sidebar open"
                className="hidden h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground lg:flex"
              >
                <ChevronsRight className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav
        className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3"
        aria-label="Main"
      >
        {sections.map((section) => (
          <div key={section.title} className="mb-5 last:mb-0">
            {isExpanded ? (
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </p>
            ) : (
              // A rule instead of a heading: the label cannot fit at 64px, but
              // the grouping is still information worth keeping.
              <div className="mx-2 mb-2 border-t" aria-hidden="true" />
            )}

            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? 'page' : undefined}
                      // The label is the accessible name when expanded; when
                      // collapsed it is visually gone, so title carries it.
                      title={isExpanded ? undefined : item.label}
                      className={cn(
                        'group relative flex items-center rounded-lg text-sm font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                        isExpanded ? 'gap-3 px-3 py-2' : 'justify-center px-0 py-2.5',
                        active
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {isExpanded ? (
                        <span className="truncate">{item.label}</span>
                      ) : (
                        <span className="sr-only">{item.label}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── Who is signed in ── */}
      <div className="shrink-0 border-t p-2">
        <div
          className={cn(
            'flex items-center rounded-lg px-2 py-2',
            isExpanded ? 'gap-2.5' : 'justify-center'
          )}
          title={isExpanded ? undefined : `${user.name} — ${user.roleName}`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
            {user.name
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </span>
          {isExpanded && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{user.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {user.roleName}
              </span>
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
