-- The 14 HQ roles from the client's org chart (owner-approved 2026-08-27): twelve head-office
-- roles above the branch trio, and driver / field_ops below employee. All of them are chain-wide
-- and branch-less like super_admin; the location rule moves in 0033.
--
-- Each head-office value is added BEFORE 'admin' in ladder order, so successive inserts stack up
-- in declared order just above the branch trio and the enum keeps reading as the seniority
-- ladder. Nothing sorts on the column today, but an enum's order is fixed at creation and
-- re-cutting it later means rewriting the type, so it is worth getting right once (0017).
--
-- Postgres allows ADD VALUE inside a transaction from 12 onward as long as the new value is not
-- used in the same transaction, which is why this file only declares and seeds nothing.
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'ceo' BEFORE 'admin';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'chain_manager' BEFORE 'admin';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'finance_manager' BEFORE 'admin';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'operations_manager' BEFORE 'admin';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'procurement_manager' BEFORE 'admin';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'marketing_manager' BEFORE 'admin';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'brand_manager' BEFORE 'admin';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'setup_manager' BEFORE 'admin';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'chain_chef' BEFORE 'admin';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'office_manager' BEFORE 'admin';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'hq_secretary' BEFORE 'admin';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'bookkeeper' BEFORE 'admin';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'driver' AFTER 'employee';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'field_ops' AFTER 'driver';
