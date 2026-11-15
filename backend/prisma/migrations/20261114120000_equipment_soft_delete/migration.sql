-- Keep references from operations, budgets and maintenance history intact.
ALTER TABLE "equipments" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
