'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, UserRoundPlus } from 'lucide-react';
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
import { useToast } from '@/components/ui/use-toast';
import { usePermissions } from '@/components/providers/permission-provider';
import { MultiSelect } from '@/components/data/multi-select';
import { apiSend, useApi } from '@/lib/hooks/use-api';
import { MAX_REQUEST_RECIPIENTS, type RequestRecipient } from '@/lib/workflow/recipients';

type Contact = { id: string; name: string; email: string; isActive: boolean };
type ContactsResponse = { contacts: Contact[]; allowedDomains: string[] };

/**
 * Choose who is copied on this request's mail, from the contact directory.
 *
 * This was a free-text box first, and the problem with it was not typing
 * effort — it was that the same sales POC went onto ten campaigns under four
 * spellings, and one typo meant a mail nobody ever received and nobody ever
 * missed. Picking from a list makes both impossible.
 *
 * Somebody already on a trail who is no longer in the directory still shows
 * and stays selected. The alternative is a screen that silently drops a
 * recipient because an admin tidied the address book, which is precisely the
 * failure this feature exists to prevent.
 */
export function RecipientsField({
  value,
  onChange,
  disabled,
  id = 'recipients',
}: {
  value: RequestRecipient[];
  onChange: (next: RequestRecipient[]) => void;
  disabled?: boolean;
  /** Accepted and ignored: the directory is the gate now, not typed input. */
  allowedDomains?: string[];
  id?: string;
}) {
  const { can } = usePermissions();
  const { data, isLoading, refetch } = useApi<ContactsResponse>(
    ['mail-contacts'],
    '/api/contacts',
    { staleTime: 2 * 60_000 }
  );
  const [adding, setAdding] = useState(false);

  const directory = useMemo(() => data?.contacts ?? [], [data]);

  const options = useMemo(() => {
    const known = new Map(directory.map((c) => [c.email, c]));
    const out = directory
      // Somebody switched off should not be offered, but must stay visible if
      // they are already on this trail.
      .filter((c) => c.isActive || value.some((v) => v.email === c.email))
      .map((c) => ({
        value: c.email,
        label: `${c.name} — ${c.email}`,
        group: c.isActive ? 'Contacts' : 'No longer active',
      }));

    for (const v of value) {
      if (!known.has(v.email)) {
        out.push({
          value: v.email,
          label: v.name ? `${v.name} — ${v.email}` : v.email,
          group: 'Not in the directory',
        });
      }
    }
    return out;
  }, [directory, value]);

  const selected = value.map((v) => v.email);

  const handleChange = (emails: string[]) => {
    const byEmail = new Map(directory.map((c) => [c.email, c.name]));
    const existing = new Map(value.map((v) => [v.email, v.name ?? null]));
    onChange(
      emails.map((email) => ({
        email,
        // The directory's spelling wins, so renaming somebody there fixes
        // every request that picks them up from now on.
        name: byEmail.get(email) ?? existing.get(email) ?? null,
      }))
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading contacts…
      </div>
    );
  }

  const canAdd = can('CONTACTS', 'CREATE');

  return (
    <div className="space-y-2">
      <MultiSelect
        id={id}
        options={options}
        selected={selected}
        onChange={handleChange}
        disabled={disabled}
        maxSelected={MAX_REQUEST_RECIPIENTS}
        placeholder="Choose who to copy…"
        searchPlaceholder="Search by name or email…"
        emptyMessage={
          directory.length === 0
            ? 'No contacts yet — add one to get started.'
            : 'Nobody matches that search.'
        }
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-xs text-muted-foreground">
          Copied on every mail about this request only
        </p>
        {canAdd && !disabled && (
          <>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => setAdding(true)}
            >
              <UserRoundPlus className="mr-1 h-3 w-3" />
              Add someone new
            </Button>
            <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
              <Link href="/dashboard/contacts">Manage contacts</Link>
            </Button>
          </>
        )}
      </div>

      <AddContactDialog
        open={adding}
        onOpenChange={setAdding}
        allowedDomains={data?.allowedDomains ?? []}
        onAdded={async (contact) => {
          await refetch();
          // Added from here means they are wanted here, so tick them.
          if (!selected.includes(contact.email)) {
            onChange([...value, { email: contact.email, name: contact.name }]);
          }
        }}
      />
    </div>
  );
}

/**
 * Add one person without leaving the request.
 *
 * The directory is maintained on its own screen, but a POC is usually named
 * while the request is being filled in — and sending somebody away mid-form to
 * add one contact is how a half-finished brief gets lost.
 */
export function AddContactDialog({
  open,
  onOpenChange,
  onAdded,
  allowedDomains,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (contact: Contact) => void | Promise<void>;
  allowedDomains: string[];
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => {
    setName('');
    setEmail('');
    onOpenChange(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { contact } = await apiSend<{ contact: Contact }>('/api/contacts', 'POST', {
        name: name.trim(),
        email: email.trim(),
      });
      await onAdded(contact);
      toast({ title: `${contact.name} added to the contacts` });
      close();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not add that contact',
        description: err instanceof Error ? err.message : 'Something went wrong.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a contact</DialogTitle>
          <DialogDescription>
            They join the list everyone picks from, not just this request.
            {allowedDomains.length > 0 && ` ${allowedDomains.join(', ')} addresses only.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="contact-name">Name</Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Girish Singh"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="girish@kollegeapply.com"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim() && email.trim() && !saving) save();
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !name.trim() || !email.trim()}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
