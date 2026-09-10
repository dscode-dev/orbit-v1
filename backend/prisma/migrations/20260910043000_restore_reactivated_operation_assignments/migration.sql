-- Repairs Operations reactivated by the previous implementation, which moved
-- the Operation to PENDING but left its primary Assignment canceled and hidden.
-- Only inconsistent PENDING records assigned to an active user are affected.
WITH restored AS (
  UPDATE "assignments" AS assignment
  SET
    "status" = 'ASSIGNED',
    "assigned_at" = CURRENT_TIMESTAMP,
    "operator_visible" = TRUE,
    "authorized_at" = CURRENT_TIMESTAMP,
    "authorized_by" = assignment."assigned_by",
    "accepted_at" = NULL,
    "started_at" = NULL,
    "completed_at" = NULL,
    "canceled_at" = NULL,
    "rejected_at" = NULL,
    "rejection_reason" = NULL,
    "updated_at" = CURRENT_TIMESTAMP
  FROM "operations" AS operation, "users" AS assignee
  WHERE operation."id" = assignment."operation_id"
    AND assignee."id" = assignment."assigned_to"
    AND operation."status" = 'PENDING'
    AND assignment."is_primary" = TRUE
    AND assignment."status" = 'CANCELED'
    AND assignee."is_active" = TRUE
    AND assignee."disabled_at" IS NULL
  RETURNING
    assignment."id",
    assignment."operation_id",
    assignment."assigned_by"
)
INSERT INTO "assignment_history" (
  "id",
  "assignment_id",
  "operation_id",
  "event",
  "actor_id",
  "previous_status",
  "new_status",
  "notes",
  "created_at"
)
SELECT
  gen_random_uuid(),
  restored."id",
  restored."operation_id",
  'ASSIGNED',
  restored."assigned_by",
  'CANCELED',
  'ASSIGNED',
  'Atribuição restaurada após reativação da operação',
  CURRENT_TIMESTAMP
FROM restored;
