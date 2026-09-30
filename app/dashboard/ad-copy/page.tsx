'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { PageHeader } from '@/components/data/page-header';
import { EmptyState } from '@/components/data/states';
import {
  AssetList,
  D_MAX,
  H_MAX,
  ToneSelector,
  ValidationSummary,
  type Asset,
  type Validation,
} from '@/components/data/ad-copy-panel';
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

  const [product, setProduct] = useState('');
  const [brand, setBrand] = useState('');
  const [audience, setAudience] = useState('');
  const [location, setLocation] = useState('');
  const [url, setUrl] = useState('');
  const [usps, setUsps] = useState('');
  const [keywords, setKeywords] = useState('');
  const [tone, setTone] = useState('professional');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{
    headlines: Asset[];
    descriptions: Asset[];
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
    if (!product.trim() || !url.trim()) {
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
        tone,
        product,
        brand: brand || null,
        targetAudience: audience || 'General audience',
        location: location || 'India',
        landingPageUrl: url,
        usps: usps || null,
        keywords: keywords
          .split(/[\n,]/)
          .map((k) => k.trim())
          .filter(Boolean),
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
        description={`Responsive search ad copy grounded in your brief and the live landing page. Headlines cap at ${H_MAX} characters, descriptions at ${D_MAX}.`}
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
            <div className="space-y-1.5">
              <Label htmlFor="product">
                What are you advertising? <span className="text-destructive">*</span>
              </Label>
              <Input
                id="product"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                placeholder="Two-year full-time MBA"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand">Brand</Label>
              <Input
                id="brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="KollegeApply"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="url">
                Landing page URL <span className="text-destructive">*</span>
              </Label>
              <Input
                id="url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/mba"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audience">Target audience</Label>
              <Input
                id="audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="Graduates aged 21–26"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Bangalore"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="usps">USPs and offers</Label>
              <Textarea
                id="usps"
                rows={3}
                value={usps}
                onChange={(e) => setUsps(e.target.value)}
                placeholder="NAAC A++, scholarships up to 50%"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="keywords">Keywords</Label>
              <Textarea
                id="keywords"
                rows={3}
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder={'mba admission\nbest mba college'}
              />
            </div>
            <ToneSelector
              tone={tone}
              onChange={setTone}
              onGenerate={generate}
              generating={generating}
            />
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
            </>
          )}
        </div>
      </div>
    </>
  );
}
