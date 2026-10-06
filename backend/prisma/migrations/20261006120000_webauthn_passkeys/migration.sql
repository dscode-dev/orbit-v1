-- Login por biometria (passkeys / WebAuthn).
--
-- `webauthn_credentials`: chave PÚBLICA de cada aparelho cadastrado pelo
-- usuário (a biometria nunca sai do aparelho). `webauthn_challenges`: desafios
-- de uso único e curta duração para cadastro e login.
--
-- Migração ADITIVA: só tabelas novas.
CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "credential_id" VARCHAR(512) NOT NULL,
  "public_key" BYTEA NOT NULL,
  "counter" BIGINT NOT NULL DEFAULT 0,
  "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "device_name" VARCHAR(120) NOT NULL,
  "backed_up" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMPTZ(3),
  CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "webauthn_credentials_credential_id_key" ON "webauthn_credentials" ("credential_id");
CREATE INDEX IF NOT EXISTS "webauthn_credentials_user_id_idx" ON "webauthn_credentials" ("user_id");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webauthn_credentials_user_id_fkey') THEN
    ALTER TABLE "webauthn_credentials"
      ADD CONSTRAINT "webauthn_credentials_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
  "id" UUID NOT NULL,
  "user_id" UUID,
  "purpose" VARCHAR(20) NOT NULL,
  "challenge" VARCHAR(255) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "webauthn_challenges_expires_at_idx" ON "webauthn_challenges" ("expires_at");
