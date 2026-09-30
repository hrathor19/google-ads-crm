import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { grantedFeatures, resolveAllowedAccountIds } from '@/lib/rbac/permissions';
import { PermissionProvider } from '@/components/providers/permission-provider';
import { FiltersProvider } from '@/components/providers/filters-provider';
import { DashboardShell } from '@/components/shell/dashboard-shell';

/**
 * The authenticated shell.
 *
 * Permissions are resolved once here, server-side, and handed to the client as
 * a flat list. That keeps every page from re-querying the matrix, and it is
 * strictly a rendering aid — the API routes resolve the same matrix again on
 * each request.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.crmUser.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      allAccounts: true,
      isActive: true,
      roleId: true,
      role: { select: { name: true, slug: true, isSuperAdmin: true } },
    },
  });
  if (!user || !user.isActive) redirect('/login');

  const allowedAccountIds = await resolveAllowedAccountIds(user.id);
  const features = await grantedFeatures({
    userId: user.id,
    email: user.email,
    roleId: user.roleId,
    roleSlug: user.role.slug,
    roleName: user.role.name,
    isSuperAdmin: user.role.isSuperAdmin,
    allowedAccountIds,
    mustChangePassword: false,
  });

  return (
    <PermissionProvider
      user={{
        id: user.id,
        email: user.email,
        name: user.name,
        roleName: user.role.name,
        roleSlug: user.role.slug,
        isSuperAdmin: user.role.isSuperAdmin,
        allAccounts: user.allAccounts,
        allowedAccountIds,
      }}
      features={features}
    >
      <FiltersProvider>
        <DashboardShell>{children}</DashboardShell>
      </FiltersProvider>
    </PermissionProvider>
  );
}
