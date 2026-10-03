'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AssistantWidget } from './assistant-widget';
import { Sidebar } from './sidebar';
import { TopBar } from './topbar';

/**
 * The application shell.
 *
 * The important structural choice: the outer element is `h-dvh
 * overflow-hidden`, so the *page* never scrolls — only the main column does.
 * That is what keeps the sidebar and the top bar fixed on a long report
 * instead of sliding away with the content, and it is how Counselling CRM is
 * built too.
 *
 * On desktop the sidebar is `fixed` with an equal-width spacer beside it, so a
 * hover-expanded rail overlays the content rather than shoving it sideways.
 * Below `lg` it becomes an off-canvas drawer.
 */
export function DashboardShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  // Read the stored preference after mount. Doing it in useState's initialiser
  // would run during SSR, where localStorage does not exist.
  useEffect(() => {
    try {
      if (localStorage.getItem('ads-crm-sidebar-collapsed') === 'true') setCollapsed(true);
    } catch {
      // Private mode or blocked storage — the default (expanded) is fine.
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem('ads-crm-sidebar-collapsed', String(!prev));
      } catch {
        /* preference just won't persist */
      }
      return !prev;
    });
  };

  // Navigating should close the drawer, or it covers the page you just opened.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Stop the page behind the drawer scrolling under the user's finger.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-muted/30">
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 animate-fade-in lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Spacer reserving the rail's width, so fixed positioning doesn't put
          the sidebar on top of the content. */}
      <div
        className={cn(
          'hidden shrink-0 transition-[width] duration-300 ease-in-out lg:block',
          collapsed ? 'w-16' : 'w-64'
        )}
        aria-hidden="true"
      />

      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out',
          drawerOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <Sidebar
          collapsed={collapsed}
          onCollapse={toggleCollapsed}
          onClose={() => setDrawerOpen(false)}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar onMenuClick={() => setDrawerOpen(true)} />
        {/* The only scrolling region on the page. */}
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>

      {/* In the shell, not on a route: a question about a number is asked
          while looking at it, and because a layout does not remount between
          pages the conversation survives navigating the dashboard. */}
      <AssistantWidget />
    </div>
  );
}
