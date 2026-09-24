-- Atendimentos concluídos não fechavam o assignment do técnico auxiliar: só o
-- executor primário era atualizado, então o auxiliar nunca aparecia com
-- atendimento concluído em Técnicos de Campo. O código já passou a espelhar o
-- andamento na equipe; aqui o histórico é alinhado.
--
-- Só toca em auxiliares que ficaram em aberto numa operação já concluída (ou em
-- revisão, que também carimba completed_at). Recusados e cancelados ficam como
-- estão, e a data usada é a da própria operação — não a de hoje.
UPDATE "assignments" a
SET "status"       = 'COMPLETED',
    "completed_at" = COALESCE(a."completed_at", o."completed_at"),
    "updated_at"   = now()
FROM "operations" o
WHERE o."id" = a."operation_id"
  AND a."is_primary" = false
  AND a."status" IN ('ASSIGNED', 'ACCEPTED', 'STARTED', 'PAUSED')
  AND o."status" IN ('COMPLETED', 'REVIEW')
  AND o."completed_at" IS NOT NULL;

INSERT INTO "assignment_history" ("assignment_id", "operation_id", "event", "actor_id", "new_status", "notes")
SELECT a."id", a."operation_id", 'COMPLETED', a."assigned_by", 'COMPLETED',
       'Conclusão retroativa: atendimento acompanhado como técnico auxiliar'
FROM "assignments" a
JOIN "operations" o ON o."id" = a."operation_id"
WHERE a."is_primary" = false
  AND a."status" = 'COMPLETED'
  AND o."status" IN ('COMPLETED', 'REVIEW')
  AND NOT EXISTS (
    SELECT 1 FROM "assignment_history" h
    WHERE h."assignment_id" = a."id" AND h."new_status" = 'COMPLETED'
  );
