'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  FileSearch,
  KeyRound,
  Link2,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  Wallet,
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
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/data/page-header';
import {
  TransitionDialog,
  stepNeedsDialog,
  type TransitionPayload,
} from '@/components/data/transition-dialog';
import { ErrorState } from '@/components/data/states';
import { RequestStatusBadge, REQUEST_ACTION_LABELS,
  REQUEST_STATUS_LABELS } from '@/components/data/status-badge';
import {
  AssetList,
  CopyBriefFields,
  DEFAULT_EXCLUDED,
  D_COUNT,
  D_MAX,
  GenerateButton,
  H_COUNT,
  H_MAX,
  ExcludedTermsField,
  KeywordCsvUpload,
  SITELINK_COUNT,
  SitelinkList,
  ValidationSummary,
  type Asset,
  type CopyBriefFields as CopyBriefValues,
  type Sitelink,
  type Validation,
} from '@/components/data/ad-copy-panel';
import type { KeywordVolume } from '@/lib/ai/keyword-csv';
import { parseExcludedTerms } from '@/lib/ai/exclusions';
import { LandingScorePanel, type LandingScoreData } from '@/components/data/landing-score-panel';
import { AdRequestForm } from '@/components/data/ad-request-form';
import { toFormDefaults } from '@/lib/workflow/form-defaults';
import { CampaignLinkDialog } from '@/components/data/campaign-link-dialog';
import { RequestPerformance } from '@/components/data/request-performance';
import { apiSend, useApi } from '@/lib/hooks/use-api';
import { usePermissions } from '@/components/providers/permission-provider';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';

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
  trackingId: string | null;
  clientType: string | null;
  ageRestriction: string | null;
  requiredLeads: number | null;
  performanceParameter: string | null;
  targetApplication: number | null;
  targetAdmission: string | null;
  applicationDeadline: string | null;
  focusedMonths: string | null;
  blockedLocations: string | null;
  accountVisibility: string | null;
  reportingPanel: string | null;
  adUrlKapplpDesktop: string | null;
  adUrlKapplpMobile: string | null;
  adUrlKapplpBing: string | null;
  adUrlClientlpDesktop: string | null;
  adUrlClientlpMobile: string | null;
  adUrlClientlpBing: string | null;
  leadTargets?: Array<{ month: string; leads: number }>;
  linkedCampaignId: string | null;
  linkedCampaigns: Array<{
    id: number;
    campaignId: string;
    name: string | null;
    status: string | null;
    accountId: number;
  }>;
  decisionReason: string | null;
  createdAt: string;
  accountId: number | null;
  accountName: string | null;
  createdBy: { id: string; name: string; email: string };
  assignedTo: { id: string; name: string; email: string } | null;
  accountManager: { id: string; name: string; email: string } | null;
  adSpecialist: { id: string; name: string; email: string } | null;
  /** Optimistic lock, sent back with every transition. */
  version: number;
  reviewRound: number;
  reviewRounds: Array<{
    round: number;
    outcome: string;
    remarks: string | null;
    reviewedAt: string;
    reviewer: { name: string; email: string };
  }>;
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
    headlines: Asset[];
    descriptions: Asset[];
    sitelinks: Sitelink[] | null;
    keywords: KeywordVolume[] | null;
    excludedTerms: string[] | null;
    validation: Validation | null;
    backend: string;
    isFinal: boolean;
    createdAt: string;
    createdBy: { name: string };
  }>;
  landingScores: Array<LandingScoreData & { id: string; matchedByUrl?: boolean }>;
};

type Response = {
  request: RequestDetail;
  transitions: string[];
  canSeeMoney: boolean;
};

/** A transition that needs a typed reason before it can be sent. */

