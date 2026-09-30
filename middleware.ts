import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

/**
 * Route-level access control.
 *
 * Two jobs: keep signed-out users off the dashboard, and hold a user with a
 * pending password change on /change-password until it's done.
 *
 * Per-module access is deliberately NOT decided here. The permission matrix is
 * stored in the database and roles are created at runtime, so a static route
 * map like Counselling CRM's would go stale the moment someone toggles a
 * switch — and middleware runs on the edge, where a Prisma query isn't
 * available. Each page and every API route resolves the live matrix instead.
 */
export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const { pathname } = req.nextUrl;

    if (!token) return NextResponse.redirect(new URL('/login', req.url));

    const changingPassword = pathname.startsWith('/change-password');

    // A seeded or admin-reset password is known to someone other than its
    // owner, so nothing else in the app opens until it's replaced.
    if (token.mustChangePassword && !changingPassword) {
      return NextResponse.redirect(new URL('/change-password', req.url));
    }
    if (!token.mustChangePassword && changingPassword) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      // A token flagged `invalidated` belongs to a user deactivated
      // mid-session — treat it as logged out.
      authorized: ({ token }) => !!token && !token.invalidated,
    },
  }
);

export const config = {
  matcher: ['/dashboard/:path*', '/change-password'],
};
