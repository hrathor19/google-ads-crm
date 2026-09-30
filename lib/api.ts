import 'server-only';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ZodError, type ZodSchema } from 'zod';
import { authOptions } from './auth';
import { prisma } from './prisma';
import { resolveAllowedAccountIds, hasPermission, type Principal } from './rbac/permissions';
import type { Action } from './rbac/features';

/**
 * Server-side guards for route handlers.
 *
 * Every API route starts with `requirePermission(...)`. Hiding a menu item is a
 * convenience for the user; this is the thing that actually stops a request, so
 * no handler is allowed to rely on the UI having hidden its button.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const unauthorized = (msg = 'Not signed in.') => new ApiError(401, msg);
export const forbidden = (msg = 'You do not have permission to do that.') => new ApiError(403, msg);
export const badRequest = (msg: string, detail?: unknown) => new ApiError(400, msg, detail);
export const notFound = (msg = 'Not found.') => new ApiError(404, msg);
export const conflict = (msg: string) => new ApiError(409, msg);

/** Resolve the signed-in user into a Principal, or throw 401. */
export async function requireUser(): Promise<Principal> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw unauthorized();

  const allowedAccountIds = await resolveAllowedAccountIds(session.user.id);

  return {
    userId: session.user.id,
    email: session.user.email,
    roleId: session.user.roleId,
    roleSlug: session.user.roleSlug,
    roleName: session.user.roleName,
    isSuperAdmin: session.user.isSuperAdmin,
    allowedAccountIds,
    mustChangePassword: session.user.mustChangePassword,
  };
}

/** Resolve the user and assert one `MODULE:ACTION` permission, or throw. */
export async function requirePermission(module: string, action: Action): Promise<Principal> {
  const principal = await requireUser();
  const ok = await hasPermission(principal, `${module}:${action}`);
  if (!ok) throw forbidden(`Requires the "${module}: ${action}" permission.`);
  return principal;
}

/** Assert any one of several permissions — used where two roles reach the same screen. */
export async function requireAnyPermission(
  pairs: Array<[string, Action]>
): Promise<Principal> {
  const principal = await requireUser();
  for (const [module, action] of pairs) {
    if (await hasPermission(principal, `${module}:${action}`)) return principal;
  }
  throw forbidden();
}

export async function requireSuperAdmin(): Promise<Principal> {
  const principal = await requireUser();
  if (!principal.isSuperAdmin) throw forbidden('Super Admin only.');
  return principal;
}

/**
 * Wraps a handler so thrown ApiErrors become clean JSON and anything else
 * becomes a 500 without leaking a stack trace to the client.
 */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: err.message, detail: err.detail ?? null },
        { status: err.status }
      );
    }
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'Invalid request.', detail: err.flatten() },
        { status: 400 }
      );
    }
    console.error('[api] unhandled error', err);
    return NextResponse.json({ error: 'Something went wrong on our side.' }, { status: 500 });
  }
}

/** Parse and validate a JSON body, throwing a 400 with field errors on failure. */
export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw badRequest('Invalid request.', result.error.flatten());
  return result.data;
}

/** Parse and validate query string params. */
export function parseQuery<T>(req: Request, schema: ZodSchema<T>): T {
  const url = new URL(req.url);
  const obj = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(obj);
  if (!result.success) throw badRequest('Invalid query parameters.', result.error.flatten());
  return result.data;
}

/**
 * Narrow a requested account id to what the principal may read.
 *
 * Returns the id when allowed, `null` for "all accounts" when the principal is
 * unrestricted, and throws 403 otherwise. A scoped principal asking for "all"
 * gets their own list back rather than an error, so the dashboard still works
 * for them — it just shows less.
 */
export function scopeAccountId(
  principal: Principal,
  requested: number | null
): { accountId: number | null; accountIds: number[] | null } {
  if (principal.allowedAccountIds === null) {
    return { accountId: requested, accountIds: null };
  }
  if (requested === null) {
    return { accountId: null, accountIds: principal.allowedAccountIds };
  }
  if (!principal.allowedAccountIds.includes(requested)) {
    throw forbidden('That account is not in your assigned scope.');
  }
  return { accountId: requested, accountIds: [requested] };
}

/** The client IP, honouring the proxy headers a deploy puts in front of us. */
export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip');
}

export { prisma };
