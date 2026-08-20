ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CUSTOMER';

CREATE TYPE "ServiceRequestStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'SCHEDULED', 'CLOSED', 'CANCELED');
CREATE TYPE "ServiceRequestType" AS ENUM ('WORK_ORDER', 'RVT', 'TECHNICAL_REPORT');

ALTER TABLE "users" ADD COLUMN "customer_id" UUID;
CREATE INDEX "users_customer_id_idx" ON "users"("customer_id");
ALTER TABLE "users" ADD CONSTRAINT "users_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "service_requests" (
  "id" UUID NOT NULL,
  "number" SERIAL NOT NULL,
  "customer_id" UUID NOT NULL,
  "address_id" UUID,
  "type" "ServiceRequestType" NOT NULL DEFAULT 'WORK_ORDER',
  "status" "ServiceRequestStatus" NOT NULL DEFAULT 'OPEN',
  "subject" VARCHAR(180) NOT NULL,
  "description" TEXT NOT NULL,
  "contact_name" VARCHAR(150),
  "contact_phone" VARCHAR(30),
  "preferred_at" TIMESTAMPTZ(3),
  "internal_notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_requests_number_key" ON "service_requests"("number");
CREATE INDEX "service_requests_customer_id_created_at_idx" ON "service_requests"("customer_id", "created_at");
CREATE INDEX "service_requests_status_created_at_idx" ON "service_requests"("status", "created_at");
CREATE INDEX "service_requests_type_created_at_idx" ON "service_requests"("type", "created_at");
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_address_id_fkey"
  FOREIGN KEY ("address_id") REFERENCES "customer_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "service_request_equipments" (
  "service_request_id" UUID NOT NULL,
  "equipment_id" UUID NOT NULL,
  CONSTRAINT "service_request_equipments_pkey" PRIMARY KEY ("service_request_id", "equipment_id")
);
CREATE INDEX "service_request_equipments_equipment_id_idx" ON "service_request_equipments"("equipment_id");
ALTER TABLE "service_request_equipments" ADD CONSTRAINT "service_request_equipments_service_request_id_fkey"
  FOREIGN KEY ("service_request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_request_equipments" ADD CONSTRAINT "service_request_equipments_equipment_id_fkey"
  FOREIGN KEY ("equipment_id") REFERENCES "equipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "operations" ADD COLUMN "service_request_id" UUID;
CREATE UNIQUE INDEX "operations_service_request_id_key" ON "operations"("service_request_id");
CREATE INDEX "operations_service_request_id_idx" ON "operations"("service_request_id");
ALTER TABLE "operations" ADD CONSTRAINT "operations_service_request_id_fkey"
  FOREIGN KEY ("service_request_id") REFERENCES "service_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
