-- Contatos: escolha de quais aparecem na landing page (até dois).
--
-- Até aqui todo contato cadastrado aparecia na landing. Agora o cadastro é
-- geral e o OWNER marca quais (no máximo dois) a página pública exibe.
--
-- Migração ADITIVA. Para não mudar o que a landing já mostra, os dois
-- primeiros contatos (por posição) de cada organização já entram marcados.
ALTER TABLE "organization_contacts"
  ADD COLUMN IF NOT EXISTS "show_on_landing" BOOLEAN NOT NULL DEFAULT false;

UPDATE "organization_contacts" AS c
SET "show_on_landing" = true
FROM (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "organization_id" ORDER BY "position", "created_at") AS rn
  FROM "organization_contacts"
) AS ranked
WHERE c."id" = ranked."id"
  AND ranked.rn <= 2
  AND NOT EXISTS (
    SELECT 1 FROM "organization_contacts" o
    WHERE o."organization_id" = c."organization_id" AND o."show_on_landing" = true
  );
