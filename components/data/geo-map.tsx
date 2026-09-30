'use client';

import { useMemo, useState } from 'react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * World choropleth of Google Ads performance by country.
 *
 * The join is an integer subtraction, not a name match: a Google Ads country
 * criterion id is `2000 + ISO 3166-1 numeric`, and the topojson keys its
 * features on that same numeric code. Matching on names is where these maps
 * normally break — "Ivory Coast" against "Côte d'Ivoire", "South Korea"
 * against "Korea, Rep." — and none of that can happen here.
 *
 * The topojson is served from /world-110m.json as a static asset rather than
 * bundled, so it costs nothing on any page that is not this one.
 */

const GEO_URL = '/world-110m.json';

export type GeoDatum = {
  segment: string;
  isoNumeric: number | null;
  impressions: number;
  clicks: number;
  cost: number | null;
  conversions: number;
  ctr: number | null;
};

type Metric = 'cost' | 'clicks' | 'impressions' | 'conversions';

const METRIC_LABEL: Record<Metric, string> = {
  cost: 'Spend',
  clicks: 'Clicks',
  impressions: 'Impressions',
  conversions: 'Conversions',
};

/**
 * Five steps on a single hue.
 *
 * Sequential, not categorical: the value is a magnitude, and a rainbow would
 * imply categories that do not exist. Light-to-dark also survives greyscale
 * and the common forms of colour blindness.
 */
const STEPS = [
  'hsl(213 94% 92%)',
  'hsl(213 90% 80%)',
  'hsl(214 85% 65%)',
  'hsl(217 80% 50%)',
  'hsl(221 75% 34%)',
];
const NO_DATA_LIGHT = 'hsl(214 20% 92%)';
const NO_DATA_DARK = 'hsl(217 20% 22%)';

export function GeoMap({ data, canSeeMoney }: { data: GeoDatum[]; canSeeMoney: boolean }) {
  const [metric, setMetric] = useState<Metric>(canSeeMoney ? 'cost' : 'clicks');
  const [hover, setHover] = useState<{ datum: GeoDatum; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([0, 12]);

  const byIso = useMemo(() => {
    const m = new Map<number, GeoDatum>();
    for (const d of data) if (d.isoNumeric !== null) m.set(d.isoNumeric, d);
    return m;
  }, [data]);

  const valueOf = (d: GeoDatum): number =>
    metric === 'cost' ? (d.cost ?? 0) : (d[metric] as number);

  const max = useMemo(
    () => Math.max(0, ...data.map(valueOf)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, metric]
  );

  /** Bucket on a square root so one dominant market doesn't flatten the rest. */
  const colorFor = (value: number): string => {
    if (!max || value <= 0) return 'none';
    const t = Math.sqrt(value / max);
    return STEPS[Math.min(STEPS.length - 1, Math.floor(t * STEPS.length))]!;
  };

  const metrics: Metric[] = canSeeMoney
    ? ['cost', 'clicks', 'impressions', 'conversions']
    : ['clicks', 'impressions', 'conversions'];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Metric shown on the map">
          {metrics.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              aria-pressed={metric === m}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                metric === m
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom((z) => Math.min(8, z * 1.5))}
            aria-label="Zoom in"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
            aria-label="Zoom out"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              setZoom(1);
              setCenter([0, 12]);
            }}
            aria-label="Reset the map view"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-lg border bg-[hsl(210_40%_98%)] dark:bg-[hsl(222_47%_9%)]">
        <ComposableMap
          projection="geoEqualEarth"
          projectionConfig={{ scale: 165 }}
          width={980}
          height={460}
          style={{ width: '100%', height: 'auto' }}
        >
          <ZoomableGroup
            zoom={zoom}
            center={center}
            onMoveEnd={({ coordinates, zoom: z }) => {
              setCenter(coordinates as [number, number]);
              setZoom(z);
            }}
            maxZoom={8}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const iso = Number(geo.id);
                  const datum = byIso.get(iso);
                  const value = datum ? valueOf(datum) : 0;
                  const fill = datum && value > 0 ? colorFor(value) : 'none';

                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      onMouseEnter={(e) =>
                        datum && setHover({ datum, x: e.clientX, y: e.clientY })
                      }
                      onMouseMove={(e) =>
                        datum && setHover({ datum, x: e.clientX, y: e.clientY })
                      }
                      onMouseLeave={() => setHover(null)}
                      className={cn(
                        fill === 'none' && 'fill-[hsl(214_20%_92%)] dark:fill-[hsl(217_20%_22%)]'
                      )}
                      style={{
                        default: {
                          fill: fill === 'none' ? undefined : fill,
                          stroke: 'hsl(var(--background))',
                          strokeWidth: 0.4,
                          outline: 'none',
                        },
                        hover: {
                          fill: fill === 'none' ? undefined : fill,
                          stroke: 'hsl(var(--foreground))',
                          strokeWidth: datum ? 1 : 0.4,
                          outline: 'none',
                          cursor: datum ? 'pointer' : 'default',
                        },
                        pressed: { outline: 'none' },
                      }}
                    />
                  );
                })
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>

        {hover && (
          <div
            role="tooltip"
            className="pointer-events-none fixed z-50 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
            style={{
              // Offset from the cursor so the pointer never covers the label.
              left: Math.min(hover.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 0) - 200),
              top: hover.y + 14,
            }}
          >
            <p className="mb-1 font-semibold">{hover.datum.segment}</p>
            <dl className="space-y-0.5 tabular-nums">
              {canSeeMoney && (
                <Row label="Spend" value={formatCurrency(hover.datum.cost)} />
              )}
              <Row label="Clicks" value={formatNumber(hover.datum.clicks)} />
              <Row label="Impressions" value={formatNumber(hover.datum.impressions)} />
              <Row label="CTR" value={formatPercent(hover.datum.ctr)} />
              <Row
                label="Conversions"
                value={formatNumber(hover.datum.conversions, { decimals: 1 })}
              />
            </dl>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>Less</span>
        <div className="flex">
          {STEPS.map((c) => (
            <span
              key={c}
              className="h-3 w-7 first:rounded-l last:rounded-r"
              style={{ background: c }}
              aria-hidden="true"
            />
          ))}
        </div>
        <span>
          More — {METRIC_LABEL[metric].toLowerCase()}, up to{' '}
          {metric === 'cost' ? formatCurrency(max) : formatNumber(max)}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span
            className="h-3 w-7 rounded bg-[hsl(214_20%_92%)] dark:bg-[hsl(217_20%_22%)]"
            aria-hidden="true"
          />
          No data
        </span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
