/**
 * The permission catalogue: every module × action pair the app can gate on.
 *
 * A permission is the string `"<MODULE>:<ACTION>"`. Modules and actions are
 * declared together here so the Permission Matrix UI, the API guards and the
 * seed script all read from one source — adding a row or a column to the matrix
 * is a change to this file and nothing else.
 *
 * Counselling CRM stores `(role, feature) -> canAccess` rows with a hardcoded
 * per-role fallback; this keeps that exact shape. What changes is that `Role` is
 * a table rather than a Prisma enum, because the brief requires Super Admins to
 * create, clone and delete roles at runtime.
 */

export const ACTIONS = [
  'VIEW',
  'CREATE',
  'EDIT',
  'DELETE',
  'APPROVE',
  'ASSIGN',
  'EXPORT',
  'GENERATE_AI',
  'MANAGE',
] as const;

export type Action = (typeof ACTIONS)[number];

export type ModuleDef = {
  key: string;
  label: string;
  description: string;
  actions: Action[];
};

/**
 * Order here is the order of rows in the Permission Matrix.
 */
export const MODULES: ModuleDef[] = [
  {
    key: 'DASHBOARD',
    label: 'Dashboard',
    description: 'Executive overview, KPI tiles, trend charts and alerts.',
    actions: ['VIEW', 'EXPORT'],
  },
  {
    key: 'ACCOUNTS',
    label: 'Accounts',
    description: 'Google Ads accounts under the MCC and their drill-downs.',
    actions: ['VIEW', 'EXPORT'],
  },
  {
    key: 'CAMPAIGNS',
    label: 'Campaigns & Ad Groups',
    description: 'Campaign and ad group performance, health scores.',
    actions: ['VIEW', 'EXPORT'],
  },
  {
    key: 'KEYWORDS',
    label: 'Keywords & Search Terms',
    description: 'Keyword health, Quality Score and the search term explorer.',
    actions: ['VIEW', 'EXPORT'],
  },
  {
    key: 'FINANCIALS',
    label: 'Spend & Financial Data',
    description:
      'Cost, CPC, cost/conversion, budgets. Without this, money columns are hidden everywhere.',
    actions: ['VIEW', 'EXPORT'],
  },
  {
    key: 'ANALYTICS',
    label: 'Analytics (GA4)',
    description: 'Google Analytics 4 traffic, engagement, conversions and audience reports.',
    actions: ['VIEW', 'EXPORT'],
  },
  {
    key: 'AD_REQUESTS',
    label: 'Ad Requests',
    description: 'The request workflow: raise, edit, review and progress ad requests.',
    actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'ASSIGN', 'EXPORT'],
  },
  {
    key: 'AD_COPY',
    label: 'AI Ad Copy',
    description: 'Generate, edit and finalise responsive search ad copy.',
    actions: ['VIEW', 'GENERATE_AI', 'EDIT', 'DELETE'],
  },
  {
    key: 'LANDING_SCORE',
    label: 'Landing Page Scorer',
    description: 'Score a landing page and read the improvement breakdown.',
    actions: ['VIEW', 'GENERATE_AI'],
  },
  {
    key: 'SYNC',
    label: 'Data Sync',
    description: 'Trigger a manual refresh from the Google Ads API.',
    actions: ['VIEW', 'CREATE'],
  },
  {
    key: 'USERS',
    label: 'Users',
    description: 'Create, invite, deactivate users and reset passwords.',
    actions: ['VIEW', 'MANAGE'],
  },
  {
    key: 'ROLES',
    label: 'Roles & Permissions',
    description: 'Create roles, clone them, and toggle the permission matrix.',
    actions: ['VIEW', 'MANAGE'],
  },
  {
    key: 'AUDIT',
    label: 'Audit Log',
    description: 'Who did what, and when.',
    actions: ['VIEW', 'EXPORT'],
  },
  {
    key: 'INTEGRATIONS',
    label: 'Integrations Health',
    description: 'Connection status per integration and the test-connection button.',
    actions: ['VIEW', 'MANAGE'],
  },
];

export const ACTION_LABELS: Record<Action, string> = {
  VIEW: 'View',
  CREATE: 'Create',
  EDIT: 'Edit',
  DELETE: 'Delete',
  APPROVE: 'Approve',
  ASSIGN: 'Assign people',
  EXPORT: 'Export',
  GENERATE_AI: 'Generate AI',
  MANAGE: 'Manage',
};

