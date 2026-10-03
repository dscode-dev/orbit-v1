-- Bloqueio temporário após tentativas de senha erradas.
--
-- Até aqui só havia rate limit por IP (10/min no login): com IPs rotativos,
-- credential stuffing seguia viável contra uma conta específica.
--
-- Migração puramente ADITIVA: duas colunas com default, nenhuma linha
-- reescrita e nenhum comportamento alterado até o código novo subir.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "locked_until" TIMESTAMPTZ(3);
