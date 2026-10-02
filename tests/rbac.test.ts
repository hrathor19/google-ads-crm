import { describe, expect, it } from 'vitest';
import {
  MODULES,
  ACTIONS,
  ALL_FEATURES,
  SEED_ROLES,
  feature,
  isValidFeature,
} from '@/lib/rbac/features';
import { accountScopeWhere, canAccessAccount, type Principal } from '@/lib/rbac/permissions';

/**
 * The permission catalogue and the account-scope helpers.
 *
 * The scope helpers matter most: their failure mode is silent — a wrong
 * fallback returns *more* data rather than throwing — so the empty-list case
 * is pinned explicitly.
 */

const principal = (over: Partial<Principal> = {}): Principal => ({
  userId: 'u1',
  email: 'u@example.com',
  roleId: 'r1',
  roleSlug: 'operations',
  roleName: 'Operations',
  isSuperAdmin: false,
  allowedAccountIds: null,
  mustChangePassword: false,
  ...over,
});

describe('the permission catalogue', () => {
  it('every module declares at least a VIEW action', () => {
    for (const m of MODULES) {
      expect(m.actions.length).toBeGreaterThan(0);
      expect(m.actions).toContain('VIEW');
    }
  });

  it('feature strings are unique', () => {
    expect(new Set(ALL_FEATURES).size).toBe(ALL_FEATURES.length);
  });

  it('only declared module/action pairs validate', () => {
    expect(isValidFeature(feature('DASHBOARD', 'VIEW'))).toBe(true);
    expect(isValidFeature('DASHBOARD:MANAGE')).toBe(false); // not declared on that module
    expect(isValidFeature('NOT_A_MODULE:VIEW')).toBe(false);
    expect(isValidFeature('DASHBOARD')).toBe(false);
  });

  it('every action in the catalogue is a declared action', () => {
    for (const f of ALL_FEATURES) {
      const action = f.split(':')[1]!;
      expect(ACTIONS).toContain(action as (typeof ACTIONS)[number]);
    }
  });
});

