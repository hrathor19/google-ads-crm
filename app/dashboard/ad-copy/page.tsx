'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { PageHeader } from '@/components/data/page-header';
import { EmptyState } from '@/components/data/states';
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
import { apiSend } from '@/lib/hooks/use-api';
import { usePermissions } from '@/components/providers/permission-provider';

/**
 * The standalone generator, for copy that isn't tied to a request.
 *
 * Inside an Ad Request the brief is already known; here the user supplies it,
 * and the same grounding rules apply — the model may only use what it is given
 * plus the live landing page.
 */
export default function AdCopyPage() {
  const { can } = usePermissions();
  const { toast } = useToast();

  // One field for the name: the standalone tool has no separate record of
  // the institution, so `institution: null` tells the shared component to
  // show a single "College / University / Course" box.
  const [brief, setBrief] = useState<CopyBriefValues>({
    institution: null,
    product: '',
    landingPageUrl: '',
    targetAudience: '',
    location: '',
    usps: '',
  });
  const [keywords, setKeywords] = useState('');
  const [researched, setResearched] = useState<KeywordVolume[]>([]);
  const [excluded, setExcluded] = useState(DEFAULT_EXCLUDED);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{
    headlines: Asset[];
    descriptions: Asset[];
    sitelinks: Sitelink[];
    validation: Validation;
    backend: string;
    backendReason: string | null;
  } | null>(null);

  if (!can('AD_COPY', 'VIEW')) {
    return (
      <EmptyState
        title="No access to AI ad copy"
        description="Your role does not include the AI Ad Copy permissions."
      />
    );
  }

  async function generate() {
    if (!brief.product.trim() || !brief.landingPageUrl.trim()) {
      toast({
        variant: 'destructive',
        title: 'Two fields are required',
        description: 'Enter what is being advertised and the landing page URL.',
      });
      return;
    }
    setGenerating(true);
    try {
      const res = await apiSend<typeof result & object>('/api/ai/ad-copy', 'POST', {
        product: brief.product,
        targetAudience: brief.targetAudience || 'General audience',
        location: brief.location || 'India',
        landingPageUrl: brief.landingPageUrl,
        usps: brief.usps || null,
        keywords: keywords
          .split(/[\n,]/)
          .map((k) => k.trim())
          .filter(Boolean),
        keywordVolumes: researched,
        excludedTerms: parseExcludedTerms(excluded),
      });
      setResult(res);
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

  return (
    <>
      <PageHeader
        title="AI ad copy generator"
        description={`${H_COUNT} headlines at ${H_MAX} characters, ${D_COUNT} descriptions at ${D_MAX}, and ${SITELINK_COUNT} sitelinks — built around the college, university or course name and grounded in the live landing page. Upload the Keyword Research export and the busiest themes get written in first.`}
      />

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 opacity-70" aria-hidden="true" />
              Brief
            </CardTitle>
            <CardDescription>The generator uses only what you supply here.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <CopyBriefFields value={brief} onChange={setBrief} disabled={generating} stacked />
            <KeywordCsvUpload
              rows={researched}
              onChange={setResearched}
              disabled={generating}
            />

            <div className="space-y-1.5">
              <Label htmlFor="keywords">
                {researched.length > 0 ? 'Extra keywords' : 'Keywords'}
              </Label>
              <Textarea
                id="keywords"
                rows={researched.length > 0 ? 2 : 3}
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder={'mba admission\nbest mba college'}
              />
              {researched.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  The uploaded research is used for ranking; anything typed here is ignored while
                  a file is loaded.
                </p>
              )}
            </div>
            <ExcludedTermsField value={excluded} onChange={setExcluded} disabled={generating} />

            <GenerateButton onGenerate={generate} generating={generating} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          {!result ? (
            <EmptyState
              icon={Sparkles}
              title="Nothing generated yet"
              description="Fill in the brief and generate. The landing page is fetched live, so only facts that are actually on the page can appear in the copy."
            />
          ) : (
            <>
              <ValidationSummary
                validation={result.validation}
                backend={result.backend}
                backendReason={result.backendReason}
              />
              <Card>
                <CardContent className="grid gap-5 p-4 xl:grid-cols-2">
                  <AssetList
                    title="Headlines"
                    assets={result.headlines}
                    limit={H_MAX}
                    editable={can('AD_COPY', 'EDIT')}
                    onChange={(headlines) => setResult({ ...result, headlines })}
                  />
                  <AssetList
                    title="Descriptions"
                    assets={result.descriptions}
                    limit={D_MAX}
                    editable={can('AD_COPY', 'EDIT')}
                    onChange={(descriptions) => setResult({ ...result, descriptions })}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <SitelinkList
                    sitelinks={result.sitelinks}
                    editable={can('AD_COPY', 'EDIT')}
                    onChange={(sitelinks) => setResult({ ...result, sitelinks })}
                  />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
