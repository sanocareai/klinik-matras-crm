-- CreateTable
CREATE TABLE "order_paid_at_pengecualian" (
    "id" UUID NOT NULL,
    "order_id" TEXT NOT NULL,
    "paid_at_dikunci" TIMESTAMP(3) NOT NULL,
    "paid_at_asli" TIMESTAMP(3),
    "alasan" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dicabut_at" TIMESTAMP(3),
    "dicabut_by" TEXT,
    "alasan_dicabut" TEXT,

    CONSTRAINT "order_paid_at_pengecualian_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_paid_at_pengecualian_order_id_idx" ON "order_paid_at_pengecualian"("order_id");

-- CreateIndex
CREATE INDEX "order_paid_at_pengecualian_dicabut_at_idx" ON "order_paid_at_pengecualian"("dicabut_at");

-- AddForeignKey
ALTER TABLE "order_paid_at_pengecualian" ADD CONSTRAINT "order_paid_at_pengecualian_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_paid_at_pengecualian" ADD CONSTRAINT "order_paid_at_pengecualian_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_paid_at_pengecualian" ADD CONSTRAINT "order_paid_at_pengecualian_dicabut_by_fkey" FOREIGN KEY ("dicabut_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Satu order maksimal SATU pengecualian aktif (yang sudah dicabut tetap tersimpan sebagai riwayat).
CREATE UNIQUE INDEX "order_paid_at_pengecualian_aktif_uniq" ON "order_paid_at_pengecualian"("order_id") WHERE "dicabut_at" IS NULL;
