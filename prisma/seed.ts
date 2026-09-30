/**
 * Seeds the four default roles, their permission matrices, and the Super Admin.
 *
 * Idempotent and non-destructive: roles and toggles that already exist are left
 * alone, because re-running the seed after someone has tuned the matrix in the
 * UI must not silently revert their work. Only genuinely missing rows are added.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { SEED_ROLES, ALL_FEATURES } from '../lib/rbac/features';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding roles…');

  for (const def of SEED_ROLES) {
    const role = await prisma.crmRole.upsert({
      where: { slug: def.slug },
      create: {
        slug: def.slug,
        name: def.name,
        description: def.description,
        isSystem: true,
        isSuperAdmin: def.isSuperAdmin ?? false,
        allAccounts: true,
      },
      // Only the description is refreshed. Renaming a role someone has already
      // assigned, or flipping its Super Admin bit, would be a surprise.
      update: { description: def.description, isSystem: true },
    });

    if (def.isSuperAdmin) {
      console.log(`  ${def.name}: bypasses the matrix`);
      continue;
    }

    const granted = new Set(def.features);
    const existing = await prisma.crmRolePermission.findMany({
      where: { roleId: role.id },
      select: { feature: true },
    });
    const have = new Set(existing.map((p) => p.feature));
    const missing = ALL_FEATURES.filter((f) => !have.has(f));

    if (missing.length) {
      await prisma.crmRolePermission.createMany({
        data: missing.map((feature) => ({
          roleId: role.id,
          feature,
          allowed: granted.has(feature),
        })),
        skipDuplicates: true,
      });
    }
    console.log(`  ${def.name}: ${granted.size} granted, ${missing.length} row(s) written`);
  }

  // ─── Super Admin user ──────────────────────────────────────────────────────

  const email = (process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';

  if (!email || !password) {
    console.warn(
      '\nSEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are not set — skipping the Super Admin.'
    );
    return;
  }

  const superAdminRole = await prisma.crmRole.findUniqueOrThrow({
    where: { slug: 'super-admin' },
  });

  const existing = await prisma.crmUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`\nSuper Admin ${email} already exists — left untouched.`);
    return;
  }

  await prisma.crmUser.create({
    data: {
      email,
      name: 'Super Admin',
      password: await bcrypt.hash(password, 12),
      roleId: superAdminRole.id,
      isActive: true,
      // The seeded password is in a file on disk and in the shell history of
      // whoever ran this; it must not survive the first login.
      mustChangePassword: true,
      allAccounts: true,
    },
  });

  console.log(`\nSuper Admin created: ${email}`);
  console.log('You will be asked to change the password on first login.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
