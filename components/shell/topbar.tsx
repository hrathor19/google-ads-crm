'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import {
  Bell,
  Calendar,
  Check,
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Sun,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { RANGE_PRESETS, presetLabel } from '@/lib/dates-client';
import { useFilters } from '@/components/providers/filters-provider';
import { usePermissions } from '@/components/providers/permission-provider';
import { useApi, apiSend } from '@/lib/hooks/use-api';
import { useToast } from '@/components/ui/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { formatRelative } from '@/lib/format';

type AccountOption = { id: number; name: string | null; customerId: string };

/** Global account switcher. Searchable, because the MCC has 120+ children. */
function AccountSwitcher() {
  const { accountId, setAccount } = useFilters();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { data } = useApi<{ accounts: AccountOption[] }>(
    ['account-options'],
    '/api/accounts/options',
    { staleTime: 5 * 60_000 }
  );

  const accounts = data?.accounts ?? [];
  const selected = accounts.find((a) => a.id === accountId);
  const filtered = search
    ? accounts.filter(
        (a) =>
          (a.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
          a.customerId.includes(search)
      )
    : accounts;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="min-w-0 flex-1 justify-between gap-1.5 sm:max-w-[14rem] sm:flex-none"
          aria-label="Filter by account"
        >
          <span className="truncate">
            {selected ? (selected.name ?? selected.customerId) : 'All accounts'}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b p-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts…"
            className="h-8"
            aria-label="Search accounts"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          <button
            type="button"
            onClick={() => {
              setAccount(null);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <span>All accounts</span>
            {accountId === null && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setAccount(a.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span className="min-w-0 truncate">
                {a.name ?? 'Unnamed'}
                <span className="block text-xs text-muted-foreground">{a.customerId}</span>
              </span>
              {accountId === a.id && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No account matches “{search}”.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DateRangePicker() {
  const { preset, start, end, setPreset, setCustomRange } = useFilters();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(start ?? '');
  const [to, setTo] = useState(end ?? '');

  const label = preset === 'custom' ? `${start} → ${end}` : presetLabel(preset);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="min-w-0 flex-1 justify-between gap-1.5 sm:flex-none"
          aria-label="Change the date range"
        >
          <Calendar className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="space-y-0.5">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setPreset(p.key);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                preset === p.key && 'bg-accent font-medium'
              )}
            >
              {p.label}
              {preset === p.key && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="mt-2 space-y-2 border-t pt-2">
          <p className="text-xs font-medium text-muted-foreground">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="range-from" className="text-xs">
                From
              </Label>
              <Input
                id="range-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="range-to" className="text-xs">
                To
              </Label>
              <Input
                id="range-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={!from || !to || from > to}
            onClick={() => {
              setCustomRange(from, to);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useApi<{ items: NotificationRow[]; unread: number }>(
    ['notifications'],
    '/api/notifications?limit=12',
    { refetchInterval: 60_000 }
  );

  const unread = data?.unread ?? 0;

  async function markAllRead() {
    await apiSend('/api/notifications/read-all', 'POST');
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className={cn('h-4 w-4', unread > 0 && 'animate-bell-shake')} aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllRead}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {(data?.items ?? []).length === 0 && (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              Nothing yet. Status changes on your requests will show up here.
            </p>
          )}
          {(data?.items ?? []).map((n) => {
            const content = (
              <div
                className={cn(
                  'border-b px-3 py-2.5 text-sm last:border-b-0',
                  !n.readAt && 'bg-primary/5'
                )}
              >
                <p className="font-medium leading-snug">{n.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatRelative(n.createdAt)}
                </p>
              </div>
            );
            return n.link ? (
              <Link key={n.id} href={n.link} onClick={() => setOpen(false)} className="block hover:bg-accent">
                {content}
              </Link>
            ) : (
              <div key={n.id}>{content}</div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RefreshButton() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);

  if (!can('SYNC', 'CREATE')) return null;

  async function refresh() {
    setRunning(true);
    toast({
      title: 'Refresh started',
      description: 'Pulling the latest data from Google Ads. This can take a few minutes.',
    });
    try {
      const result = await apiSend<{ totals: { inserted: number }; accountsProcessed: number }>(
        '/api/sync',
        'POST',
        { entities: ['campaigns'], lookbackDays: 3 }
      );
      toast({
        title: 'Refresh complete',
        description: `${result.accountsProcessed} account(s), ${result.totals.inserted} row(s) written.`,
      });
      queryClient.invalidateQueries();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Refresh failed',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={refresh}
      disabled={running}
      aria-label="Refresh data from Google Ads"
    >
      <RefreshCw className={cn('h-4 w-4', running && 'animate-spin')} aria-hidden="true" />
    </Button>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" aria-hidden="true" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" aria-hidden="true" />
    </Button>
  );
}

function UserMenu() {
  const { user } = usePermissions();
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials || <User className="h-3.5 w-3.5" aria-hidden="true" />}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <Badge variant="secondary" className="mt-1.5 text-[10px]">
            {user.roleName}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut({ callbackUrl: '/login' })}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    // No `sticky` needed: the shell scrolls only the main column, so the bar
    // is already fixed relative to the viewport.
    <header className="z-40 shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onMenuClick}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>

        {/* From sm up the filters sit inline with the actions. */}
        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          <div className="hidden min-w-0 items-center gap-2 sm:flex">
            <AccountSwitcher />
            <DateRangePicker />
          </div>
          <RefreshButton />
          <NotificationBell />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>

      {/* Below sm they get a row of their own, each taking half the width. */}
      <div className="flex items-center gap-2 border-t px-3 py-2 sm:hidden">
        <AccountSwitcher />
        <DateRangePicker />
      </div>
    </header>
  );
}
