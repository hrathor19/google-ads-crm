import type { NextAuthOptions, Session } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { getLockoutRemaining, recordFailedLogin, clearFailedLogins } from './login-rate-limit';

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
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      const nowSeconds = Math.floor(Date.now() / 1000);

      if (user) {
        token.id = user.id;
        token.roleId = user.roleId;
        token.roleSlug = user.roleSlug;
        token.roleName = user.roleName;
        token.isSuperAdmin = user.isSuperAdmin;
        token.mustChangePassword = user.mustChangePassword;
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
          token.mustChangePassword = dbUser.mustChangePassword;
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
