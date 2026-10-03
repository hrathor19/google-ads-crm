-- AlterEnum
-- Pointing a request at a Google Ads account is its own decision: it is what
-- makes the request measurable, and it is restricted to the people who staff
-- the work. Recording it as REQUEST_STATUS_CHANGED would file it under
-- something that did not happen.
ALTER TYPE "CrmAuditAction" ADD VALUE 'REQUEST_ACCOUNT_CHANGED';
