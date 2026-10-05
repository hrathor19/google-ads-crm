import type { AdRequestFormValues } from '@/components/data/ad-request-form';

/**
 * A saved request, as the requirement form wants it back.
 *
 * One mapper for the edit screen and the read-only brief, because the brief
 * used to be a hand-picked list of nine fields and had quietly fallen six
 * behind the form — tracking id, client type, required leads and the rest
 * were captured from Operations and then shown to nobody. Deriving both from
 * the same function means a field added to the form appears in the brief
 * without anyone remembering to add it.
 */
export type RequestFormSource = {
  title: string;
  productService: string;
  location: string;
  startDate: string;
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
};

/** Every numeric field round-trips as a string: the inputs are text boxes. */
const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export function toFormDefaults(r: RequestFormSource): Partial<AdRequestFormValues> {
  return {
    title: r.title,
    productService: r.productService,
    location: r.location,
    startDate: r.startDate.slice(0, 10),
    notes: r.notes ?? '',

    trackingId: r.trackingId ?? '',
    clientType: (r.clientType ?? undefined) as never,
    ageRestriction: (r.ageRestriction ?? 'OPEN') as never,
    requiredLeads: num(r.requiredLeads),
    performanceParameter: r.performanceParameter ?? '',
    targetApplication: num(r.targetApplication),
    targetAdmission: r.targetAdmission ?? '',
    applicationDeadline: r.applicationDeadline ?? '',
    focusedMonths: r.focusedMonths ?? '',
    blockedLocations: r.blockedLocations ?? '',
    accountVisibility: r.accountVisibility ?? '',
    reportingPanel: r.reportingPanel ?? '',

    adUrlKapplpDesktop: r.adUrlKapplpDesktop ?? '',
    adUrlKapplpMobile: r.adUrlKapplpMobile ?? '',
    adUrlKapplpBing: r.adUrlKapplpBing ?? '',
    adUrlClientlpDesktop: r.adUrlClientlpDesktop ?? '',
    adUrlClientlpMobile: r.adUrlClientlpMobile ?? '',
    adUrlClientlpBing: r.adUrlClientlpBing ?? '',

    leadTargets: (r.leadTargets ?? []).map((t) => ({
      month: String(t.month).slice(0, 7),
      leads: String(t.leads),
    })),
  };
}
