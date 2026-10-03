-- Responsáveis de contato da organização (landing page).
--
-- Até aqui a vitrine só tinha `phone`/`phone_numbers` soltos e usava o primeiro
-- número como WhatsApp. Empresas com mais de um responsável precisam de nome e
-- canal por pessoa.
--
-- Migração puramente ADITIVA: tabela nova, nenhuma linha existente reescrita.
-- Sem contatos cadastrados, a landing continua usando `phone` como antes.
CREATE TABLE IF NOT EXISTS "organization_contacts" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "role" VARCHAR(80),
  "phone" VARCHAR(30) NOT NULL,
  "is_whatsapp" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "organization_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "organization_contacts_organization_id_position_idx"
  ON "organization_contacts" ("organization_id", "position");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_contacts_organization_id_fkey'
  ) THEN
    ALTER TABLE "organization_contacts"
      ADD CONSTRAINT "organization_contacts_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
