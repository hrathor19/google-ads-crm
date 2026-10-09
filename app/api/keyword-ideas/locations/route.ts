import { handle, requirePermission } from '@/lib/api';
import {
  DEFAULT_GEO_TARGET,
  DEFAULT_LANGUAGE,
  LANGUAGES,
  listGeoTargets,
} from '@/lib/google-ads/keyword-ideas';

export const dynamic = 'force-dynamic';

/**
 * The location and language pickers.
 *
 * Served from a twelve-hour cache in the library, so opening the page costs
 * no quota. If the lookup fails the page still works: it falls back to India
 * and English, which is what nearly every search here targets anyway, and
 * says so rather than presenting an empty dropdown.
 */
export async function GET() {
  return handle(async () => {
    await requirePermission('KEYWORD_PLANNER', 'VIEW');

    try {
      const locations = await listGeoTargets();
      return {
        locations,
        languages: LANGUAGES,
        defaults: { geoTargetIds: [DEFAULT_GEO_TARGET], languageId: DEFAULT_LANGUAGE },
        degraded: false,
      };
    } catch (err) {
      console.error('[keyword-ideas] geo target lookup failed', err);
      return {
        locations: [{ id: DEFAULT_GEO_TARGET, name: 'India', type: 'Country' }],
        languages: LANGUAGES,
        defaults: { geoTargetIds: [DEFAULT_GEO_TARGET], languageId: DEFAULT_LANGUAGE },
        degraded: true,
      };
    }
  });
}
