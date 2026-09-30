import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  BellRing,
  ListChecks,
  ClipboardList,
  FileSearch,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LineChart,
  PlugZap,
  Search,
  Shield,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import type { Action } from '@/lib/rbac/features';

/**
 * The sidebar. Each item declares the permission that reveals it, so the menu
 * is derived from the matrix rather than from a role name — a custom role with
 * the right toggles gets the right menu with no change here.
 */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Any one of these grants the item. */
  requires: Array<[string, Action]>;
  /** Exact match only — stops the dashboard root highlighting on every page. */
  exact?: boolean;
};

export type NavSection = { title: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Performance',
    items: [
      {
        href: '/dashboard',
        label: 'Overview',
        icon: LayoutDashboard,
        requires: [['DASHBOARD', 'VIEW']],
        exact: true,
      },
      { href: '/dashboard/accounts', label: 'Accounts', icon: Wallet, requires: [['ACCOUNTS', 'VIEW']] },
      { href: '/dashboard/campaigns', label: 'Campaigns', icon: BarChart3, requires: [['CAMPAIGNS', 'VIEW']] },
      { href: '/dashboard/keywords', label: 'Keywords', icon: KeyRound, requires: [['KEYWORDS', 'VIEW']] },
      { href: '/dashboard/search-terms', label: 'Search terms', icon: Search, requires: [['KEYWORDS', 'VIEW']] },
      { href: '/dashboard/segments', label: 'Devices & geo', icon: Gauge, requires: [['CAMPAIGNS', 'VIEW']] },
      {
        href: '/dashboard/priorities',
        label: 'Priority queue',
        icon: ListChecks,
        requires: [['CAMPAIGNS', 'VIEW']],
      },
      { href: '/dashboard/alerts', label: 'Alerts', icon: BellRing, requires: [['DASHBOARD', 'VIEW']] },
      { href: '/dashboard/budgets', label: 'Budgets', icon: Wallet, requires: [['FINANCIALS', 'VIEW']] },
      { href: '/dashboard/trends', label: 'Trends', icon: LineChart, requires: [['DASHBOARD', 'VIEW']] },
      { href: '/dashboard/analytics', label: 'Analytics (GA4)', icon: Activity, requires: [['ANALYTICS', 'VIEW']] },
    ],
  },
  {
    title: 'Workflow',
    items: [
      {
        href: '/dashboard/ad-requests',
        label: 'Ad requests',
        icon: ClipboardList,
        requires: [['AD_REQUESTS', 'VIEW']],
      },
      {
        href: '/dashboard/ad-copy',
        label: 'AI ad copy',
        icon: Sparkles,
        requires: [['AD_COPY', 'VIEW']],
      },
      {
        href: '/dashboard/landing-score',
        label: 'Landing page scorer',
        icon: FileSearch,
        requires: [['LANDING_SCORE', 'VIEW']],
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      { href: '/dashboard/admin/users', label: 'Users', icon: Users, requires: [['USERS', 'VIEW']] },
      { href: '/dashboard/admin/roles', label: 'Roles & permissions', icon: Shield, requires: [['ROLES', 'VIEW']] },
      { href: '/dashboard/admin/audit', label: 'Audit log', icon: Activity, requires: [['AUDIT', 'VIEW']] },
      {
        href: '/dashboard/admin/integrations',
        label: 'Integrations health',
        icon: PlugZap,
        requires: [['INTEGRATIONS', 'VIEW']],
      },
    ],
  },
];
