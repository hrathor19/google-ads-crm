-- AlterEnum
-- Every keyword search is audited. Each one spends an operation from the same
-- daily API quota the nightly sync draws on, so when the sync starts failing
-- on quota this log is where the answer is — and DATA_EXPORTED, the nearest
-- existing value, describes data leaving rather than quota being spent.
ALTER TYPE "CrmAuditAction" ADD VALUE 'KEYWORDS_RESEARCHED';
