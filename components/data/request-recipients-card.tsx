'use client';

import { useEffect, useState } from 'react';
import { Loader2, Mail, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { usePermissions } from '@/components/providers/permission-provider';
import { apiSend, useApi } from '@/lib/hooks/use-api';
import { RecipientsField } from '@/components/data/recipients-field';
import { normaliseRecipients, type RequestRecipient } from '@/lib/workflow/recipients';

type Response = {
  recipients: Array<{
    id: string;
    email: string;
    name: string | null;
    addedByEmail: string | null;
    addedAt: string;
  }>;
  max: number;
  allowedDomains: string[];
};

/**
 * Who is copied on this request's mail, editable at any status.
 *
 * Deliberately outside the brief: the requirement form closes to edits once a
 * request is submitted, and a sales POC is usually only named later — at
 * approval, or when the campaign goes live. Before this, adding one person to
 * a mail thread meant rejecting the request and having it raised again.
 */
export function RequestRecipientsCard({ requestId }: { requestId: string }) {
  const { can } = usePermissions();
  const { toast } = useToast();
  const { data, isLoading, refetch } = useApi<Response>(
    ['request-recipients', requestId],
    `/api/ad-requests/${requestId}/recipients`
  );

  const [draft, setDraft] = useState<RequestRecipient[] | null>(null);
  const [saving, setSaving] = useState(false);

  // The server's list is the truth until somebody edits; once they have, their
  // edit survives a background refetch rather than being silently reverted.
  useEffect(() => {
    if (data && draft === null) {
      setDraft(data.recipients.map((r) => ({ email: r.email, name: r.name })));
    }
  }, [data, draft]);

  const editable = can('AD_REQUESTS', 'EDIT');
  const saved = data?.recipients.map((r) => r.email).join(',') ?? '';
  const current = (draft ?? []).map((r) => r.email).join(',');
  const dirty = draft !== null && saved !== current;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await apiSend(`/api/ad-requests/${requestId}/recipients`, 'PUT', {
        recipients: normaliseRecipients(draft),
      });
      await refetch();
      toast({
        title: 'Mail trail updated',
        description:
          draft.length === 0
            ? 'Nobody extra is copied on this request now.'
            : `${draft.length} ${draft.length === 1 ? 'person is' : 'people are'} copied on every mail about this request.`,
      });
    } catch (err) {
      // Reset to the server's list, so the screen never shows a state the
      // server rejected — most often an address outside the company domain.
      setDraft(null);
      toast({
        variant: 'destructive',
        title: 'Could not update the mail trail',
        description: err instanceof Error ? err.message : 'Something went wrong.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !data) return null;

  // Nothing to show and no way to change it: an empty card would only be noise.
  if (!editable && data.recipients.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4 text-muted-foreground" />
          Mail trail
        </CardTitle>
        <CardDescription>
          Copied on every mail about this request, and no other. Anyone added now joins
          the thread from the next mail onwards.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {editable ? (
          <>
            <RecipientsField
              value={draft ?? []}
              onChange={setDraft}
              allowedDomains={data.allowedDomains}
              disabled={saving}
            />
            {dirty && (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save the mail trail
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft(null)}
                  disabled={saving}
                >
                  Discard
                </Button>
              </div>
            )}
          </>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.recipients.map((r) => (
              <li key={r.id} className="text-muted-foreground">
                {r.name ? `${r.name} (${r.email})` : r.email}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
