import { handle, prisma, requireUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** The account switcher's list — ids and names only, no metrics. */
export async function GET() {
  return handle(async () => {
    const principal = await requireUser();
    const accounts = await prisma.accounts.findMany({
      where: {
        is_manager: false,
        ...(principal.allowedAccountIds === null
          ? {}
          : { id: { in: principal.allowedAccountIds } }),
      },
      select: { id: true, descriptive_name: true, customer_id: true, currency_code: true },
      orderBy: [{ descriptive_name: 'asc' }, { customer_id: 'asc' }],
    });
    return {
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.descriptive_name,
        customerId: a.customer_id,
        currency: a.currency_code,
      })),
    };
  });
}
