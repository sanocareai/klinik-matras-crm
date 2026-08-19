-- D-025: kunci transaksi Order yang sudah DELIVERED (sudah terkirim/selesai)
-- untuk role non-ADMIN, dengan jejak audit APPEND-ONLY tiap kali ADMIN
-- mengedit order yang sudah dikunci itu. Lihat catatan panjang di
-- schema.prisma di atas model OrderRevisionLog.

CREATE TABLE "order_revision_logs" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "edited_by" TEXT,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_revision_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_revision_logs_orderId_created_at_idx" ON "order_revision_logs"("orderId", "created_at");

ALTER TABLE "order_revision_logs" ADD CONSTRAINT "order_revision_logs_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_revision_logs" ADD CONSTRAINT "order_revision_logs_edited_by_fkey"
    FOREIGN KEY ("edited_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
