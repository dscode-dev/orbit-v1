-- Exclusão de atendimentos e documentos passa a ser LÓGICA.
--
-- A exclusão definitiva apagava o registro e prejudicava a auditoria. Agora o
-- OWNER "exclui" preenchendo `deleted_at`/`deleted_by_id`: o item sai das
-- listas, continua na base e pode ser restaurado. Em atendimentos,
-- `deletion_snapshot` guarda o que foi estornado na exclusão (estoque,
-- financeiro, comissões, atribuições, lembrete, documentos) para a restauração
-- desfazer exatamente isso.
--
-- Migração ADITIVA: colunas nulas + índices; nenhuma linha existente alterada.
ALTER TABLE "operations" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(3);
ALTER TABLE "operations" ADD COLUMN IF NOT EXISTS "deleted_by_id" UUID;
ALTER TABLE "operations" ADD COLUMN IF NOT EXISTS "deletion_snapshot" JSONB;
CREATE INDEX IF NOT EXISTS "operations_deleted_at_idx" ON "operations" ("deleted_at");

ALTER TABLE "operation_documents" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(3);
ALTER TABLE "operation_documents" ADD COLUMN IF NOT EXISTS "deleted_by_id" UUID;
CREATE INDEX IF NOT EXISTS "operation_documents_deleted_at_idx" ON "operation_documents" ("deleted_at");
