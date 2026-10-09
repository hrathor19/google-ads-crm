import { describe, expect, it } from 'vitest';
import { TOOLS } from '@/lib/ai/tools';
import { MODULES, ALL_FEATURES, SEED_ROLES, isValidFeature } from '@/lib/rbac/features';

/**
 * The assistant's contract with the rest of the app.
 *
 * The model picks a tool; everything that keeps the answer inside the asker's
 * permissions is declared here rather than prompted for. A prompt can be
 * argued with — a missing tool cannot be called, and a `requires` the guard
 * reads cannot be talked around.
 */

describe('tool catalogue', () => {
  it('declares a permission for every tool that reads business data', () => {
    for (const tool of TOOLS) {
      // `data_freshness` is the sole exception: when the data was last synced
      // is not client data, and someone doubting a number must always be able
      // to check whether it is stale.
      if (tool.declaration.name === 'data_freshness') {
        expect(tool.requires).toBeNull();
        continue;
      }
      expect(tool.requires, `${tool.declaration.name} has no permission`).toBeTruthy();
    }
  });

  it('only requires permissions that exist in the matrix', () => {
    for (const tool of TOOLS) {
      if (!tool.requires) continue;
      expect(isValidFeature(tool.requires), `${tool.requires} is not a real feature`).toBe(true);
    }
  });

  it('gives every tool a name and a description the model can choose from', () => {
    for (const tool of TOOLS) {
      expect(tool.declaration.name).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
      expect((tool.declaration.description ?? '').length).toBeGreaterThan(40);
    }
  });

  it('has no duplicate tool names', () => {
    const names = TOOLS.map((t) => t.declaration.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('exposes exactly the tools that were agreed, and no others', () => {
    // Pinning the set, rather than pattern-matching names for mutating verbs:
    // a regex cannot tell `assigned_work` (reads assignments) from
    // `assign_work` (would change one), and the first version of this test
    // failed on exactly that. An exact list means adding any tool — above
    // all a writing one — forces somebody to change this test deliberately.
    expect(TOOLS.map((t) => t.declaration.name).sort()).toEqual([
      'assigned_work',
      'daily_trend',
      'data_freshness',
      'explore_search_terms',
      'find_ad_request',
      'get_totals',
      'list_accounts',
      'list_alerts',
      'list_campaigns',
      'list_keywords',
      'priority_queue',
      'segment_breakdown',
    ]);
  });
});

describe('the ASSISTANT permission', () => {
  it('is a real module with a USE action', () => {
    const mod = MODULES.find((m) => m.key === 'ASSISTANT');
    expect(mod).toBeDefined();
    expect(mod!.actions).toContain('VIEW');
    expect(ALL_FEATURES).toContain('ASSISTANT:VIEW');
  });

  it('is granted to Manager and to nobody else by default', () => {
    // Super Admin is absent from this check on purpose: it holds no feature
    // list at all and bypasses every check, so listing it would assert
    // nothing.
    const holders = SEED_ROLES.filter(
      (r) => !r.isSuperAdmin && r.features.includes('ASSISTANT:VIEW')
    ).map((r) => r.slug);
    expect(holders).toEqual(['manager']);
  });

  it('does not hand Operations a way to see spend', () => {
    // The assistant obeys FINANCIALS:VIEW through the same redaction the
    // dashboards use. This pins the premise: Operations does not hold it, so
    // there is nothing for the assistant to leak.
    const ops = SEED_ROLES.find((r) => r.slug === 'operations')!;
    expect(ops.features).not.toContain('FINANCIALS:VIEW');
    expect(ops.features).not.toContain('ASSISTANT:VIEW');
  });
});

// ─── The redaction path, against the real database ──────────────────────────

import { prisma } from '@/lib/prisma';
import { findTool, toolsFor, type ToolContext } from '@/lib/ai/tools';
import type { Principal } from '@/lib/rbac/permissions';

async function principalFor(slug: string): Promise<Principal> {
  const role = await prisma.crmRole.findUniqueOrThrow({ where: { slug } });
  return {
    userId: `test-${slug}`,
    email: `${slug}@example.com`,
    name: `Test ${slug}`,
    roleId: role.id,
    roleSlug: role.slug,
    roleName: role.name,
    isSuperAdmin: role.isSuperAdmin,
    allowedAccountIds: null,
    mustChangePassword: false,
  };
}

/**
 * The guarantee the whole design rests on: the assistant answers *as* the
 * asker. Prompting cannot change this, because the redaction happens after
 * the tool runs and before the model ever sees the rows.
 */
describe('a tool run under a principal', () => {
  it('gives a Manager the spend figures', async () => {
    const principal = await principalFor('manager');
    const ctx: ToolContext = { principal, scope: { accountIds: null }, canSeeMoney: true };
    const { data } = await findTool('get_totals')!.run({ days: 30 }, ctx);
    const { totals, window } = data as {
      totals: { cost: number | null; clicks: number };
      window: { start: string; end: string };
    };
    expect(typeof totals.clicks).toBe('number');
    expect(typeof totals.cost).toBe('number');
    // The window travels with the figures, or the model states one of its own.
    expect(window.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(window.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('withholds them from a role without FINANCIALS:VIEW', async () => {
    const principal = await principalFor('operations');
    const ctx: ToolContext = { principal, scope: { accountIds: null }, canSeeMoney: false };
    const { data } = await findTool('get_totals')!.run({ days: 30 }, ctx);
    const { totals } = data as {
      totals: { cost: number | null; avgCpc: number | null; clicks: number };
    };
    // Traffic yes, money no — the same split the dashboards apply.
    expect(typeof totals.clicks).toBe('number');
    expect(totals.cost).toBeNull();
    expect(totals.avgCpc).toBeNull();
  });

  it('resolves ASSISTANT:VIEW to exactly Super Admin and Manager on the live roles', async () => {
    // The seed list is the declared intent; this is what the database
    // actually answers, including the fallback for roles whose permission
    // rows predate the module. Those two differ the moment somebody edits
    // the matrix, and the second one is what the guard reads.
    const { hasPermission } = await import('@/lib/rbac/permissions');
    const got: Record<string, boolean> = {};
    for (const slug of ['super-admin', 'manager', 'operations', 'google-ads-team']) {
      const role = await prisma.crmRole.findUnique({ where: { slug } });
      if (!role) continue;
      got[slug] = await hasPermission(await principalFor(slug), 'ASSISTANT:VIEW');
    }
    expect(got).toEqual({
      'super-admin': true,
      manager: true,
      operations: false,
      'google-ads-team': false,
    });
  });

  it('builds the menu from module permissions, not from the role name', async () => {
    const names = (t: Awaited<ReturnType<typeof toolsFor>>) => t.map((x) => x.declaration.name).sort();
    const manager = await toolsFor(await principalFor('manager'));
    const ops = await toolsFor(await principalFor('operations'));
    // Both see the same menu, and that is correct: Operations holds every
    // VIEW the tools require. What separates these two roles is FINANCIALS,
    // which is why redaction lives inside each tool and not in the menu —
    // gating the menu alone would have let Operations read spend.
    expect(names(ops)).toEqual(names(manager));
    expect(names(manager)).toContain('list_accounts');
  });

  it('hides every tool from a role granted nothing', async () => {
    // A custom role starts with no permissions, and `getRolePermissions`
    // only falls back to a seeded default for a slug it knows — so this also
    // pins that an unknown slug defaults closed, not open.
    const role = await prisma.crmRole.create({
      data: { slug: 'vitest-empty-role', name: 'Vitest Empty Role', description: 'temp' },
    });
    try {
      const tools = await toolsFor({
        userId: 'test-empty',
        email: 'empty@example.com',
        name: 'Test Empty',
        roleId: role.id,
        roleSlug: role.slug,
        roleName: role.name,
        isSuperAdmin: false,
        allowedAccountIds: null,
        mustChangePassword: false,
      });
      // Only the one tool that deliberately requires nothing: whether the
      // data is stale is not client data.
      expect(tools.map((t) => t.declaration.name)).toEqual(['data_freshness']);
    } finally {
      await prisma.crmRole.delete({ where: { id: role.id } });
    }
  });

  it('refuses an ambiguous account rather than picking one', async () => {
    const principal = await principalFor('manager');
    const ctx: ToolContext = { principal, scope: { accountIds: null }, canSeeMoney: true };
    // "KAPP Online" matches ten accounts on this MCC. Choosing one would put
    // the wrong client's spend in front of somebody.
    const { data } = await findTool('get_totals')!.run({ account: 'KAPP Online' }, ctx);
    expect((data as { error?: string }).error).toMatch(/matches \d+ accounts/i);
  });

  it('says so when an account does not exist', async () => {
    const principal = await principalFor('manager');
    const ctx: ToolContext = { principal, scope: { accountIds: null }, canSeeMoney: true };
    const { data } = await findTool('get_totals')!.run({ account: 'Nonexistent Ltd' }, ctx);
    expect((data as { error?: string }).error).toMatch(/no account matches/i);
  });
});