export default function AdRequestDetailPage({ params }: { params: { id: string } }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can, user } = usePermissions();

  const { data, isLoading, error, refetch } = useApi<Response>(
    ['ad-request', params.id],
    `/api/ad-requests/${params.id}`
  );

  const [pendingTransition, setPendingTransition] = useState<string | null>(null);
  const [linkingCampaigns, setLinkingCampaigns] = useState(false);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [researched, setResearched] = useState<KeywordVolume[]>([]);
  const [excluded, setExcluded] = useState(DEFAULT_EXCLUDED);
  // Null until the request has loaded; seeded from it on first render so the
  // fields show what Ops actually filed rather than empty boxes.
  const [briefFields, setBriefFields] = useState<CopyBriefValues | null>(null);
  // Null until edited, so the list always falls back to what is stored.
  const [keywordDraft, setKeywordDraft] = useState<string[] | null>(null);
  const [savingKeywords, setSavingKeywords] = useState(false);
  const [draftCopy, setDraftCopy] = useState<{
    headlines: Asset[];
    descriptions: Asset[];
    sitelinks: Sitelink[];
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

  const briefFromRequest = (): CopyBriefValues => ({
    institution: r.title,
    product: r.productService,
    landingPageUrl: r.landingPageUrl,
    targetAudience: r.targetAudience ?? '',
    location: r.location,
    usps: r.usps ?? '',
  });
  const brief = briefFields ?? briefFromRequest();

  // The stored list, unless the reviewer has just changed it.
  const keywords =
    keywordDraft ??
    (r.keywords ?? '')
      .split(/[\n,]/)
      .map((k) => k.trim())
      .filter(Boolean);
  // Pruning mirrors the API's own rule, so the UI never offers a × that the
  // server will refuse.
  const canPruneKeywords =
    (can('AD_REQUESTS', 'APPROVE') && r.status === 'UNDER_REVIEW') ||
    (can('AD_REQUESTS', 'BUILD') &&
      ['AWAITING_AD_SUBMISSION', 'RECHECK_REQUESTED'].includes(r.status));
  const briefChanged = JSON.stringify(brief) !== JSON.stringify(briefFromRequest());

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['ad-request', params.id] });
    queryClient.invalidateQueries({ queryKey: ['ad-requests'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  async function saveCampaigns(payload: { campaignIds: number[]; accountId: number | null }) {
    setBusy(true);
    try {
      await apiSend(`/api/ad-requests/${params.id}/campaigns`, 'PUT', {
        ...payload,
        expectedVersion: data?.request.version ?? null,
      });
      toast({
        title: payload.campaignIds.length
          ? `${payload.campaignIds.length} campaign${payload.campaignIds.length === 1 ? '' : 's'} linked`
          : 'Campaigns unlinked',
        description: 'Performance for this request now reads from them.',
      });
      setLinkingCampaigns(false);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['assigned-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['request-performance', params.id] });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not change the campaigns',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function runTransition(target: string, payload: TransitionPayload = {}) {
    setBusy(true);
    try {
      await apiSend(`/api/ad-requests/${params.id}/transition`, 'POST', {
        target,
        ...payload,
        // The version the page was rendered from, so two people acting at
        // once cannot both succeed.
        expectedVersion: data?.request.version ?? null,
      });
      toast({ title: `Request ${REQUEST_STATUS_LABELS[target]?.toLowerCase() ?? target}` });
      setPendingTransition(null);
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
        sitelinks: Sitelink[];
        validation: Validation;
        backend: string;
        backendReason: string | null;
      }>('/api/ai/ad-copy', 'POST', {
        requestId: params.id,
        save,
        keywordVolumes: researched,
        excludedTerms: parseExcludedTerms(excluded),
        institution: brief.institution,
        product: brief.product,
        landingPageUrl: brief.landingPageUrl,
        targetAudience: brief.targetAudience,
        location: brief.location,
        usps: brief.usps,
      });
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

  async function saveKeywords(next: string[]) {
    setKeywordDraft(next);
    setSavingKeywords(true);
    try {
      await apiSend(`/api/ad-requests/${params.id}/keywords`, 'PUT', { keywords: next });
      invalidate();
    } catch (e) {
      // Put the list back: a chip that vanishes on a failed save is worse
      // than one that never left, because the reviewer approves believing
      // it is gone.
      setKeywordDraft(null);
      toast({
        variant: 'destructive',
        title: 'Could not update the keywords',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setSavingKeywords(false);
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
          {r.accountManager && (
            <Badge variant="outline" className="font-normal">
              AM: {r.accountManager.name}
            </Badge>
          )}
          {r.adSpecialist && (
            <Badge variant="outline" className="font-normal">
              Specialist: {r.adSpecialist.name}
            </Badge>
          )}
          {!r.accountManager && !r.adSpecialist && r.assignedTo && (
            <Badge variant="outline" className="font-normal">
              Owner: {r.assignedTo.name}
            </Badge>
          )}
          {r.accountName && (
            <Badge variant="outline" className="gap-1 font-normal">
              <Wallet className="h-3 w-3" aria-hidden="true" />
              {r.accountName}
            </Badge>
          )}
          {/* The campaigns are what the reporting is read from, so say
              plainly when there are none rather than leaving a silent gap. */}
          {r.linkedCampaigns.length > 0 ? (
            <Badge
              variant="outline"
              className="gap-1 font-normal"
              title={r.linkedCampaigns.map((c) => c.name ?? c.campaignId).join(', ')}
            >
              <Link2 className="h-3 w-3" aria-hidden="true" />
              {r.linkedCampaigns.length} campaign{r.linkedCampaigns.length === 1 ? '' : 's'}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/30 bg-amber-500/10 font-normal text-amber-700 dark:text-amber-400"
            >
              <Link2 className="h-3 w-3" aria-hidden="true" />
              {r.linkedCampaignId
                ? `Campaign ${r.linkedCampaignId} (unlinked)`
                : 'No campaigns linked'}
            </Badge>
          )}
          {can('AD_REQUESTS', 'ASSIGN') && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={busy}
              onClick={() => setLinkingCampaigns(true)}
            >
              {r.linkedCampaigns.length > 0 ? 'Change campaigns' : 'Link campaigns'}
            </Button>
          )}

          <div className="ml-auto flex flex-wrap gap-2">
            {data.transitions.map((t) => (
              <Button
                key={t}
                size="sm"
                variant={
                  t === 'REVIEW_APPROVED'
                    ? 'default'
                    : t === 'REJECTED'
                      ? 'destructive'
                      : 'outline'
                }
                disabled={busy}
                onClick={() =>
                  stepNeedsDialog(t) ? setPendingTransition(t) : runTransition(t)
                }
              >
                {t === 'REVIEW_APPROVED' && <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {t === 'REJECTED' && <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {t === 'SUBMITTED' && <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {REQUEST_ACTION_LABELS[t] ?? REQUEST_STATUS_LABELS[t] ?? t}
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
          {r.reviewRounds.length > 0 && (
            <TabsTrigger value="reviews">
              Reviews
              <span className="ml-1.5 text-xs text-muted-foreground">{r.reviewRounds.length}</span>
            </TabsTrigger>
          )}
          {can('CAMPAIGNS', 'VIEW') && (
            <TabsTrigger value="performance">
              Performance
              {r.linkedCampaigns.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {r.linkedCampaigns.length}
                </span>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        {can('CAMPAIGNS', 'VIEW') && (
          <TabsContent value="performance" className="space-y-4">
            <RequestPerformance
              requestId={params.id}
              onLinkCampaigns={
                can('AD_REQUESTS', 'ASSIGN') ? () => setLinkingCampaigns(true) : undefined
              }
            />
          </TabsContent>
        )}

        {/* ─── Brief ─────────────────────────────────────────────────── */}
        <TabsContent value="brief">
          {/* The requirement form itself, filled in and uneditable, rather
              than a hand-picked summary of it. The summary had fallen six
              fields behind the form — tracking id, client type, required
              leads, the targets and the per-platform destinations were all
              captured from Operations and then shown to nobody. */}
          <AdRequestForm readOnly defaults={toFormDefaults(r)} />
        </TabsContent>

        {/* ─── Ad copy ───────────────────────────────────────────────── */}
        {can('AD_COPY', 'VIEW') && (
          <TabsContent value="copy" className="space-y-4">
            {/* ── What the reviewer is actually approving ──────────────
                The keywords and the copy, on the screen where the approve
                button is. Before this a reviewer had to take the Ad
                Specialist's word for both, and the only way to object to
                one keyword was to reject the whole submission and describe
                the problem in prose. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="h-4 w-4 opacity-70" aria-hidden="true" />
                  Keywords
                  {keywords.length > 0 && (
                    <span className="text-sm font-normal text-muted-foreground">
                      {keywords.length}
                    </span>
                  )}
                </CardTitle>
                <CardDescription>
                  {canPruneKeywords
                    ? 'Remove any that will not convert, then approve. Removing one takes effect immediately.'
                    : 'The list this request goes live with.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {keywords.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No keywords yet. The Ad Specialist adds them by uploading the Keyword
                    Research export and marking a copy version final.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {keywords.map((k) => (
                      <span
                        key={k}
                        className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-sm"
                      >
                        {k}
                        {canPruneKeywords && (
                          <button
                            type="button"
                            aria-label={`Remove ${k}`}
                            disabled={savingKeywords}
                            onClick={() => saveKeywords(keywords.filter((x) => x !== k))}
                            className="rounded-sm opacity-50 transition-opacity hover:opacity-100 disabled:opacity-30"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {can('AD_COPY', 'GENERATE_AI') ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 opacity-70" aria-hidden="true" />
                    Generate responsive search ad copy
                  </CardTitle>
                  <CardDescription>
                    {H_COUNT} headlines at {H_MAX} characters, {D_COUNT} descriptions at {D_MAX},
                    and {SITELINK_COUNT} sitelinks — grounded in this brief and the live landing
                    page.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CopyBriefFields
                    value={brief}
                    onChange={setBriefFields}
                    disabled={generating}
                    onReset={() => setBriefFields(null)}
                    changed={briefChanged}
                  />
                  <KeywordCsvUpload
                    rows={researched}
                    onChange={setResearched}
                    disabled={generating}
                  />
                  <ExcludedTermsField
                    value={excluded}
                    onChange={setExcluded}
                    disabled={generating}
                  />
                  <GenerateButton
                    onGenerate={() => generateCopy(false)}
                    generating={generating}
                  />
                  {draftCopy && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={generating}
                        onClick={() => generateCopy(true)}
                      >
                        Save this as a new version
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Then mark it final — that submits the copy and writes the{' '}
                        {researched.length > 0
                          ? `${researched.length} researched keyword(s)`
                          : 'keywords'}{' '}
                        onto this request.
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : null}

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
                <Card>
                  <CardContent className="p-4">
                    <SitelinkList
                      sitelinks={draftCopy.sitelinks}
                      editable={can('AD_COPY', 'EDIT')}
                      onChange={(sitelinks) => setDraftCopy({ ...draftCopy, sitelinks })}
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            {/* An explicit empty state. A reviewer opening this tab used to
                see only "generating copy needs the AI Ad Copy permission",
                which reads as copy being withheld from them — when in fact
                the Ad Specialist had not written any. */}
            {r.adCopyVersions.length === 0 && (
              <Card>
                <CardContent className="space-y-1 py-8 text-center">
                  <p className="text-sm font-medium">No ad copy yet</p>
                  <p className="text-sm text-muted-foreground">
                    {can('AD_COPY', 'GENERATE_AI')
                      ? 'Generate it above, then save a version and mark it final.'
                      : 'The Ad Specialist has not saved a version for this request yet. There is nothing being withheld from you.'}
                  </p>
                  {!can('AD_COPY', 'GENERATE_AI') && (
                    <p className="pt-1 text-xs text-muted-foreground">
                      Generating copy yourself needs the AI Ad Copy: Generate AI permission.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {r.adCopyVersions.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Saved versions</h3>
                {r.adCopyVersions.map((v) => (
                  <Card key={v.id} className={v.isFinal ? 'border-emerald-500/40' : undefined}>
                    <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-sm">Version {v.version}</CardTitle>
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
                    <CardContent className="space-y-4">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <AssetList title="Headlines" assets={v.headlines} limit={H_MAX} />
                        <AssetList title="Descriptions" assets={v.descriptions} limit={D_MAX} />
                      </div>
                      <SitelinkList sitelinks={v.sitelinks ?? []} />
                      {v.excludedTerms && v.excludedTerms.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Written without mentioning:{' '}
                          <span className="font-medium text-foreground">
                            {v.excludedTerms.join(', ')}
                          </span>
                        </p>
                      )}
                      {v.keywords && v.keywords.length > 0 && (
                        <div>
                          <h3 className="mb-2 text-sm font-semibold">
                            Keywords
                            <span className="ml-1.5 font-normal text-muted-foreground">
                              {v.keywords.length} from research
                            </span>
                          </h3>
                          <div className="flex flex-wrap gap-1">
                            {v.keywords.slice(0, 24).map((k) => (
                              <Badge key={k.keyword} variant="secondary" className="font-normal">
                                {k.keyword}
                                {k.volume > 0 && (
                                  <span className="ml-1 text-muted-foreground">
                                    {k.volume.toLocaleString('en-IN')}
                                  </span>
                                )}
                              </Badge>
                            ))}
                            {v.keywords.length > 24 && (
                              <Badge variant="outline" className="font-normal">
                                +{v.keywords.length - 24} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
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
                {/* Says where the score came from. Without it, a score run
                    from the menu for this URL looks like one somebody took
                    for this request. */}
                {r.landingScores[0]!.matchedByUrl && (
                  <p className="text-xs text-muted-foreground">
                    Matched by URL — scored from the Landing Page Scorer rather than from this
                    request. Run it here to attach a score of your own.
                  </p>
                )}
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

        {/* ─── Review rounds ─────────────────────────────────────────── */}
        <TabsContent value="reviews" className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm text-muted-foreground">
                Every round of the recheck loop, oldest first. Round {r.reviewRound} is the one
                currently open.
              </p>
              {r.reviewRounds.map((rev) => (
                <div
                  key={rev.round}
                  className={cn(
                    'rounded-lg border p-3',
                    rev.outcome === 'APPROVED'
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-amber-500/30 bg-amber-500/5'
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      Round {rev.round} —{' '}
                      {rev.outcome === 'APPROVED' ? 'approved' : 'sent back for a recheck'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {rev.reviewer.name} · {formatDate(rev.reviewedAt)}
                    </p>
                  </div>
                  {rev.remarks && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {rev.remarks}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

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
      <CampaignLinkDialog
        open={linkingCampaigns}
        busy={busy}
        currentAccountId={data.request.accountId}
        currentCampaignIds={data.request.linkedCampaigns.map((c) => c.id)}
        onCancel={() => setLinkingCampaigns(false)}
        onConfirm={saveCampaigns}
      />

      <TransitionDialog
        target={pendingTransition}
        busy={busy}
        currentAccountId={data.request.accountId}
        linkedCampaignCount={data.request.linkedCampaigns.length}
        onCancel={() => setPendingTransition(null)}
        onConfirm={(payload) => runTransition(pendingTransition!, payload)}
      />
    </>
  );
}

