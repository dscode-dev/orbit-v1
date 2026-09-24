-- Comissão para técnicos auxiliares.
--
-- 1) Percentual próprio por tipo de serviço: o owner pode pagar ao auxiliar um
--    percentual diferente do técnico primário. Nasce em 0 (auxiliar não recebe
--    até ser configurado), então nada muda para quem já usa o módulo.
ALTER TABLE "service_types"
  ADD COLUMN IF NOT EXISTS "commission_percent_assistant" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- 2) Lançamentos por pessoa: a mesma operação passa a pagar o primário e os
--    auxiliares, o que o vínculo antigo (operations.commission_payment_id,
--    um beneficiário só) não comportava.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionRole') THEN
    CREATE TYPE "CommissionRole" AS ENUM ('PRIMARY', 'ASSISTANT');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "commission_entries" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "payment_id"   UUID NOT NULL,
  "operation_id" UUID NOT NULL,
  "user_id"      UUID NOT NULL,
  "role"         "CommissionRole" NOT NULL,
  "amount"       DECIMAL(14,2) NOT NULL,
  "created_at"   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "commission_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_entries_payment_id_fkey" FOREIGN KEY ("payment_id")
    REFERENCES "commission_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "commission_entries_operation_id_fkey" FOREIGN KEY ("operation_id")
    REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "commission_entries_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "commission_entries_operation_id_user_id_key"
  ON "commission_entries"("operation_id", "user_id");
CREATE INDEX IF NOT EXISTS "commission_entries_user_id_idx" ON "commission_entries"("user_id");
CREATE INDEX IF NOT EXISTS "commission_entries_payment_id_idx" ON "commission_entries"("payment_id");

-- 3) Backfill: tudo que já foi fechado vira lançamento do técnico primário,
--    para o histórico continuar íntegro e nada ser recalculado/recobrado.
INSERT INTO "commission_entries" ("payment_id", "operation_id", "user_id", "role", "amount")
SELECT o."commission_payment_id", o."id", o."operator_id", 'PRIMARY', COALESCE(o."commission_amount", 0)
FROM "operations" o
WHERE o."commission_payment_id" IS NOT NULL
ON CONFLICT ("operation_id", "user_id") DO NOTHING;
