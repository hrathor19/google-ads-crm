'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  FileSearch,
  Link2,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { PageHeader } from '@/components/data/page-header';
import { ErrorState } from '@/components/data/states';
import { OBJECTIVE_LABELS, RequestStatusBadge, REQUEST_STATUS_LABELS } from '@/components/data/status-badge';
import {
  AssetList,
  D_MAX,
  H_MAX,
  ToneSelector,
  ValidationSummary,
  type Asset,
  type Validation,
} from '@/components/data/ad-copy-panel';
import { LandingScorePanel, type LandingScoreData } from '@/components/data/landing-score-panel';
import { apiSend, useApi } from '@/lib/hooks/use-api';
import { usePermissions } from '@/components/providers/permission-provider';
import { formatCurrency, formatDate, formatDateTime, formatRelative } from '@/lib/format';

type RequestDetail = {
  id: string;
  reference: string;
  title: string;
  status: string;
  objective: string;
  productService: string;
  targetAudience: string;
  location: string;
  budget: number | null;
  startDate: string;
  endDate: string | null;
  landingPageUrl: string;
  usps: string | null;
  keywords: string | null;
  notes: string | null;
  linkedCampaignId: string | null;
  decisionReason: string | null;
  createdAt: string;
  accountName: string | null;
  createdBy: { id: string; name: string; email: string };
  assignedTo: { id: string; name: string; email: string } | null;
  events: Array<{
    id: string;
    type: string;
    message: string;
    fromStatus: string | null;
    toStatus: string | null;
    createdAt: string;
    actor: { name: string; email: string } | null;
  }>;
  adCopyVersions: Array<{
    id: string;
    version: number;
    tone: string;
    headlines: Asset[];
    descriptions: Asset[];
    validation: Validation | null;
    backend: string;
    isFinal: boolean;
    createdAt: string;
    createdBy: { name: string };
  }>;
  landingScores: Array<LandingScoreData & { id: string }>;
};

type Response = {
  request: RequestDetail;
  transitions: string[];
  canSeeMoney: boolean;
};

/** A transition that needs a typed reason before it can be sent. */
const NEEDS_REASON = new Set(['REJECTED', 'CHANGES_REQUESTED']);

