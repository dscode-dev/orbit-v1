-- Comissão por valor fixo (padrão do cliente) além do percentual.
--
-- O modo é da organização: o owner alterna entre "valor fixo por atendimento" e
-- "percentual sobre o valor do serviço" no modal de Comissões. Nasce FIXED, que
-- é o fluxo real de quem usa; os percentuais já configurados continuam salvos e
-- voltam a valer assim que o modo é trocado para PERCENT.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionMode') THEN
    CREATE TYPE "CommissionMode" AS ENUM ('FIXED', 'PERCENT');
  END IF;
END
$$;

ALTER TABLE "organization_settings"
  ADD COLUMN IF NOT EXISTS "commission_mode" "CommissionMode" NOT NULL DEFAULT 'FIXED';

-- Valores fixos por tipo de serviço (técnico e auxiliar), em reais. Começam em
-- zero: cada função só passa a receber quando o owner definir o valor.
ALTER TABLE "service_types"
  ADD COLUMN IF NOT EXISTS "commission_fixed" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "commission_fixed_assistant" DECIMAL(14,2) NOT NULL DEFAULT 0;
