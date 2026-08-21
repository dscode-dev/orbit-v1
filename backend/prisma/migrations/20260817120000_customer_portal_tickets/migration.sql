-- Customer portal identities and customer-opened service tickets.
CREATE TYPE "CustomerPortalTicketStatus" AS ENUM (
  'OPEN',
  'IN_REVIEW',
  'OPERATION_CREATED',
  'CLOSED',
  'CANCELED'
);

CREATE TABLE "customer_portal_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "phone" VARCHAR(30),
  "must_change_password" BOOLEAN NOT NULL DEFAULT true,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "disabled_at" TIMESTAMPTZ(3),
  "last_login_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "customer_portal_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_portal_refresh_tokens" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "token_hash" VARCHAR(255) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "customer_portal_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_service_tickets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "address_id" UUID,
  "operation_id" UUID,
  "number" SERIAL NOT NULL,
  "status" "CustomerPortalTicketStatus" NOT NULL DEFAULT 'OPEN',
  "document_type" "DocumentTemplateType" NOT NULL DEFAULT 'WORK_ORDER',
  "operation_type" "OperationType" NOT NULL DEFAULT 'CORRETIVA',
  "service_types" "OperationType"[] NOT NULL DEFAULT ARRAY[]::"OperationType"[],
  "equipment_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "title" VARCHAR(160) NOT NULL,
  "description" TEXT NOT NULL,
  "priority" VARCHAR(40),
  "preferred_date" TIMESTAMPTZ(3),
  "contact_name" VARCHAR(150),
  "contact_phone" VARCHAR(30),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "customer_service_tickets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_portal_accounts_email_key" ON "customer_portal_accounts"("email");
CREATE INDEX "customer_portal_accounts_organization_id_is_active_idx" ON "customer_portal_accounts"("organization_id", "is_active");
CREATE INDEX "customer_portal_accounts_customer_id_is_active_idx" ON "customer_portal_accounts"("customer_id", "is_active");

CREATE INDEX "customer_portal_refresh_tokens_account_id_revoked_at_idx" ON "customer_portal_refresh_tokens"("account_id", "revoked_at");
CREATE INDEX "customer_portal_refresh_tokens_expires_at_idx" ON "customer_portal_refresh_tokens"("expires_at");

CREATE UNIQUE INDEX "customer_service_tickets_operation_id_key" ON "customer_service_tickets"("operation_id");
CREATE UNIQUE INDEX "customer_service_tickets_number_key" ON "customer_service_tickets"("number");
CREATE INDEX "customer_service_tickets_organization_id_status_created_at_idx" ON "customer_service_tickets"("organization_id", "status", "created_at");
CREATE INDEX "customer_service_tickets_customer_id_created_at_idx" ON "customer_service_tickets"("customer_id", "created_at");
CREATE INDEX "customer_service_tickets_account_id_created_at_idx" ON "customer_service_tickets"("account_id", "created_at");
CREATE INDEX "customer_service_tickets_document_type_status_idx" ON "customer_service_tickets"("document_type", "status");

ALTER TABLE "customer_portal_accounts"
  ADD CONSTRAINT "customer_portal_accounts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_portal_accounts"
  ADD CONSTRAINT "customer_portal_accounts_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_portal_refresh_tokens"
  ADD CONSTRAINT "customer_portal_refresh_tokens_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "customer_portal_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_service_tickets"
  ADD CONSTRAINT "customer_service_tickets_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_service_tickets"
  ADD CONSTRAINT "customer_service_tickets_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_service_tickets"
  ADD CONSTRAINT "customer_service_tickets_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "customer_portal_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_service_tickets"
  ADD CONSTRAINT "customer_service_tickets_address_id_fkey"
  FOREIGN KEY ("address_id") REFERENCES "customer_addresses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_service_tickets"
  ADD CONSTRAINT "customer_service_tickets_operation_id_fkey"
  FOREIGN KEY ("operation_id") REFERENCES "operations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
