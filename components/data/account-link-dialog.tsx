'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

/**
 * Change the Google Ads account a request reports against.
 *
 * Separate from the transition dialog because this is not a step: it moves no
 * status and signs nothing off. It exists because a request past the handover
 * had nowhere else to acquire an account — the brief editor closes at review —
 * and without one the Assigned campaigns page has nothing to measure.
 */

/** The sentinel for "no account", since a Select cannot hold an empty value. */
const NONE = '__none__';

export function AccountLinkDialog({
  open,
  busy,
  currentAccountId,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  currentAccountId: number | null;
  onCancel: () => void;
  onConfirm: (accountId: number | null) => void;
}) {
  const [value, setValue] = useState(NONE);

  useEffect(() => {
    setValue(currentAccountId === null ? NONE : String(currentAccountId));
  }, [currentAccountId, open]);

  const { data, isLoading } = useApi<{
    accounts: Array<{ id: number; name: string | null; customerId: string }>;
  }>(['account-options'], '/api/accounts/options', { enabled: open, staleTime: 5 * 60_000 });

  if (!open) return null;

  const chosen = value === NONE ? null : Number(value);
  const changed = chosen !== currentAccountId;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Google Ads account</DialogTitle>
          <DialogDescription>
            Which account this request&apos;s performance is read from. Changing it moves no
            step and signs nothing off.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="link-account">Account</Label>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger id="link-account">
              <SelectValue placeholder={isLoading ? 'Loading…' : 'Choose the account'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No account</SelectItem>
              {(data?.accounts ?? []).map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name ?? a.customerId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Until one is set, the request appears on Assigned campaigns with nothing under it.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={busy || !changed} onClick={() => onConfirm(chosen)}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
