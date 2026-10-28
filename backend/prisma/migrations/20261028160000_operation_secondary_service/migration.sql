ALTER TABLE "operations"
  ADD COLUMN "secondary_service_type" TEXT,
  ADD COLUMN "secondary_address_id" UUID;

ALTER TABLE "operations" ADD CONSTRAINT "operations_secondary_address_id_fkey"
  FOREIGN KEY ("secondary_address_id") REFERENCES "customer_addresses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
