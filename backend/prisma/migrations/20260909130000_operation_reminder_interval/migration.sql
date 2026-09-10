-- Optional reminder preference captured while an Operation is configured.
-- Existing Operations remain NULL and continue using the established 6-month default.
ALTER TABLE "operations"
  ADD COLUMN "maintenance_reminder_interval_months" SMALLINT;

ALTER TABLE "operations"
  ADD CONSTRAINT "operations_reminder_interval_months_ck"
  CHECK (
    "maintenance_reminder_interval_months" IS NULL
    OR "maintenance_reminder_interval_months" BETWEEN 1 AND 120
  );
