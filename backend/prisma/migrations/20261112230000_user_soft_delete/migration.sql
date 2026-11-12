ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- Earlier DELETE requests only disabled the account. Recover confirmed deletions
-- from their audit trail; keep ordinary disabled/re-enabled accounts intact.
WITH latest_access_action AS (
  SELECT DISTINCT ON ("metadata"->>'targetUserId')
    "metadata"->>'targetUserId' AS user_id, "action", "created_at"
  FROM "audit_logs"
  WHERE "resource" = 'USER'
    AND "action" IN ('USER_DELETED', 'USER_DISABLED', 'USER_ENABLED')
    AND "metadata"->>'targetUserId' IS NOT NULL
  ORDER BY "metadata"->>'targetUserId', "created_at" DESC, "id" DESC
)
UPDATE "users" AS u
SET "deleted_at" = a."created_at"
FROM latest_access_action AS a
WHERE u."id"::text = a.user_id AND a."action" = 'USER_DELETED'
  AND u."is_active" = false;
