-- Migration histórica aplicada antes da decisão final de exclusão física.
-- Mantida no histórico porque migrations aplicadas nunca devem ser removidas.
ALTER TABLE "operations"
ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

CREATE INDEX "operations_deleted_created_idx"
ON "operations"("deleted_at", "created_at");
