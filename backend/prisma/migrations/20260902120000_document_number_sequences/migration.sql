-- Numeração por tipo de documento de operação.
-- Cada tipo (OS, PMOC, RVT, ...) passa a ter sua própria sequência, em vez de
-- reaproveitar o número global da Operation. Documentos existentes NÃO são
-- alterados; a sequência é semeada com o maior número já usado por tipo, de modo
-- que os próximos números continuem acima dos atuais (sem colisão nem retrocesso).

CREATE TABLE "document_number_sequences" (
    "type" "DocumentTemplateType" NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_number_sequences_pkey" PRIMARY KEY ("type")
);

-- Semeia cada tipo com o maior operation.number entre os documentos daquele tipo.
-- Só considera documentos vinculados a uma operação (orçamentos usam o número do
-- Budget e não participam desta numeração).
INSERT INTO "document_number_sequences" ("type", "last_number", "updated_at")
SELECT d."type", MAX(o."number"), CURRENT_TIMESTAMP
FROM "operation_documents" d
JOIN "operations" o ON o."id" = d."operation_id"
GROUP BY d."type"
ON CONFLICT ("type") DO NOTHING;
