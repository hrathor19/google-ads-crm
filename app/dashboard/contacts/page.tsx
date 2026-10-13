'use client';

import { useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Search, Trash2, Upload, UserRoundPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { PageHeader } from '@/components/data/page-header';
import { EmptyState } from '@/components/data/states';
import { AddContactDialog } from '@/components/data/recipients-field';
import { usePermissions } from '@/components/providers/permission-provider';
import { apiSend, useApi } from '@/lib/hooks/use-api';
import { MAX_CONTACTS_PER_IMPORT } from '@/lib/contacts/csv';

type Contact = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdByEmail: string | null;
};
type Response = { contacts: Contact[]; allowedDomains: string[] };
type ImportResult = {
  imported: number;
  skipped: Array<{ line: number; value: string; reason: string }>;
};

export default function MailContactsPage() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const { data, isLoading, refetch } = useApi<Response>(['mail-contacts'], '/api/contacts');

  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const contacts = useMemo(() => data?.contacts ?? [], [data]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    );
  }, [contacts, search]);

  if (!can('CONTACTS', 'VIEW')) {
    return (
      <EmptyState
        title="You cannot see the mail contacts"
        description="Your role does not include the Mail Contacts: View permission. Ask a Super Admin if you need it."
      />
    );
  }

  const canEdit = can('CONTACTS', 'EDIT');
  const canCreate = can('CONTACTS', 'CREATE');
  const canDelete = can('CONTACTS', 'DELETE');

  const toggle = async (c: Contact) => {
    setBusy(c.id);
    try {
      await apiSend(`/api/contacts/${c.id}`, 'PATCH', { isActive: !c.isActive });
      await refetch();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not change that contact',
        description: err instanceof Error ? err.message : 'Something went wrong.',
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (c: Contact) => {
    setBusy(c.id);
    try {
      const res = await apiSend<{ stillOnRequests: number }>(
        `/api/contacts/${c.id}`,
        'DELETE'
      );
      await refetch();
      toast({
        title: `${c.name} removed`,
        // Said plainly, because removing somebody here does not take them off
        // a campaign that is already running.
        description:
          res.stillOnRequests > 0
            ? `They stay on ${res.stillOnRequests} request(s) already using them.`
            : 'They were not on any request.',
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not remove that contact',
        description: err instanceof Error ? err.message : 'Something went wrong.',
      });
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    setImporting(true);
    setReport(null);
    try {
      const csv = await file.text();
      const res = await apiSend<ImportResult>('/api/contacts/import', 'POST', { csv });
      await refetch();
      setReport(res);
      toast({
        title: `${res.imported} contact(s) imported`,
        description:
          res.skipped.length > 0
            ? `${res.skipped.length} row(s) skipped — see the report below.`
            : 'Every row was usable.',
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not import that file',
        description: err instanceof Error ? err.message : 'Something went wrong.',
      });
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <>
      <PageHeader
        title="Mail contacts"
        description="The people Operations can copy on a campaign's mail. Chosen on the requirement form, one campaign at a time."
        actions={
          canCreate ? (
            <div className="flex gap-2">
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={importing}
              >
                {importing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Import CSV
              </Button>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add contact
              </Button>
            </div>
          ) : null
        }
      />

      {canCreate && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Importing a list</CardTitle>
            <CardDescription>
              A CSV with <strong>Name</strong> and <strong>Email</strong> columns. The header
              row is optional and the column order does not matter — a file of addresses
              alone works too, and names are read from the address. Up to{' '}
              {MAX_CONTACTS_PER_IMPORT} rows at a time. Nothing is overwritten: anyone
              already listed is reported as skipped rather than renamed.
            </CardDescription>
          </CardHeader>
          {report && (
            <CardContent>
              <p className="text-sm">
                <strong>{report.imported}</strong> imported
                {report.skipped.length > 0 && <>, {report.skipped.length} skipped</>}
              </p>
              {report.skipped.length > 0 && (
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                  {report.skipped.map((s, i) => (
                    <li key={`${s.value}-${i}`}>
                      {s.line > 0 && <span className="font-mono">line {s.line}: </span>}
                      <span className="font-medium">{s.value}</span> — {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          )}
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {contacts.length} contact{contacts.length === 1 ? '' : 's'}
            </CardTitle>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <EmptyState
              icon={UserRoundPlus}
              title="No contacts yet"
              description={
                canCreate
                  ? 'Import a CSV of names and addresses, or add the first person by hand.'
                  : 'Nobody has been added to the directory yet.'
              }
            />
          ) : visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nobody matches &ldquo;{search}&rdquo;.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Added by</TableHead>
                  {canEdit && <TableHead className="w-28">Available</TableHead>}
                  {canDelete && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((c) => (
                  <TableRow key={c.id} className={c.isActive ? undefined : 'opacity-60'}>
                    <TableCell className="font-medium">
                      {c.name}
                      {!c.isActive && (
                        <Badge variant="outline" className="ml-2 text-xs font-normal">
                          off
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.email}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.createdByEmail ?? '—'}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Switch
                          checked={c.isActive}
                          disabled={busy === c.id}
                          onCheckedChange={() => void toggle(c)}
                          aria-label={`${c.isActive ? 'Hide' : 'Show'} ${c.name} in the picker`}
                        />
                      </TableCell>
                    )}
                    {canDelete && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          disabled={busy === c.id}
                          onClick={() => void remove(c)}
                          aria-label={`Remove ${c.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddContactDialog
        open={adding}
        onOpenChange={setAdding}
        allowedDomains={data?.allowedDomains ?? []}
        onAdded={async () => {
          await refetch();
        }}
      />
    </>
  );
}
