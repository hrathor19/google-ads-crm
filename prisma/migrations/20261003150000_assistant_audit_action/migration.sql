-- AlterEnum
-- Every assistant question is audited. It reads real spend and real client
-- data, so "who asked what, and when" is the same question the rest of this
-- log answers — and filing it under AI_COPY_GENERATED would be a lie.
ALTER TYPE "CrmAuditAction" ADD VALUE 'ASSISTANT_QUERIED';
