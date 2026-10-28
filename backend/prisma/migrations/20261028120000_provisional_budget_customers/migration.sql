ALTER TABLE "customers"
  ADD COLUMN "is_provisional" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "provisional_expires_at" TIMESTAMPTZ(3);
CREATE INDEX "customers_is_provisional_provisional_expires_at_idx"
  ON "customers"("is_provisional", "provisional_expires_at");