describe('the seeded roles', () => {
  it('has exactly one Super Admin', () => {
    expect(SEED_ROLES.filter((r) => r.isSuperAdmin)).toHaveLength(1);
  });

  it('gives every seeded role a unique slug', () => {
    const slugs = SEED_ROLES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('only grants features that exist', () => {
    for (const role of SEED_ROLES) {
      for (const f of role.features) {
        expect(isValidFeature(f), `${role.slug} grants unknown feature ${f}`).toBe(true);
      }
    }
  });

  it('withholds financial data from Operations', () => {
    const ops = SEED_ROLES.find((r) => r.slug === 'operations')!;
    expect(ops.features).not.toContain('FINANCIALS:VIEW');
    expect(ops.features).not.toContain('FINANCIALS:EXPORT');
  });

  it('withholds user and role management from everyone but the Super Admin', () => {
    for (const role of SEED_ROLES.filter((r) => !r.isSuperAdmin)) {
      expect(role.features).not.toContain('USERS:MANAGE');
      expect(role.features).not.toContain('ROLES:MANAGE');
    }
  });

  it('lets Manager and Operations sign off the ad copy', () => {
    // Steps 7 and 9 — the recheck and the review approval.
    const approvers = SEED_ROLES.filter(
      (r) => !r.isSuperAdmin && r.features.includes('AD_REQUESTS:APPROVE')
    );
    expect(approvers.map((r) => r.slug).sort()).toEqual(['manager', 'operations']);
  });

  it('gives only the Ads team the power to build and launch', () => {
    // Steps 5, 12 and 13. Separate from EDIT, which Ops needs for its own
    // drafts, so the Ad Specialist picker lists only people who do the work.
    const builders = SEED_ROLES.filter(
      (r) => !r.isSuperAdmin && r.features.includes('AD_REQUESTS:BUILD')
    );
    expect(builders.map((r) => r.slug)).toEqual(['google-ads-team']);

    for (const slug of ['operations', 'manager', 'account-manager']) {
      const role = SEED_ROLES.find((r) => r.slug === slug)!;
      expect(role.features, `${slug} should not build`).not.toContain('AD_REQUESTS:BUILD');
    }
  });

  it('keeps the budget away from the people who raise requests', () => {
    // Step 10 is its own permission precisely so Ops can approve the copy
    // without being able to commit the spend.
    const budgetHolders = SEED_ROLES.filter(
      (r) => !r.isSuperAdmin && r.features.includes('AD_REQUESTS:BUDGET')
    );
    expect(budgetHolders.map((r) => r.slug)).toEqual(['manager']);

    const ops = SEED_ROLES.find((r) => r.slug === 'operations')!;
    expect(ops.features).not.toContain('AD_REQUESTS:BUDGET');
  });

  it('gives only the Manager the power to assign people', () => {
    // Steps 3 and 11. Ops raises the requirement; a Manager decides who
    // staffs it. Neither the Account Manager nor the Ad Specialist can
    // reassign the work to themselves.
    const assigners = SEED_ROLES.filter(
      (r) => !r.isSuperAdmin && r.features.includes('AD_REQUESTS:ASSIGN')
    );
    expect(assigners.map((r) => r.slug)).toEqual(['manager']);

    for (const slug of ['operations', 'account-manager', 'google-ads-team']) {
      const role = SEED_ROLES.find((r) => r.slug === slug)!;
      expect(role.features, `${slug} should not assign`).not.toContain('AD_REQUESTS:ASSIGN');
    }
  });

  it('gives the Account Manager read access and no power to move the request', () => {
    const am = SEED_ROLES.find((r) => r.slug === 'account-manager')!;
    expect(am.features).toContain('AD_REQUESTS:VIEW');
    for (const f of ['AD_REQUESTS:APPROVE', 'AD_REQUESTS:ASSIGN', 'AD_REQUESTS:EDIT']) {
      expect(am.features, `AM should not hold ${f}`).not.toContain(f);
    }
  });

  it('gives the Ads team the AI permissions and Operations none of them', () => {
    const ads = SEED_ROLES.find((r) => r.slug === 'google-ads-team')!;
    const ops = SEED_ROLES.find((r) => r.slug === 'operations')!;
    expect(ads.features).toContain('AD_COPY:GENERATE_AI');
    expect(ads.features).toContain('LANDING_SCORE:GENERATE_AI');
    expect(ops.features).not.toContain('AD_COPY:GENERATE_AI');
    expect(ops.features).not.toContain('LANDING_SCORE:GENERATE_AI');
  });
});

describe('account scoping', () => {
  it('is unrestricted when the allow-list is null', () => {
    expect(accountScopeWhere(principal({ allowedAccountIds: null }))).toEqual({});
    expect(canAccessAccount(principal({ allowedAccountIds: null }), 42)).toBe(true);
  });

  it('narrows to the listed accounts', () => {
    const p = principal({ allowedAccountIds: [1, 2] });
    expect(accountScopeWhere(p)).toEqual({ id: { in: [1, 2] } });
    expect(canAccessAccount(p, 1)).toBe(true);
    expect(canAccessAccount(p, 3)).toBe(false);
  });

  it('returns nothing — not everything — for an empty allow-list', () => {
    // The dangerous failure here is an empty `where`, which would return every
    // row to a principal entitled to none.
    const p = principal({ allowedAccountIds: [] });
    expect(accountScopeWhere(p)).toEqual({ id: { in: [] } });
    expect(canAccessAccount(p, 1)).toBe(false);
  });

  it('refuses "all accounts" for a scoped principal', () => {
    expect(canAccessAccount(principal({ allowedAccountIds: [1] }), null)).toBe(false);
  });

  it('targets the column the caller names', () => {
    const p = principal({ allowedAccountIds: [7] });
    expect(accountScopeWhere(p, 'account_id')).toEqual({ account_id: { in: [7] } });
  });
});
