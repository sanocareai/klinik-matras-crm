-- Sano Hub Phase 3 — reorder point alert (D-024, PRD FR-I-05). Keduanya
-- nullable: null = alert mati untuk material itu, bukan "reorder di titik 0".

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "reorder_point" DOUBLE PRECISION,
ADD COLUMN     "reorder_qty" DOUBLE PRECISION;
