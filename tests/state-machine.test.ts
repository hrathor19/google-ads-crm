import { describe, expect, it } from 'vitest';
import type { AdRequestStatus } from '@prisma/client';
import {
  SPECIALIST_QUEUE,
  STATUS_LABELS,
  STATUS_STEP,
  SYSTEM_STEPS,
  TRANSITIONS,
  evaluate,
  findTransition,
  isTerminal,
  nextStates,
  TRANSIENT_STATES,
} from '@/lib/workflow/state-machine';

/**
 * The Ad Setup & Approval flow, exercised directly.
 *
 * Every legal move, and — the part that matters — every illegal one. A
 * transition table only tested through the happy path lets a missing guard
 * through, and a missing guard here means someone approving their own budget.
 */

const ALL_STATUSES: AdRequestStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'AWAITING_AM_ASSIGNMENT',
  'AM_ASSIGNED',
  'AWAITING_AD_SUBMISSION',
  'ADS_SUBMITTED',
  'UNDER_REVIEW',
  'RECHECK_REQUESTED',
  'REVIEW_APPROVED',
  'BUDGET_APPROVED',
  'ACCOUNT_ASSIGNED',
  'LIVE',
  'COMPLETED',
  'REJECTED',
];

/** An actor who holds everything, so a refusal is never about permissions. */
const god = {
  isOwner: true,
  isSuperAdmin: false,
  hasPermission: () => true,
};

/** Everything a requirement could ask for, satisfied. */
const complete = {
  reason: 'Because.',
  accountManagerId: 'cku000000000000000000000',
  adSpecialistId: 'cku111111111111111111111',
  budget: 250_000,
  requiredCpl: 2_500,
  linkedCampaignId: '21345678901',
};

const move = (from: AdRequestStatus, to: AdRequestStatus, over: Partial<typeof god> = {}) =>
  evaluate({ from, to, ...god, ...over, provided: complete });

describe('the table itself', () => {
  it('labels every status, including the retired ones', () => {
    for (const s of ALL_STATUSES) expect(STATUS_LABELS[s]).toBeTruthy();
    expect(STATUS_LABELS.APPROVED).toMatch(/retired/i);
  });

  it('guards every human transition with a permission', () => {
    for (const t of TRANSITIONS) {
      expect(t.permission, `${t.to} has no permission`).toMatch(/^[A-Z_]+:[A-Z_]+$/);
    }
  });

  it('never transitions back into DRAFT — it is the creation state', () => {
    expect(TRANSITIONS.some((t) => t.to === 'DRAFT')).toBe(false);
  });

  it('treats COMPLETED as the only dead end', () => {
    // REJECTED is not one: a rejected requirement can be fixed and
    // resubmitted, which is the whole point of recording a reason.
    expect(ALL_STATUSES.filter(isTerminal)).toEqual(['COMPLETED']);
  });

  it('counts the three System boxes as transient, not finished', () => {
    // Nothing declares a move out of these; the system advances past them
    // once the mail is away. Calling them terminal would make a stalled
    // request look complete.
    expect(TRANSIENT_STATES.sort()).toEqual(['ADS_SUBMITTED', 'AM_ASSIGNED', 'SUBMITTED']);
    for (const s of TRANSIENT_STATES) expect(isTerminal(s)).toBe(false);
  });

  it('leaves no state stranded — every one is reachable from DRAFT', () => {
    const seen = new Set<AdRequestStatus>(['DRAFT']);
    const queue: AdRequestStatus[] = ['DRAFT'];
    while (queue.length) {
      const here = queue.shift()!;
      for (const next of nextStates(here)) {
        // The auto-advance targets are reached by the system, not by a rule.
        const rule = findTransition(here, next);
        const targets = [next, rule?.autoAdvanceTo].filter(Boolean) as AdRequestStatus[];
        for (const t of targets) {
          if (!seen.has(t)) {
            seen.add(t);
            queue.push(t);
          }
        }
      }
    }
    // Retired states are unreachable on purpose: nothing moves to
    // BUDGET_APPROVED or ACCOUNT_ASSIGNED since the budget moved to the
    // assignment step. They remain as origins so a request already in one
    // can still finish, which the "stranded" test below covers.
    const RETIRED: AdRequestStatus[] = ['BUDGET_APPROVED', 'ACCOUNT_ASSIGNED'];
    const unreachable = ALL_STATUSES.filter((s) => !seen.has(s) && !RETIRED.includes(s));
    expect(unreachable).toEqual([]);
    for (const s of RETIRED) {
      expect(nextStates(s).length, `${s} has no way out`).toBeGreaterThan(0);
    }
  });

  it('numbers each step the way the flow diagram does', () => {
    expect(STATUS_STEP.SUBMITTED).toBe(1);
    expect(STATUS_STEP.UNDER_REVIEW).toBe(6);
    expect(STATUS_STEP.REVIEW_APPROVED).toBe(8);
    expect(STATUS_STEP.COMPLETED).toBe(10);
  });
});

