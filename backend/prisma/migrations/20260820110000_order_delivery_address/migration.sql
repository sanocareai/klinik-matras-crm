-- D-027: kota + alamat pengiriman per order (terpisah dari Customer.city)
ALTER TABLE "Order" ADD COLUMN "delivery_city" TEXT;
ALTER TABLE "Order" ADD COLUMN "delivery_address" TEXT;