export default function AdRequestDetailPage({ params }: { params: { id: string } }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can, user } = usePermissions();

  const { data, isLoading, error, refetch } = useApi<Response>(
    ['ad-request', params.id],
    `/api/ad-requests/${params.id}`
  );

  const [pendingTransition, setPendingTransition] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [tone, setTone] = useState('professional');
  const [generating, setGenerating] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [draftCopy, setDraftCopy] = useState<{
    headlines: Asset[];
    descriptions: Asset[];
    validation: Validation;
    backend: string;
    backendReason: string | null;
  } | null>(null);
  const [linkedCampaignId, setLinkedCampaignId] = useState('');

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const r = data.request;
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['ad-request', params.id] });
    queryClient.invalidateQueries({ queryKey: ['ad-requests'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  async function runTransition(target: string, withReason?: string) {
    setBusy(true);
    try {
      await apiSend(`/api/ad-requests/${params.id}/transition`, 'POST', {
        target,
        reason: withReason ?? null,
        linkedCampaignId: target === 'LIVE' && linkedCampaignId ? linkedCampaignId : undefined,
      });
      toast({ title: `Request ${REQUEST_STATUS_LABELS[target]?.toLowerCase() ?? target}` });
      setPendingTransition(null);
      setReason('');
      invalidate();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not change the status',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function postComment() {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await apiSend(`/api/ad-requests/${params.id}/comments`, 'POST', { message: comment });
      setComment('');
      invalidate();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not post the comment',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function generateCopy(save: boolean) {
    setGenerating(true);
    try {
      const result = await apiSend<{
        headlines: Asset[];
        descriptions: Asset[];
        validation: Validation;
        backend: string;
        backendReason: string | null;
      }>('/api/ai/ad-copy', 'POST', { requestId: params.id, tone, save });
      setDraftCopy(result);
      if (save) {
        toast({ title: 'Version saved', description: 'It is now in the version history below.' });
        invalidate();
      }
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Generation failed',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setGenerating(false);
    }
  }

  async function scoreLandingPage() {
    setScoring(true);
    try {
      await apiSend('/api/ai/landing-score', 'POST', {
        url: r.landingPageUrl,
        requestId: params.id,
      });
      toast({ title: 'Landing page scored' });
      invalidate();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not score the page',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setScoring(false);
    }
  }

  async function markFinal(versionId: string) {
    setBusy(true);
    try {
      await apiSend(`/api/ad-copy-versions/${versionId}`, 'PATCH', { isFinal: true });
      toast({ title: 'Marked as the final copy' });
      invalidate();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not mark it final',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setBusy(false);
    }
  }

  const isOwner = r.createdBy.id === user.id;
  const canEdit =
    isOwner && ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(r.status) && can('AD_REQUESTS', 'EDIT');

  return (
    <>
      <PageHeader
        title={r.title}
        description={`${r.reference} · raised by ${r.createdBy.name} on ${formatDate(r.createdAt)}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/ad-requests">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Back
              </Link>
            </Button>
            {canEdit && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/ad-requests/${r.id}/edit`}>Edit brief</Link>
              </Button>
            )}
          </>
        }
      />

      {/* Status + actions */}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <RequestStatusBadge status={r.status} />
          {r.assignedTo && (
            <Badge variant="outline" className="font-normal">
              Owner: {r.assignedTo.name}
            </Badge>
          )}
          {r.linkedCampaignId && (
            <Badge variant="outline" className="gap-1 font-normal">
              <Link2 className="h-3 w-3" aria-hidden="true" />
              Campaign {r.linkedCampaignId}
            </Badge>
          )}

          <div className="ml-auto flex flex-wrap gap-2">
            {data.transitions.map((t) => (
              <Button
                key={t}
                size="sm"
                variant={
                  t === 'APPROVED' ? 'default' : t === 'REJECTED' ? 'destructive' : 'outline'
                }
                disabled={busy}
                onClick={() =>
                  NEEDS_REASON.has(t) || t === 'LIVE'
                    ? setPendingTransition(t)
                    : runTransition(t)
                }
              >
                {t === 'APPROVED' && <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {t === 'REJECTED' && <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {t === 'SUBMITTED' && <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {REQUEST_STATUS_LABELS[t] ?? t}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {r.decisionReason && ['REJECTED', 'CHANGES_REQUESTED'].includes(r.status) && (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {r.status === 'REJECTED' ? 'Reason for rejection' : 'Changes requested'}
            </p>
            <p className="mt-1 text-sm">{r.decisionReason}</p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="brief">
        <TabsList>
          <TabsTrigger value="brief">Brief</TabsTrigger>
          {can('AD_COPY', 'VIEW') && (
            <TabsTrigger value="copy">
              Ad copy
              {r.adCopyVersions.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {r.adCopyVersions.length}
                </span>
              )}
            </TabsTrigger>
          )}
          {can('LANDING_SCORE', 'VIEW') && (
            <TabsTrigger value="landing">
              Landing page
              {r.landingScores.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {r.landingScores[0]!.score}
                </span>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        {/* ─── Brief ─────────────────────────────────────────────────── */}
        <TabsContent value="brief">
          <Card>
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
              <Detail label="Account" value={r.accountName ?? 'Not tied to an account'} />
              <Detail label="Objective" value={OBJECTIVE_LABELS[r.objective] ?? r.objective} />
              <Detail label="Product / service" value={r.productService} />
              <Detail label="Location" value={r.location} />
              <Detail
                label="Budget"
                value={data.canSeeMoney ? formatCurrency(r.budget) : 'Hidden by your role'}
              />
              <Detail
                label="Flight"
                value={`${formatDate(r.startDate)} → ${r.endDate ? formatDate(r.endDate) : 'ongoing'}`}
              />
              <Detail className="sm:col-span-2" label="Target audience" value={r.targetAudience} />
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Landing page
                </p>
                <a
                  href={r.landingPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 break-all text-sm text-primary hover:underline"
                >
                  {r.landingPageUrl}
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                </a>
              </div>
              {r.usps && <Detail className="sm:col-span-2" label="USPs and offers" value={r.usps} />}
              {r.keywords && (
                <div className="sm:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Keywords
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.keywords
                      .split(/[\n,]/)
                      .map((k) => k.trim())
                      .filter(Boolean)
                      .map((k) => (
                        <Badge key={k} variant="secondary" className="font-normal">
                          {k}
                        </Badge>
                      ))}
                  </div>
                </div>
              )}
              {r.notes && <Detail className="sm:col-span-2" label="Notes" value={r.notes} />}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Ad copy ───────────────────────────────────────────────── */}
        {can('AD_COPY', 'VIEW') && (
          <TabsContent value="copy" className="space-y-4">
            {can('AD_COPY', 'GENERATE_AI') ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 opacity-70" aria-hidden="true" />
                    Generate responsive search ad copy
                  </CardTitle>
                  <CardDescription>
                    Grounded in this brief and the live landing page. Headlines are capped at{' '}
                    {H_MAX} characters, descriptions at {D_MAX}.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ToneSelector
                    tone={tone}
                    onChange={setTone}
                    onGenerate={() => generateCopy(false)}
                    generating={generating}
                  />
                  {draftCopy && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={generating}
                      onClick={() => generateCopy(true)}
                    >
                      Save this as a new version
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-6 text-center text-sm text-muted-foreground">
                  You can read saved versions, but generating copy needs the AI Ad Copy: Generate
                  AI permission.
                </CardContent>
              </Card>
            )}

            {draftCopy && (
              <div className="space-y-3">
                <ValidationSummary
                  validation={draftCopy.validation}
                  backend={draftCopy.backend}
                  backendReason={draftCopy.backendReason}
                />
                <div className="grid gap-4 lg:grid-cols-2">
                  <AssetList
                    title="Headlines"
                    assets={draftCopy.headlines}
                    limit={H_MAX}
                    editable={can('AD_COPY', 'EDIT')}
                    onChange={(headlines) => setDraftCopy({ ...draftCopy, headlines })}
                  />
                  <AssetList
                    title="Descriptions"
                    assets={draftCopy.descriptions}
                    limit={D_MAX}
                    editable={can('AD_COPY', 'EDIT')}
                    onChange={(descriptions) => setDraftCopy({ ...draftCopy, descriptions })}
                  />
                </div>
              </div>
            )}

            {r.adCopyVersions.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Saved versions</h3>
                {r.adCopyVersions.map((v) => (
                  <Card key={v.id} className={v.isFinal ? 'border-emerald-500/40' : undefined}>
                    <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-sm">Version {v.version}</CardTitle>
                        <Badge variant="secondary" className="font-normal">
                          {v.tone}
                        </Badge>
                        <Badge variant="outline" className="font-normal">
                          {v.backend === 'gemini' ? 'Gemini' : 'Deterministic'}
                        </Badge>
                        {v.isFinal && (
                          <Badge className="bg-emerald-600 hover:bg-emerald-600">Final</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {v.createdBy.name} · {formatRelative(v.createdAt)}
                        </span>
                      </div>
                      {!v.isFinal && can('AD_COPY', 'EDIT') && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => markFinal(v.id)}
                        >
                          Mark final
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="grid gap-4 lg:grid-cols-2">
                      <AssetList title="Headlines" assets={v.headlines} limit={H_MAX} />
                      <AssetList title="Descriptions" assets={v.descriptions} limit={D_MAX} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        )}

        {/* ─── Landing page ──────────────────────────────────────────── */}
        {can('LANDING_SCORE', 'VIEW') && (
          <TabsContent value="landing" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileSearch className="h-4 w-4 opacity-70" aria-hidden="true" />
                  Landing page score
                </CardTitle>
                <CardDescription className="break-all">{r.landingPageUrl}</CardDescription>
              </CardHeader>
              {can('LANDING_SCORE', 'GENERATE_AI') && (
                <CardContent>
                  <Button onClick={scoreLandingPage} disabled={scoring}>
                    {scoring ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <FileSearch className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    {scoring ? 'Fetching and scoring…' : 'Run the score'}
                  </Button>
                </CardContent>
              )}
            </Card>

            {r.landingScores.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No score yet. Run one to see the breakdown and the fixes.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <LandingScorePanel data={r.landingScores[0]!} />
                {r.landingScores.length > 1 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Score history</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="divide-y text-sm">
                        {r.landingScores.map((s) => (
                          <li key={s.id} className="flex items-center justify-between py-2">
                            <span className="text-muted-foreground">
                              {formatDateTime(s.createdAt)}
                            </span>
                            <span className="font-medium tabular-nums">
                              {s.score}/100 · grade {s.grade}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>
        )}

        {/* ─── Timeline ──────────────────────────────────────────────── */}
        <TabsContent value="timeline" className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <ol className="space-y-4">
                {r.events.map((e, i) => (
                  <li key={e.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                      {i < r.events.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
                    </div>
                    <div className="min-w-0 flex-1 pb-1">
                      <p className="text-sm">{e.message}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDateTime(e.createdAt)}
                        {e.fromStatus && e.toStatus && (
                          <>
                            {' · '}
                            {REQUEST_STATUS_LABELS[e.fromStatus]} →{' '}
                            {REQUEST_STATUS_LABELS[e.toStatus]}
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 p-4">
              <Label htmlFor="comment" className="flex items-center gap-1.5 text-sm">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                Add a comment
              </Label>
              <Textarea
                id="comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Everyone on this request will be notified."
              />
              <div className="flex justify-end">
                <Button size="sm" disabled={busy || !comment.trim()} onClick={postComment}>
                  Post comment
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Reason / campaign-link dialog */}
      <Dialog open={pendingTransition !== null} onOpenChange={(o) => !o && setPendingTransition(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingTransition === 'REJECTED'
                ? 'Reject this request'
                : pendingTransition === 'CHANGES_REQUESTED'
                  ? 'Request changes'
                  : 'Mark as live'}
            </DialogTitle>
            <DialogDescription>
              {pendingTransition === 'LIVE'
                ? 'Link the Google Ads campaign you created, so the request and the campaign stay connected.'
                : 'The person who raised this will see exactly what you write here.'}
            </DialogDescription>
          </DialogHeader>

          {pendingTransition === 'LIVE' ? (
            <div className="space-y-1.5">
              <Label htmlFor="campaignId">Google Ads campaign ID</Label>
              <Input
                id="campaignId"
                value={linkedCampaignId}
                onChange={(e) => setLinkedCampaignId(e.target.value)}
                placeholder="e.g. 21345678901"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="reason">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="reason"
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  pendingTransition === 'REJECTED'
                    ? 'Why is this being rejected?'
                    : 'What needs to change before this can be approved?'
                }
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingTransition(null)}>
              Cancel
            </Button>
            <Button
              variant={pendingTransition === 'REJECTED' ? 'destructive' : 'default'}
              disabled={
                busy || (pendingTransition !== 'LIVE' && !reason.trim())
              }
              onClick={() => runTransition(pendingTransition!, reason.trim() || undefined)}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Detail({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm">{value}</p>
    </div>
  );
}
