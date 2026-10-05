-- Exclusão de usuário: física quando não há histórico; arquivamento quando há.
--
-- Até aqui "Excluir" só desativava o usuário (igual a "Desativar") e ele
-- continuava na lista. Usuário com histórico (atendimentos, documentos,
-- financeiro…) não pode ser apagado sem perder a auditoria, então passa a ser
-- arquivado: `deleted_at` preenchido, inativo e fora da listagem.
--
-- Migração ADITIVA: coluna nula + índice; nenhuma linha existente alterada.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(3);

CREATE INDEX IF NOT EXISTS "users_deleted_at_idx" ON "users" ("deleted_at");
