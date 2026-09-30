import { describe, expect, it } from 'vitest';
import type { AdRequestStatus } from '@prisma/client';
import { TRANSITIONS, STATUS_LABELS, ADS_QUEUE_STATUSES } from '@/lib/workflow/ad-requests';
import { adRequestInputSchema, parseKeywordLines } from '@/lib/workflow/schemas';

/**
 * The Ad Request state machine, checked as a declaration rather than by
 * driving the database — the table *is* the workflow, so what matters is that
 * it stays a correct graph and that no transition loses its guard.
 */

describe('the transition table', () => {
  it('labels every status', () => {
    for (const status of Object.keys(TRANSITIONS) as AdRequestStatus[]) {
      expect(STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('makes DRAFT unreachable as a target — it is the creation state', () => {
    // Nothing transitions *to* DRAFT; a request is born there and the only
    // way back into an editable state is CHANGES_REQUESTED.
    expect(TRANSITIONS.DRAFT).toBeNull();
    // It is of course a valid source: draft → submitted.
    expect(TRANSITIONS.SUBMITTED?.from).toContain('DRAFT' as AdRequestStatus);
  });

  it('guards every transition with a permission', () => {
    for (const [target, rule] of Object.entries(TRANSITIONS)) {
      if (!rule) continue;
      expect(rule.permission, `${target} has no permission`).toMatch(/^[A-Z_]+:[A-Z_]+$/);
      expect(rule.from.length, `${target} is reachable from nowhere`).toBeGreaterThan(0);
    }
  });

  it('requires a reason exactly where a decision needs explaining', () => {
    expect(TRANSITIONS.REJECTED?.requiresReason).toBe(true);
    expect(TRANSITIONS.CHANGES_REQUESTED?.requiresReason).toBe(true);
    expect(TRANSITIONS.APPROVED?.requiresReason).toBeFalsy();
    expect(TRANSITIONS.SUBMITTED?.requiresReason).toBeFalsy();
  });

  it('restricts submission to the person who raised the request', () => {
    expect(TRANSITIONS.SUBMITTED?.ownerOnly).toBe(true);
    // Approval must never be owner-only, or nobody else could review it.
    expect(TRANSITIONS.APPROVED?.ownerOnly).toBeFalsy();
    expect(TRANSITIONS.REJECTED?.ownerOnly).toBeFalsy();
  });

  it('routes approval and rejection through the APPROVE permission', () => {
    expect(TRANSITIONS.APPROVED?.permission).toBe('AD_REQUESTS:APPROVE');
    expect(TRANSITIONS.REJECTED?.permission).toBe('AD_REQUESTS:APPROVE');
    expect(TRANSITIONS.CHANGES_REQUESTED?.permission).toBe('AD_REQUESTS:APPROVE');
  });

  it('only allows a decision on a submitted request', () => {
    for (const target of ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] as const) {
      expect(TRANSITIONS[target]!.from).toEqual(['SUBMITTED']);
    }
  });

  it('lets a rejected or returned request be resubmitted', () => {
    expect(TRANSITIONS.SUBMITTED?.from).toContain('CHANGES_REQUESTED' as AdRequestStatus);
    expect(TRANSITIONS.SUBMITTED?.from).toContain('REJECTED' as AdRequestStatus);
  });

  it('only opens the delivery path after approval', () => {
    expect(TRANSITIONS.IN_PROGRESS?.from).toEqual(['APPROVED']);
    expect(TRANSITIONS.READY?.from).toEqual(['IN_PROGRESS']);
    expect(TRANSITIONS.COMPLETED?.from).toEqual(['LIVE']);
  });

  it('cannot reach a delivery state straight from SUBMITTED', () => {
    for (const target of ['IN_PROGRESS', 'READY', 'LIVE', 'COMPLETED'] as const) {
      expect(TRANSITIONS[target]!.from).not.toContain('SUBMITTED' as AdRequestStatus);
    }
  });

  it('builds the Ads team queue from post-approval states only', () => {
    for (const status of ADS_QUEUE_STATUSES) {
      expect(['APPROVED', 'IN_PROGRESS', 'READY', 'LIVE']).toContain(status);
    }
    expect(ADS_QUEUE_STATUSES).not.toContain('SUBMITTED' as AdRequestStatus);
    expect(ADS_QUEUE_STATUSES).not.toContain('DRAFT' as AdRequestStatus);
  });

  it('every non-terminal status can be left', () => {
    const reachableFrom = new Set<string>();
    for (const rule of Object.values(TRANSITIONS)) {
      for (const from of rule?.from ?? []) reachableFrom.add(from);
    }
    // COMPLETED is the only intentional dead end.
    const terminal = (Object.keys(TRANSITIONS) as AdRequestStatus[]).filter(
      (s) => !reachableFrom.has(s)
    );
    expect(terminal).toEqual(['COMPLETED']);
  });
});

describe('request validation', () => {
  const valid = {
    title: 'MBA Admissions 2026',
    objective: 'LEAD_GENERATION' as const,
    productService: 'Two-year MBA',
    targetAudience: 'Graduates 21-26',
    location: 'Bangalore',
    budget: 100000,
    startDate: '2026-10-01',
    landingPageUrl: 'https://example.com/mba',
  };

  it('accepts a complete brief', () => {
    expect(adRequestInputSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a non-http scheme on the landing page', () => {
    // The URL is fetched server-side by the scorer, so anything else would
    // hand that fetcher an arbitrary target.
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com']) {
      expect(adRequestInputSchema.safeParse({ ...valid, landingPageUrl: url }).success).toBe(false);
    }
  });

  it('refuses a zero or negative budget', () => {
    expect(adRequestInputSchema.safeParse({ ...valid, budget: 0 }).success).toBe(false);
    expect(adRequestInputSchema.safeParse({ ...valid, budget: -5 }).success).toBe(false);
  });

  it('refuses a malformed start date', () => {
    expect(adRequestInputSchema.safeParse({ ...valid, startDate: '01/10/2026' }).success).toBe(false);
  });

  it('refuses an unknown objective', () => {
    expect(adRequestInputSchema.safeParse({ ...valid, objective: 'WORLD_PEACE' }).success).toBe(false);
  });
});

describe('keyword parsing', () => {
  it('splits on newlines and commas, trimming and de-duplicating', () => {
    expect(parseKeywordLines('mba admission\n best mba , mba admission')).toEqual([
      'mba admission',
      'best mba',
    ]);
  });

  it('handles empty input', () => {
    expect(parseKeywordLines(null)).toEqual([]);
    expect(parseKeywordLines('   ')).toEqual([]);
  });

  it('caps the list so a paste of thousands cannot reach the model', () => {
    const many = Array.from({ length: 500 }, (_, i) => `kw${i}`).join('\n');
    expect(parseKeywordLines(many)).toHaveLength(200);
  });
});
