-- D-033 — tanggal pengiriman (pasangan dari D-029 pickupEstimate/
-- pickupConfirmedDate, sekarang untuk sisi PENGIRIMAN).
ALTER TABLE "Order" ADD COLUMN "delivery_estimate" TEXT,
ADD COLUMN "delivery_confirmed_date" DATE;