describe('the steps, in order', () => {
  const happyPath: Array<[AdRequestStatus, AdRequestStatus]> = [
    ['DRAFT', 'SUBMITTED'],
    ['AWAITING_AM_ASSIGNMENT', 'AM_ASSIGNED'],
    ['AWAITING_AD_SUBMISSION', 'ADS_SUBMITTED'],
    ['UNDER_REVIEW', 'REVIEW_APPROVED'],
    // Straight to live: the budget is agreed at assignment, so there is no
    // separate funding step and no second handover of the same person.
    ['REVIEW_APPROVED', 'LIVE'],
    ['LIVE', 'COMPLETED'],
  ];

  it.each(happyPath)('allows %s → %s', (from, to) => {
    expect(move(from, to).ok).toBe(true);
  });

  it('advances the three system steps on its own', () => {
    expect(findTransition('DRAFT', 'SUBMITTED')?.autoAdvanceTo).toBe('AWAITING_AM_ASSIGNMENT');
    expect(findTransition('AWAITING_AM_ASSIGNMENT', 'AM_ASSIGNED')?.autoAdvanceTo).toBe(
      'AWAITING_AD_SUBMISSION'
    );
    expect(findTransition('AWAITING_AD_SUBMISSION', 'ADS_SUBMITTED')?.autoAdvanceTo).toBe(
      'UNDER_REVIEW'
    );
    for (const s of ['AWAITING_AM_ASSIGNMENT', 'AWAITING_AD_SUBMISSION', 'UNDER_REVIEW']) {
      expect(SYSTEM_STEPS[s]?.label).toBeTruthy();
    }
  });

  it('names the right actor for each step', () => {
    // Ops raises it and signs off the copy; a Manager staffs it and funds it;
    // the Specialist builds and launches.
    expect(findTransition('DRAFT', 'SUBMITTED')?.actor).toBe('OPS');
    expect(findTransition('UNDER_REVIEW', 'RECHECK_REQUESTED')?.actor).toBe('OPS');
    expect(findTransition('UNDER_REVIEW', 'REVIEW_APPROVED')?.actor).toBe('OPS');

    expect(findTransition('AWAITING_AM_ASSIGNMENT', 'AM_ASSIGNED')?.actor).toBe('MANAGER');

    expect(findTransition('AWAITING_AD_SUBMISSION', 'ADS_SUBMITTED')?.actor).toBe('AD_SPECIALIST');
    expect(findTransition('REVIEW_APPROVED', 'LIVE')?.actor).toBe('AD_SPECIALIST');
    expect(findTransition('LIVE', 'COMPLETED')?.actor).toBe('AD_SPECIALIST');
  });

  it('separates building from editing and from approving', () => {
    // Three different jobs, three different permissions.
    expect(findTransition('AWAITING_AD_SUBMISSION', 'ADS_SUBMITTED')?.permission).toBe(
      'AD_REQUESTS:BUILD'
    );
    expect(findTransition('ACCOUNT_ASSIGNED', 'LIVE')?.permission).toBe('AD_REQUESTS:BUILD');
    expect(findTransition('LIVE', 'COMPLETED')?.permission).toBe('AD_REQUESTS:BUILD');
  });

  it('refuses the build steps to someone who only holds EDIT', () => {
    const r = evaluate({
      from: 'AWAITING_AD_SUBMISSION',
      to: 'ADS_SUBMITTED',
      isOwner: false,
      isSuperAdmin: false,
      hasPermission: (f) => f === 'AD_REQUESTS:EDIT',
      provided: complete,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/AD_REQUESTS:BUILD/);
  });

  it('keeps signing off the copy separate from staffing and funding', () => {
    // Approving the keywords is Ops' call; deciding who builds it and for
    // how much is the Manager's, behind ASSIGN.
    expect(findTransition('AWAITING_AM_ASSIGNMENT', 'AM_ASSIGNED')?.permission).toBe(
      'AD_REQUESTS:ASSIGN'
    );
    expect(findTransition('UNDER_REVIEW', 'REVIEW_APPROVED')?.permission).toBe(
      'AD_REQUESTS:APPROVE'
    );
  });

  it('refuses assignment to someone who only holds APPROVE', () => {
    const r = evaluate({
      from: 'AWAITING_AM_ASSIGNMENT',
      to: 'AM_ASSIGNED',
      isOwner: false,
      isSuperAdmin: false,
      hasPermission: (f) => f === 'AD_REQUESTS:APPROVE',
      provided: complete,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('FORBIDDEN');
      expect(r.message).toMatch(/AD_REQUESTS:ASSIGN/);
    }
  });
});

describe('the recheck loop', () => {
  it('goes back for a recheck and returns', () => {
    expect(move('UNDER_REVIEW', 'RECHECK_REQUESTED').ok).toBe(true);
    expect(move('RECHECK_REQUESTED', 'ADS_SUBMITTED').ok).toBe(true);
  });

  it('can run any number of times — the loop has no counter', () => {
    // Three rounds, the integration case from the brief.
    for (let round = 0; round < 3; round += 1) {
      expect(move('UNDER_REVIEW', 'RECHECK_REQUESTED').ok).toBe(true);
      expect(move('RECHECK_REQUESTED', 'ADS_SUBMITTED').ok).toBe(true);
    }
  });

  it('refuses a recheck with no remarks', () => {
    const r = evaluate({
      from: 'UNDER_REVIEW',
      to: 'RECHECK_REQUESTED',
      ...god,
      provided: { ...complete, reason: '   ' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('MISSING');
      expect(r.message).toMatch(/what needs changing/i);
    }
  });
});

describe('requirements', () => {
  it('will not assign step 3 without naming an Ad Specialist', () => {
    const r = evaluate({
      from: 'AWAITING_AM_ASSIGNMENT',
      to: 'AM_ASSIGNED',
      ...god,
      provided: { ...complete, adSpecialistId: null },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Ad Specialist/i);
  });

  it('will not assign without an Ad Specialist', () => {
    const r = evaluate({
      from: 'AWAITING_AM_ASSIGNMENT',
      to: 'AM_ASSIGNED',
      ...god,
      provided: { ...complete, adSpecialistId: null },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Ad Specialist/i);
  });

  it.each([
    [null, 2500, /budget above zero/i],
    [0, 2500, /budget above zero/i],
    [250000, null, /CPL/i],
    [250000, 0, /CPL/i],
  ])('refuses assignment with budget=%s cpl=%s', (budget, requiredCpl, expected) => {
    // The money is settled at assignment now, so this is where the figures
    // are demanded — not after the copy has already been written.
    const r = evaluate({
      from: 'AWAITING_AM_ASSIGNMENT',
      to: 'AM_ASSIGNED',
      ...god,
      provided: { ...complete, budget, requiredCpl },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(expected);
  });

  it('will not go live with no campaign at all', () => {
    const r = evaluate({
      from: 'REVIEW_APPROVED',
      to: 'LIVE',
      ...god,
      provided: { ...complete, linkedCampaignId: '', linkedCampaignCount: 0 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/link at least one/i);
  });

  it('goes live on linked campaigns with no typed id', () => {
    // Picking campaigns from the list is how they are linked now; the
    // hand-typed id is only the fallback for a request that predates it.
    const r = evaluate({
      from: 'REVIEW_APPROVED',
      to: 'LIVE',
      ...god,
      provided: { ...complete, linkedCampaignId: '', linkedCampaignCount: 3 },
    });
    expect(r.ok).toBe(true);
  });

  it('still goes live on the legacy typed id alone', () => {
    const r = evaluate({
      from: 'REVIEW_APPROVED',
      to: 'LIVE',
      ...god,
      provided: { ...complete, linkedCampaignId: '21345678901', linkedCampaignCount: 0 },
    });
    expect(r.ok).toBe(true);
  });

  it('refuses a rejection with no reason', () => {
    const r = evaluate({
      from: 'SUBMITTED',
      to: 'REJECTED',
      ...god,
      provided: { ...complete, reason: '' },
    });
    expect(r.ok).toBe(false);
  });
});

describe('illegal moves', () => {
  it('refuses every pair the table does not declare', () => {
    const legal = new Set(TRANSITIONS.flatMap((t) => t.from.map((f) => `${f}->${t.to}`)));
    const refused: string[] = [];
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (legal.has(`${from}->${to}`)) continue;
        const r = move(from, to);
        if (r.ok) refused.push(`${from}->${to} was allowed but is not in the table`);
        else if (r.code !== 'ILLEGAL') refused.push(`${from}->${to} refused as ${r.code}`);
      }
    }
    expect(refused).toEqual([]);
  });

  it.each([
    ['DRAFT', 'LIVE'],
    ['DRAFT', 'COMPLETED'],
    ['SUBMITTED', 'BUDGET_APPROVED'],
    ['UNDER_REVIEW', 'LIVE'],
    ['AWAITING_AM_ASSIGNMENT', 'LIVE'],
    ['COMPLETED', 'LIVE'],
    ['REJECTED', 'COMPLETED'],
    ['LIVE', 'UNDER_REVIEW'],
  ] as Array<[AdRequestStatus, AdRequestStatus]>)('refuses %s → %s', (from, to) => {
    const r = move(from, to);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ILLEGAL');
  });

  it('refuses launching before the review has passed', () => {
    expect(move('AWAITING_AD_SUBMISSION', 'LIVE').ok).toBe(false);
    expect(move('UNDER_REVIEW', 'LIVE').ok).toBe(false);
  });

  it('still lets a request stranded in a retired state reach live', () => {
    // Nothing moves *to* these any more, but AR-0002 and AR-0004 were
    // already sitting in them when the flow changed.
    expect(move('BUDGET_APPROVED', 'LIVE').ok).toBe(true);
    expect(move('ACCOUNT_ASSIGNED', 'LIVE').ok).toBe(true);
  });

  it('cannot move out of a terminal state', () => {
    for (const to of ALL_STATUSES) {
      expect(move('COMPLETED', to).ok).toBe(false);
      expect(move('REJECTED', to).ok, `REJECTED → ${to}`).toBe(
        // Re-submitting a rejected request is the one way back.
        to === 'SUBMITTED'
      );
    }
  });
});

describe('authorisation', () => {
  it('refuses a transition the actor lacks the permission for', () => {
    const r = evaluate({
      from: 'UNDER_REVIEW',
      to: 'REVIEW_APPROVED',
      isOwner: false,
      isSuperAdmin: false,
      hasPermission: () => false,
      provided: complete,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('FORBIDDEN');
      expect(r.message).toMatch(/AD_REQUESTS:APPROVE/);
    }
  });

  it('refuses someone else submitting a request they did not raise', () => {
    const r = evaluate({
      from: 'DRAFT',
      to: 'SUBMITTED',
      isOwner: false,
      isSuperAdmin: false,
      hasPermission: () => true,
      provided: complete,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FORBIDDEN');
  });

  it('lets a Super Admin past the owner check but still records the rule', () => {
    const r = evaluate({
      from: 'DRAFT',
      to: 'SUBMITTED',
      isOwner: false,
      isSuperAdmin: true,
      hasPermission: () => false,
      provided: complete,
    });
    expect(r.ok).toBe(true);
  });

  it('checks permissions before requirements, so the message is the useful one', () => {
    // Someone with no rights should be told that, not told to type a reason.
    const r = evaluate({
      from: 'UNDER_REVIEW',
      to: 'RECHECK_REQUESTED',
      isOwner: false,
      isSuperAdmin: false,
      hasPermission: () => false,
      provided: { ...complete, reason: '' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FORBIDDEN');
  });
});

describe('the specialist queue', () => {
  it('holds exactly the states waiting on the Ad Specialist', () => {
    expect(SPECIALIST_QUEUE.sort()).toEqual(
      [
        'AWAITING_AD_SUBMISSION',
        'RECHECK_REQUESTED',
        'REVIEW_APPROVED',
        'LIVE',
        // Retired, but a request can still be waiting in one.
        'BUDGET_APPROVED',
        'ACCOUNT_ASSIGNED',
      ].sort()
    );
  });
});
