-- A exclusão oficial de Operation é física. Remove a fundação provisória de
-- soft delete somente se ela nunca tiver sido utilizada, evitando perda de dados.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'operations'
      AND column_name = 'deleted_at'
  ) AND EXISTS (
    SELECT 1 FROM "operations" WHERE "deleted_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'operations.deleted_at contains data; corrective migration aborted';
  END IF;
END $$;

DROP INDEX IF EXISTS "operations_deleted_created_idx";

ALTER TABLE "operations"
DROP COLUMN IF EXISTS "deleted_at";
