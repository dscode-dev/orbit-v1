-- Additive, production-safe specialization of the existing aggregate Budget discount.
ALTER TABLE "budgets"
  ADD COLUMN "service_discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "material_discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "service_discount_description" VARCHAR(500),
  ADD COLUMN "material_discount_description" VARCHAR(500);

-- Preserve every historical aggregate discount. As the former model had no scope,
-- existing values are allocated to services first and the remainder to materials.
UPDATE "budgets"
SET
  "service_discount" = LEAST("discount", "service_subtotal"),
  "material_discount" = GREATEST("discount" - "service_subtotal", 0),
  "service_discount_description" = CASE
    WHEN LEAST("discount", "service_subtotal") > 0
      THEN 'Desconto especial aplicado aos serviços'
    ELSE NULL
  END,
  "material_discount_description" = CASE
    WHEN GREATEST("discount" - "service_subtotal", 0) > 0
      THEN 'Desconto especial aplicado aos materiais e fornecimentos'
    ELSE NULL
  END
WHERE "discount" > 0;
