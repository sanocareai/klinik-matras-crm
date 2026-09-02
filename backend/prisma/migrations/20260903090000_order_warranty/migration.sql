-- Kartu garansi e-warranty (2 Sep 2026) — lihat komentar di schema.prisma.
ALTER TABLE "Order" ADD COLUMN "warranty_years" INTEGER, ADD COLUMN "warranty_sent_at" TIMESTAMP(3);
