-- Tipo de Serviço editável (catálogo) no lugar do enum fixo OperationType.
-- As colunas que usavam o enum passam a TEXT preservando os valores atuais
-- (que viram as "chaves" do catálogo). Nenhuma linha de operação é reescrita.

-- 1) Catálogo de tipos de serviço.
CREATE TABLE "service_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "generates_reminder" BOOLEAN NOT NULL DEFAULT false,
    "reminder_interval_months" INTEGER,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "service_types_organization_id_key_key" ON "service_types"("organization_id", "key");
CREATE INDEX "service_type_lookup_idx" ON "service_types"("organization_id", "active", "sort_order");
CREATE INDEX "service_type_deleted_idx" ON "service_types"("organization_id", "deleted_at");

-- 2) Semeia os 4 tipos originais para cada organização, preservando as chaves do
-- enum. Preventiva e Instalação mantêm o lembrete de +6 meses (comportamento atual).
INSERT INTO "service_types"
  ("id","organization_id","key","label","active","is_system","sort_order","generates_reminder","reminder_interval_months")
SELECT gen_random_uuid(), o."id", k.key, k.label, true, true, k.ord, k.reminder, k.months
FROM "organizations" o
CROSS JOIN (VALUES
  ('PREVENTIVA','Preventiva',0,true,6),
  ('CORRETIVA','Corretiva',1,false,NULL),
  ('INSTALACAO','Instalação',2,true,6),
  ('PROJETO','Projeto',3,false,NULL)
) AS k("key","label","ord","reminder","months")
ON CONFLICT ("organization_id","key") DO NOTHING;

-- 3) Converte as colunas do enum para TEXT preservando os valores existentes.
ALTER TABLE "operations" ALTER COLUMN "type" TYPE TEXT USING "type"::text;

ALTER TABLE "operations" ALTER COLUMN "service_types" DROP DEFAULT;
ALTER TABLE "operations" ALTER COLUMN "service_types" TYPE TEXT[] USING "service_types"::text[];
ALTER TABLE "operations" ALTER COLUMN "service_types" SET DEFAULT '{}';

ALTER TABLE "pmoc_plans" ALTER COLUMN "default_operation_type" DROP DEFAULT;
ALTER TABLE "pmoc_plans" ALTER COLUMN "default_operation_type" TYPE TEXT USING "default_operation_type"::text;
ALTER TABLE "pmoc_plans" ALTER COLUMN "default_operation_type" SET DEFAULT 'PREVENTIVA';

ALTER TABLE "pmoc_plans" ALTER COLUMN "service_types" DROP DEFAULT;
ALTER TABLE "pmoc_plans" ALTER COLUMN "service_types" TYPE TEXT[] USING "service_types"::text[];
ALTER TABLE "pmoc_plans" ALTER COLUMN "service_types" SET DEFAULT '{}';

ALTER TABLE "customer_service_tickets" ALTER COLUMN "operation_type" DROP DEFAULT;
ALTER TABLE "customer_service_tickets" ALTER COLUMN "operation_type" TYPE TEXT USING "operation_type"::text;
ALTER TABLE "customer_service_tickets" ALTER COLUMN "operation_type" SET DEFAULT 'CORRETIVA';

ALTER TABLE "customer_service_tickets" ALTER COLUMN "service_types" DROP DEFAULT;
ALTER TABLE "customer_service_tickets" ALTER COLUMN "service_types" TYPE TEXT[] USING "service_types"::text[];
ALTER TABLE "customer_service_tickets" ALTER COLUMN "service_types" SET DEFAULT '{}';

ALTER TABLE "maintenance_reminders" ALTER COLUMN "operation_type" TYPE TEXT USING "operation_type"::text;

-- 4) Remove o enum, agora sem colunas dependentes.
DROP TYPE "OperationType";
