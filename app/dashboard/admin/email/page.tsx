'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Mail, Save, Send } from 'lucide-react';
import { PageHeader } from '@/components/data/page-header';
import { ErrorState } from '@/components/data/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { apiSend, useApi } from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';

type Route = {
  event: string;
  enabled: boolean;
  audience: 'ROLE' | 'REQUESTER' | 'ASSIGNEE' | 'AD_SPECIALIST' | 'FIXED';
  audiencePermission: string | null;
  toEmails: string | null;
  cc: string | null;
  bcc: string | null;
  subject: string;
  intro: string | null;
};

type Settings = {
  enabled: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  subjectPrefix: string | null;
  globalCc: string | null;
  globalBcc: string | null;
  testModeRecipient: string | null;
};

type Payload = {
  settings: Settings;
  routes: Route[];
  events: Array<{ event: string; label: string; description: string; step?: string }>;
  connection: { ok: boolean; detail: string };
};

const AUDIENCE_LABELS: Record<Route['audience'], string> = {
  ROLE: 'Everyone with a permission',
  REQUESTER: 'The person who raised it',
  AD_SPECIALIST: 'The Ad Specialist on this request',
  ASSIGNEE: 'The person it is assigned to',
  FIXED: 'Only the addresses below',
};

const TOKENS = [
  ['{{reference}}', 'AR-0042'],
  ['{{title}}', 'campaign name'],
  ['{{status}}', 'new status'],
  ['{{actor}}', 'who did it'],
  ['{{reason}}', 'rejection or recheck remark'],
] as const;