/** `"DASHBOARD:VIEW"` — the wire format stored in `crm_role_permissions.feature`. */
export function feature(module: string, action: Action): string {
  return `${module}:${action}`;
}

/** Every valid permission string, in matrix order. */
export const ALL_FEATURES: string[] = MODULES.flatMap((m) =>
  m.actions.map((a) => feature(m.key, a))
);

const FEATURE_SET = new Set(ALL_FEATURES);

export function isValidFeature(value: string): boolean {
  return FEATURE_SET.has(value);
}

// ─── Seeded roles ────────────────────────────────────────────────────────────

export type SeedRole = {
  slug: string;
  name: string;
  description: string;
  isSuperAdmin?: boolean;
  /** Granted features. Ignored when `isSuperAdmin` — that bypasses every check. */
  features: string[];
};

const all = (module: string) =>
  (MODULES.find((m) => m.key === module)?.actions ?? []).map((a) => feature(module, a));

const view = (...modules: string[]) => modules.map((m) => feature(m, 'VIEW'));

/**
 * The four default roles from the brief. Seeded once; a Super Admin can edit
 * their toggles afterwards, and the seed never overwrites live edits.
 */
export const SEED_ROLES: SeedRole[] = [
  {
    slug: 'super-admin',
    name: 'Super Admin',
    description: 'Unrestricted access to every module, every account and every setting.',
    isSuperAdmin: true,
    features: [],
  },
  {
    slug: 'manager',
    name: 'Manager',
    description:
      'Reviews and approves ad requests, sees all reporting including spend, cannot manage users or roles.',
    features: [
      ...view('DASHBOARD', 'ACCOUNTS', 'CAMPAIGNS', 'KEYWORDS', 'FINANCIALS', 'ANALYTICS'),
      feature('DASHBOARD', 'EXPORT'),
      feature('ACCOUNTS', 'EXPORT'),
      feature('CAMPAIGNS', 'EXPORT'),
      feature('KEYWORDS', 'EXPORT'),
      feature('FINANCIALS', 'EXPORT'),
      ...all('AD_REQUESTS'),
      feature('AD_COPY', 'VIEW'),
      feature('LANDING_SCORE', 'VIEW'),
      feature('AUDIT', 'VIEW'),
      feature('SYNC', 'VIEW'),
    ],
  },
  {
    slug: 'operations',
    name: 'Operations',
    description:
      'Raises ad requests and tracks them through approval. Reporting without financial data.',
    features: [
      ...view('DASHBOARD', 'ACCOUNTS', 'CAMPAIGNS', 'KEYWORDS'),
      feature('AD_REQUESTS', 'VIEW'),
      feature('AD_REQUESTS', 'CREATE'),
      feature('AD_REQUESTS', 'EDIT'),
      // Ops reviews the ads and applies the budget — steps 7, 9 and 10 — and
      // names the Account Manager and Ad Specialist at steps 3 and 11.
      feature('AD_REQUESTS', 'APPROVE'),
      feature('AD_REQUESTS', 'ASSIGN'),
      feature('AD_COPY', 'VIEW'),
      feature('LANDING_SCORE', 'VIEW'),
    ],
  },
  {
    slug: 'account-manager',
    name: 'Account Manager',
    description:
      'Owns the account from step 3. Sees the requirement and its progress, and the ' +
      'reporting for the accounts they are scoped to.',
    features: [
      ...view('DASHBOARD', 'ACCOUNTS', 'CAMPAIGNS', 'KEYWORDS', 'FINANCIALS'),
      feature('AD_REQUESTS', 'VIEW'),
      feature('AD_COPY', 'VIEW'),
      feature('LANDING_SCORE', 'VIEW'),
    ],
  },
  {
    slug: 'google-ads-team',
    name: 'Google Ads Team',
    description:
      'The Ad Specialist on the approval flow. Builds keywords and ad copy, fixes ' +
      'rechecks, and takes a request live.',
    features: [
      ...view('DASHBOARD', 'ACCOUNTS', 'CAMPAIGNS', 'KEYWORDS', 'FINANCIALS'),
      feature('CAMPAIGNS', 'EXPORT'),
      feature('KEYWORDS', 'EXPORT'),
      feature('AD_REQUESTS', 'VIEW'),
      feature('AD_REQUESTS', 'EDIT'),
      ...all('AD_COPY'),
      ...all('LANDING_SCORE'),
      feature('SYNC', 'VIEW'),
      feature('SYNC', 'CREATE'),
    ],
  },
];
