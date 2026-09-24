-- Fechamento/pagamento de comissões dos técnicos.
-- Operações já incluídas num pagamento saem do cálculo do valor pendente, o que
-- evita recalcular comissões que já foram quitadas (inclusive as pagas
-- manualmente antes desta feature: basta o owner fechar o período retroativo).

CREATE TYPE "CommissionPeriod" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

ALTER TABLE "organization_settings"
  ADD COLUMN "commission_period" "CommissionPeriod" NOT NULL DEFAULT 'MONTHLY';

CREATE TABLE "commission_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "operation_count" INTEGER NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "paid_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "commission_payments_operator_id_paid_at_idx" ON "commission_payments"("operator_id", "paid_at");
CREATE INDEX "commission_payments_organization_id_paid_at_idx" ON "commission_payments"("organization_id", "paid_at");

ALTER TABLE "commission_payments"
  ADD CONSTRAINT "commission_payments_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commission_payments"
  ADD CONSTRAINT "commission_payments_paid_by_id_fkey"
  FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Vínculo da operação com o fechamento que a pagou + valor congelado no momento
-- do pagamento (o percentual do tipo pode ser alterado depois).
ALTER TABLE "operations"
  ADD COLUMN "commission_payment_id" UUID,
  ADD COLUMN "commission_amount" DECIMAL(14,2);

ALTER TABLE "operations"
  ADD CONSTRAINT "operations_commission_payment_id_fkey"
  FOREIGN KEY ("commission_payment_id") REFERENCES "commission_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "operations_commission_idx" ON "operations"("operator_id", "status", "completed_at");
CREATE INDEX "operations_commission_payment_id_idx" ON "operations"("commission_payment_id");
