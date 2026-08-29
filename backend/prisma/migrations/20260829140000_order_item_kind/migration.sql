-- Snapshot PriceItem.kind ke OrderItem (29 Agustus 2026) — sama alasan dgn
-- normal_price/standard_price: katalog bisa berubah, baris order historis
-- harus tetap tahu kategorinya dulu apa tanpa join ke katalog terkini.
ALTER TABLE "OrderItem" ADD COLUMN "kind" "PriceItemKind";