export default function EmailSettingsPage() {
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = useApi<Payload>(['email-settings'], '/api/admin/email');

  const [settings, setSettings] = useState<Settings | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (data) {
      setSettings(data.settings);
      setRoutes(data.routes);
    }
  }, [data]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => (s ? { ...s, [key]: value } : s));

  const setRoute = (event: string, patch: Partial<Route>) =>
    setRoutes((rs) => rs.map((r) => (r.event === event ? { ...r, ...patch } : r)));

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      await apiSend('/api/admin/email', 'PUT', { ...settings, routes });
      toast({ title: 'Email configuration saved' });
      refetch();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not save',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const r = await apiSend<{ detail: string; subject: string; wouldSendTo: string[] }>(
        '/api/admin/email/test',
        'POST',
        { to: testTo, event: 'REQUEST_SUBMITTED' }
      );
      toast({
        title: 'Test email sent',
        description: `${r.detail} Subject: ${r.subject}`,
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not send',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setTesting(false);
    }
  }

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <PageHeader
        title="Email"
        description="Who receives which notification, what the subject says, and which account sends it."
      />

      {isLoading || !settings || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-56 w-full rounded-lg" />
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Provider status, straight from Brevo. */}
          <Card>
            <CardContent className="flex flex-wrap items-start gap-3 p-4">
              {data.connection.ok ? (
                <CheckCircle2
                  className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
              ) : (
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  Brevo {data.connection.ok ? 'connected' : 'not reachable'}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{data.connection.detail}</p>
              </div>
            </CardContent>
          </Card>

          {/* ── Sender ──────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Sending</CardTitle>
                  <CardDescription>
                    The master switch. Off means nothing is sent, whatever the rules below say.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="enabled" className="text-sm">
                    {settings.enabled ? 'Enabled' : 'Disabled'}
                  </Label>
                  <Switch
                    id="enabled"
                    // The visible caption reads "Enabled"/"Disabled", which is
                    // the state, not the name of the control.
                    aria-label="Send transactional email"
                    checked={settings.enabled}
                    onCheckedChange={(v) => set('enabled', v)}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field id="fromName" label="From name">
                <Input
                  id="fromName"
                  value={settings.fromName}
                  onChange={(e) => set('fromName', e.target.value)}
                />
              </Field>
              <Field
                id="fromEmail"
                label="From address"
                hint="Has to be a verified sender on the Brevo account."
              >
                <Input
                  id="fromEmail"
                  value={settings.fromEmail}
                  onChange={(e) => set('fromEmail', e.target.value)}
                />
              </Field>
              <Field id="replyTo" label="Reply-to" hint="Optional. Where replies should land.">
                <Input
                  id="replyTo"
                  value={settings.replyTo ?? ''}
                  onChange={(e) => set('replyTo', e.target.value)}
                />
              </Field>
              <Field
                id="subjectPrefix"
                label="Subject prefix"
                hint="Prefixed to every subject. Keeps a request's mails together in a client."
              >
                <Input
                  id="subjectPrefix"
                  value={settings.subjectPrefix ?? ''}
                  onChange={(e) => set('subjectPrefix', e.target.value)}
                  placeholder="[{{reference}}]"
                />
              </Field>
              <Field
                id="globalCc"
                label="CC on every mail"
                hint="Comma separated. Added on top of each rule's own CC."
              >
                <Input
                  id="globalCc"
                  value={settings.globalCc ?? ''}
                  onChange={(e) => set('globalCc', e.target.value)}
                />
              </Field>
              <Field id="globalBcc" label="BCC on every mail" hint="Comma separated.">
                <Input
                  id="globalBcc"
                  value={settings.globalBcc ?? ''}
                  onChange={(e) => set('globalBcc', e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          {/* ── Test mode ───────────────────────────────────────────── */}
          <Card className={cn(settings.testModeRecipient && 'border-amber-500/50')}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Test mode</CardTitle>
              <CardDescription>
                While an address is set here, every notification goes there instead of to the real
                recipients — CC and BCC included. Clear it to go live.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field id="testModeRecipient" label="Redirect all mail to">
                <Input
                  id="testModeRecipient"
                  value={settings.testModeRecipient ?? ''}
                  onChange={(e) => set('testModeRecipient', e.target.value)}
                  placeholder="you@kollegeapply.com"
                />
              </Field>
              {settings.testModeRecipient ? (
                <div className="flex items-end">
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  >
                    Test mode is on — nobody else will be mailed
                  </Badge>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* ── Per-event rules ─────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Notifications</CardTitle>
              <CardDescription>
                One rule per workflow event. Tokens you can use in a subject:{' '}
                {TOKENS.map(([t], i) => (
                  <span key={t}>
                    <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{t}</code>
                    {i < TOKENS.length - 1 ? ' ' : ''}
                  </span>
                ))}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {routes.map((r) => {
                const meta = data.events.find((e) => e.event === r.event);
                return (
                  <div
                    key={r.event}
                    className={cn(
                      'rounded-lg border p-4 transition-colors',
                      r.enabled ? 'border-border' : 'border-border/60 bg-muted/30'
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{meta?.label ?? r.event}</p>
                          {meta?.step && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              {meta.step}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{meta?.description}</p>
                      </div>
                      <Switch
                        checked={r.enabled}
                        aria-label={`Send mail for ${meta?.label ?? r.event}`}
                        onCheckedChange={(v) => setRoute(r.event, { enabled: v })}
                      />
                    </div>

                    {r.enabled && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <Field id={`${r.event}-audience`} label="Send to">
                          <Select
                            value={r.audience}
                            onValueChange={(v) =>
                              setRoute(r.event, { audience: v as Route['audience'] })
                            }
                          >
                            <SelectTrigger id={`${r.event}-audience`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(AUDIENCE_LABELS).map(([v, label]) => (
                                <SelectItem key={v} value={v}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>

                        {r.audience === 'ROLE' && (
                          <Field
                            id={`${r.event}-perm`}
                            label="Permission"
                            hint="Everyone holding this gets the mail."
                          >
                            <Input
                              id={`${r.event}-perm`}
                              value={r.audiencePermission ?? ''}
                              onChange={(e) =>
                                setRoute(r.event, { audiencePermission: e.target.value })
                              }
                              placeholder="AD_REQUESTS:APPROVE"
                            />
                          </Field>
                        )}

                        <Field
                          id={`${r.event}-to`}
                          label="Also to"
                          hint="Fixed addresses, comma separated."
                          className={r.audience === 'ROLE' ? 'sm:col-span-2' : ''}
                        >
                          <Input
                            id={`${r.event}-to`}
                            value={r.toEmails ?? ''}
                            onChange={(e) => setRoute(r.event, { toEmails: e.target.value })}
                          />
                        </Field>

                        <Field id={`${r.event}-cc`} label="CC">
                          <Input
                            id={`${r.event}-cc`}
                            value={r.cc ?? ''}
                            onChange={(e) => setRoute(r.event, { cc: e.target.value })}
                          />
                        </Field>
                        <Field id={`${r.event}-bcc`} label="BCC">
                          <Input
                            id={`${r.event}-bcc`}
                            value={r.bcc ?? ''}
                            onChange={(e) => setRoute(r.event, { bcc: e.target.value })}
                          />
                        </Field>

                        <Field
                          id={`${r.event}-subject`}
                          label="Subject"
                          className="sm:col-span-2"
                          hint={
                            settings.subjectPrefix
                              ? `Sent as: ${settings.subjectPrefix} ${r.subject}`
                              : undefined
                          }
                        >
                          <Input
                            id={`${r.event}-subject`}
                            value={r.subject}
                            onChange={(e) => setRoute(r.event, { subject: e.target.value })}
                          />
                        </Field>

                        <Field
                          id={`${r.event}-intro`}
                          label="Opening line"
                          className="sm:col-span-2"
                          hint="Optional. Replaces the default sentence at the top of the mail."
                        >
                          <Textarea
                            id={`${r.event}-intro`}
                            rows={2}
                            value={r.intro ?? ''}
                            onChange={(e) => setRoute(r.event, { intro: e.target.value })}
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* ── Send a test ─────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Send a test</CardTitle>
              <CardDescription>
                Sends one real mail to the address you give, using the configured sender and
                subject. Nobody else is mailed.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <Field id="testTo" label="Send to" className="min-w-[16rem] flex-1">
                <Input
                  id="testTo"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="you@kollegeapply.com"
                />
              </Field>
              <Button variant="outline" disabled={!testTo || testing} onClick={sendTest}>
                {testing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
                )}
                Send test
              </Button>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              Save configuration
            </Button>
            {!settings.enabled && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                Sending is off — nothing will go out until you enable it.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
