-- AlterTable: Order.complaint_category dari scalar enum jadi array
-- (customer hampir selalu punya lebih dari satu area keluhan sekaligus).
-- Nilai lama yang sudah ada dibungkus jadi array 1 elemen, NULL jadi array kosong.
ALTER TABLE "Order" ALTER COLUMN "complaint_category" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "complaint_category" TYPE "HealthComplaintCategory"[]
  USING (CASE WHEN "complaint_category" IS NULL THEN ARRAY[]::"HealthComplaintCategory"[] ELSE ARRAY["complaint_category"]::"HealthComplaintCategory"[] END);
ALTER TABLE "Order" ALTER COLUMN "complaint_category" SET DEFAULT ARRAY[]::"HealthComplaintCategory"[];
ALTER TABLE "Order" ALTER COLUMN "complaint_category" SET NOT NULL;

-- AlterTable: Customer.complaint_category sama persis
ALTER TABLE "Customer" ALTER COLUMN "complaint_category" DROP DEFAULT;
ALTER TABLE "Customer" ALTER COLUMN "complaint_category" TYPE "HealthComplaintCategory"[]
  USING (CASE WHEN "complaint_category" IS NULL THEN ARRAY[]::"HealthComplaintCategory"[] ELSE ARRAY["complaint_category"]::"HealthComplaintCategory"[] END);
ALTER TABLE "Customer" ALTER COLUMN "complaint_category" SET DEFAULT ARRAY[]::"HealthComplaintCategory"[];
ALTER TABLE "Customer" ALTER COLUMN "complaint_category" SET NOT NULL;

-- AlterTable: field baru D-029 (Ongkir, estimasi pickup, link lokasi)
ALTER TABLE "Order" ADD COLUMN "ongkir" INTEGER,
ADD COLUMN "ongkir_klaim_garansi" INTEGER,
ADD COLUMN "pickup_estimate" TEXT,
ADD COLUMN "pickup_confirmed_date" DATE,
ADD COLUMN "location_url" TEXT;
