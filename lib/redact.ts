import 'server-only';
import { hasPermission, type Principal } from './rbac/permissions';

/**
 * Financial redaction.
 *
 * "View Spend/Financial Data" is a permission in its own right, so a role can
 * see campaign structure and traffic without seeing money. The stripping
 * happens on the server before serialisation — a role without the toggle never
 * receives the figures, so no amount of DevTools recovers them.
 */
const MONEY_KEYS = ['cost', 'avgCpc', 'costPerConversion', 'budget', 'amount', 'spend'] as const;

export type MoneyRedactable = Record<string, unknown>;

export function stripMoney<T extends MoneyRedactable>(row: T): T {
  const out = { ...row };
  for (const key of MONEY_KEYS) {
    if (key in out) (out as Record<string, unknown>)[key] = null;
  }
  return out;
}

export async function canSeeFinancials(principal: Principal): Promise<boolean> {
  return hasPermission(principal, 'FINANCIALS:VIEW');
}

/** Apply redaction to a list only when the principal lacks the permission. */
export async function redactRows<T extends MoneyRedactable>(
  principal: Principal,
  rows: T[]
): Promise<{ rows: T[]; canSeeMoney: boolean }> {
  const canSeeMoney = await canSeeFinancials(principal);
  return { rows: canSeeMoney ? rows : rows.map(stripMoney), canSeeMoney };
}
