-- Ganti tracking firstAlertedAt/lastNotifiedDay dari in-memory Map (hilang
-- tiap restart backend) ke tabel — supaya hitungan hari eskalasi tidak
-- reset lagi cuma karena deploy.
CREATE TABLE "StaleLeadAlertLog" (
    "customerId" TEXT NOT NULL,
    "firstAlertedAt" TIMESTAMP(3) NOT NULL,
    "lastNotifiedDay" TEXT,

    CONSTRAINT "StaleLeadAlertLog_pkey" PRIMARY KEY ("customerId")
);

ALTER TABLE "StaleLeadAlertLog" ADD CONSTRAINT "StaleLeadAlertLog_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
