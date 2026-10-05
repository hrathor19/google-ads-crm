import type { NextAuthOptions, Session } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { getLockoutRemaining, recordFailedLogin, clearFailedLogins } from './login-rate-limit';
import { env } from './env';

/**
 * Auth follows Counselling CRM's pattern exactly: NextAuth v4 credentials
 * provider, JWT sessions, bcrypt hashes, in-memory login lockout, and a
 * periodic re-check of the live token against the DB.
 *
 * The one addition is the role *table*: a JWT carries the role id and slug, and
 * the revalidation pass refreshes them, so deactivating a user, moving them to
 * another role, or flipping a permission all take effect within
 * TOKEN_REVALIDATE_SECONDS rather than at the end of the 24h token.
 */

// How often (seconds) a live JWT is re-checked against the DB.
const TOKEN_REVALIDATE_SECONDS = 5 * 60;

/**
 * Whether an address may sign in with Google at all.
 *
 * Checked on the server, in the `signIn` callback, because the Google
 * consent screen's own domain restriction is a setting in somebody else's
 * console — if it is ever switched from Internal to External, this is what
 * still refuses a personal gmail account.
 *
 * An empty allowlist means no domain restriction, which is the right
 * reading of "not configured" for a self-hosted install; it is not the
 * configuration here.
 */
export function isAllowedDomain(email: string): boolean {
  const domains = env.auth().allowedDomains;
  if (domains.length === 0) return true;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return domains.includes(domain);
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email.trim().toLowerCase();

        const lockoutSeconds = getLockoutRemaining(email);
        if (lockoutSeconds !== null) {
          throw new Error(
            `Too many failed attempts. Try again in ${Math.ceil(lockoutSeconds / 60)} minute(s).`
          );
        }

        const user = await prisma.crmUser.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            password: true,
            isActive: true,
            mustChangePassword: true,
            roleId: true,
            role: { select: { slug: true, name: true, isSuperAdmin: true } },
          },
        });

        if (!user || !user.isActive) {
          recordFailedLogin(email);
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) {
          recordFailedLogin(email);
          return null;
        }

        clearFailedLogins(email);

        // Recorded here rather than in an event callback so it lands on the one
        // path that actually proves a correct password.
        await prisma.crmUser.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          roleId: user.roleId,
          roleSlug: user.role.slug,
          roleName: user.role.name,
          isSuperAdmin: user.role.isSuperAdmin,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),

    /**
     * Google sign-in.
     *
     * Deliberately no NextAuth adapter and no account linking: identity
     * comes from Google, but *authorisation* comes from the `crm_users` row
     * this app already has. An employee with a valid company address and no
     * user record is refused rather than created, because a role here
     * decides who can see client spend and who can commit a budget — that
     * is a decision somebody makes, not a side effect of logging in.
     */
    ...(env.auth().googleClientId && env.auth().googleClientSecret
      ? [
          GoogleProvider({
            clientId: env.auth().googleClientId,
            clientSecret: env.auth().googleClientSecret,
            allowDangerousEmailAccountLinking: false,
            authorization: {
              params: {
                // Lets Google filter the account chooser to the workspace;
                // it is a convenience, never the check.
                hd: env.auth().allowedDomains[0] ?? undefined,
                prompt: 'select_account',
              },
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    /**
     * The gate for Google sign-in. Credentials have already been checked by
     * `authorize`, so this only has to rule on the OAuth path.
     */
    async signIn({ user, account }) {
      if (account?.provider !== 'google') return true;

      const email = user.email?.trim().toLowerCase();
      if (!email) return '/login?error=NoEmail';
      if (!isAllowedDomain(email)) return '/login?error=Domain';

      const dbUser = await prisma.crmUser.findUnique({
        where: { email },
        select: { id: true, isActive: true },
      });
      if (!dbUser) return '/login?error=NoAccount';
      if (!dbUser.isActive) return '/login?error=Deactivated';

      await prisma.crmUser.update({
        where: { id: dbUser.id },
        data: { lastLoginAt: new Date() },
      });
      return true;
    },

    async jwt({ token, user, trigger, account }) {
      const nowSeconds = Math.floor(Date.now() / 1000);

      // Google hands back a profile, not a role. Everything this app gates
      // on lives in `crm_users`, so the first thing a Google session does is
      // look itself up — otherwise it would arrive authenticated with no
      // permissions at all and every page would read as broken.
      if (account?.provider === 'google' && user?.email) {
        const dbUser = await prisma.crmUser.findUnique({
          where: { email: user.email.trim().toLowerCase() },
          select: {
            id: true,
            mustChangePassword: true,
            roleId: true,
            role: { select: { slug: true, name: true, isSuperAdmin: true } },
          },
        });
        if (!dbUser) {
          token.invalidated = true;
          return token;
        }
        token.id = dbUser.id;
        token.roleId = dbUser.roleId;
        token.roleSlug = dbUser.role.slug;
        token.roleName = dbUser.role.name;
        token.isSuperAdmin = dbUser.role.isSuperAdmin;
        // Never gate a Google session on a password change: they have no
        // password to change, and the screen would ask for a current one
        // they could not supply.
        token.mustChangePassword = false;
        token.provider = 'google';
        token.lastValidated = nowSeconds;
        return token;
      }

      // The credentials path, where `authorize` has already resolved the
      // role. The fallbacks are for the type only: this branch is reached
      // solely from `authorize`, which always returns all of them.
      if (user) {
        token.id = user.id;
        token.roleId = user.roleId ?? '';
        token.roleSlug = user.roleSlug ?? '';
        token.roleName = user.roleName ?? '';
        token.isSuperAdmin = user.isSuperAdmin ?? false;
        token.mustChangePassword = user.mustChangePassword ?? false;
        token.lastValidated = nowSeconds;
        return token;
      }

      // Periodically re-check against the DB so deactivation, role changes and
      // a completed password change propagate to live sessions. `trigger` is
      // 'update' when the client calls useSession().update() — used right after
      // a password change so the redirect gate clears immediately.
      const lastValidated = token.lastValidated ?? 0;
      if (trigger === 'update' || nowSeconds - lastValidated > TOKEN_REVALIDATE_SECONDS) {
        const dbUser = await prisma.crmUser.findUnique({
          where: { id: token.id },
          select: {
            isActive: true,
            roleId: true,
            mustChangePassword: true,
            role: { select: { slug: true, name: true, isSuperAdmin: true } },
          },
        });

        if (!dbUser || !dbUser.isActive) {
          token.invalidated = true;
        } else {
          token.roleId = dbUser.roleId;
          token.roleSlug = dbUser.role.slug;
          token.roleName = dbUser.role.name;
          token.isSuperAdmin = dbUser.role.isSuperAdmin;
          token.mustChangePassword =
            token.provider === 'google' ? false : dbUser.mustChangePassword;
          token.lastValidated = nowSeconds;
        }
      }

      return token;
    },
    async session({ session, token }) {
      // A token flagged invalidated belongs to a user deactivated mid-session —
      // return no session so getServerSession() yields null and every API route
      // responds 401.
      if (token.invalidated) return null as unknown as Session;

      if (token && session.user) {
        session.user.id = token.id;
        session.user.roleId = token.roleId;
        session.user.roleSlug = token.roleSlug;
        session.user.roleName = token.roleName;
        session.user.isSuperAdmin = token.isSuperAdmin;
        session.user.mustChangePassword = token.mustChangePassword;
      }
      return session;
    },
  },
};
