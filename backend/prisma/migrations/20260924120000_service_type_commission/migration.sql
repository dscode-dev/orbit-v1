-- Comissão do técnico por tipo de serviço: elegibilidade + percentual sobre o
-- valor do serviço. Tipos existentes ficam elegíveis a 0% (owner ajusta depois).
ALTER TABLE "service_types"
  ADD COLUMN "commission_eligible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "commission_percent" DECIMAL(5,2) NOT NULL DEFAULT 0;
