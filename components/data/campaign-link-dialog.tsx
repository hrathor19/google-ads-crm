'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApi } from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';

/**
 * Pick the campaigns a request reports against.
 *
 * Multi-select because a client is rarely one campaign — the same brief
 * routinely runs three or four, and linking only the first would understate
 * every one of them.
 *
 * The whole scoped list is fetched once and filtered in the browser. That
 * keeps typing instant, and — the reason it matters here — a campaign that is
 * already ticked stays on screen when the search no longer matches it, so
 * nobody loses a selection they cannot see.
 */

const NONE = '__none__';

export type CampaignOption = {
  id: number;
  campaignId: string;
  name: string | null;
  status: string | null;
  accountId: number;
  accountName: string | null;
};

const STATUS_TONE: Record<string, string> = {
  ENABLED: 'text-emerald-600 dark:text-emerald-400',
  PAUSED: 'text-amber-600 dark:text-amber-400',
  REMOVED: 'text-muted-foreground',
};

export function CampaignLinkDialog({
  open,
  busy,
  currentAccountId,
  currentCampaignIds,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  currentAccountId: number | null;
  currentCampaignIds: number[];
  onCancel: () => void;
  onConfirm: (payload: { campaignIds: number[]; accountId: number | null }) => void;
}) {
  const [accountId, setAccountId] = useState(NONE);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [onlyEnabled, setOnlyEnabled] = useState(true);

  // Reopen on what the request already has, so the dialog is a view of the
  // current state rather than a blank slate that silently unlinks everything.
  useEffect(() => {
    if (!open) return;
    setAccountId(currentAccountId === null ? NONE : String(currentAccountId));
    setSelected(new Set(currentCampaignIds));
    setSearch('');
    setOnlyEnabled(true);
    // currentCampaignIds is a fresh array each render; key on its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentAccountId, currentCampaignIds.join(',')]);

  const { data: accountData } = useApi<{
    accounts: Array<{ id: number; name: string | null; customerId: string }>;
  }>(['account-options'], '/api/accounts/options', { enabled: open, staleTime: 5 * 60_000 });

  const accountFilter = accountId === NONE ? '' : `?accountId=${accountId}`;
  const { data, isLoading } = useApi<{
    campaigns: CampaignOption[];
    total: number;
    truncated: boolean;
  }>(['campaign-options', accountFilter], `/api/campaigns/options${accountFilter}`, {
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const all = useMemo(() => data?.campaigns ?? [], [data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((c) => {
      // A ticked campaign is always shown. Hiding it behind a filter is how
      // someone unticks one by accident and never sees it happen.
      if (selected.has(c.id)) return true;
      if (onlyEnabled && c.status !== 'ENABLED') return false;
      if (!q) return true;
      return (
        (c.name ?? '').toLowerCase().includes(q) ||
        c.campaignId.includes(q) ||
        (c.accountName ?? '').toLowerCase().includes(q)
      );
    });
  }, [all, search, selected, onlyEnabled]);

  if (!open) return null;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const current = new Set(currentCampaignIds);
  const changed =
    selected.size !== current.size ||
    Array.from(selected).some((id) => !current.has(id)) ||
    (accountId === NONE ? null : Number(accountId)) !== currentAccountId;

  const hiddenSelected = selected.size - visible.filter((c) => selected.has(c.id)).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link campaigns</DialogTitle>
          <DialogDescription>
            The campaigns this request&apos;s performance is read from. Pick as many as the
            client is running — linking moves no step and signs nothing off.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <div className="space-y-1.5">
              <Label htmlFor="link-account" className="text-xs">
                Account
              </Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="link-account" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>All accounts</SelectItem>
                  {(accountData?.accounts ?? []).map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name ?? a.customerId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="link-search" className="text-xs">
                Search
              </Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="link-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Campaign name or ID…"
                  className="h-9 pl-8"
                  autoComplete="off"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setOnlyEnabled((v) => !v)}
              aria-pressed={onlyEnabled}
              className={cn(
                'rounded-full px-2.5 py-1 font-medium transition-colors',
                onlyEnabled
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              Enabled only
            </button>
            <span className="text-muted-foreground">
              {selected.size} selected · {visible.length} shown
            </span>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                Clear all
              </button>
            )}
          </div>

          <div className="max-h-[22rem] min-w-0 overflow-y-auto rounded-md border">
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading campaigns…</p>
            ) : visible.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No campaign matches. Try a different account, or switch off &ldquo;Enabled
                only&rdquo;.
              </p>
            ) : (
              <ul className="divide-y">
                {visible.map((c) => {
                  const on = selected.has(c.id);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => toggle(c.id)}
                        aria-pressed={on}
                        className={cn(
                          // min-w-0 all the way down, or the truncate below
                          // has nothing to truncate against.
                          'flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors',
                          on ? 'bg-primary/5' : 'hover:bg-accent/60'
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                            on ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                          )}
                          aria-hidden="true"
                        >
                          {on && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {c.name ?? `Campaign ${c.campaignId}`}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {c.accountName ?? 'Unknown account'} · {c.campaignId}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-[11px] font-medium uppercase tracking-wide',
                            STATUS_TONE[c.status ?? ''] ?? 'text-muted-foreground'
                          )}
                        >
                          {(c.status ?? '—').toLowerCase()}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {hiddenSelected > 0 && (
            <p className="text-xs text-muted-foreground">
              {hiddenSelected} selected campaign{hiddenSelected === 1 ? '' : 's'} not in the
              current filter — still linked.
            </p>
          )}
          {data?.truncated && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Showing the first {all.length} of {data.total}. Narrow by account to see the rest.
            </p>
          )}
          {selected.size === 0 && currentCampaignIds.length > 0 && (
            <Badge
              variant="outline"
              className="border-amber-500/30 bg-amber-500/10 font-normal text-amber-700 dark:text-amber-400"
            >
              Saving with none selected unlinks all {currentCampaignIds.length}
            </Badge>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={busy || !changed}
            onClick={() =>
              onConfirm({
                campaignIds: Array.from(selected),
                accountId: accountId === NONE ? null : Number(accountId),
              })
            }
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
