-- Cache klasifikasi LLM intent pesan terakhir customer, dipakai Sales Risk
-- Engine (GANTI regex keyword-presence yang salah tangkap negasi/penolakan).
CREATE TABLE "SalesRiskIntentClassification" (
    "customerId" TEXT NOT NULL,
    "latestMessageIntent" TEXT NOT NULL,
    "latestMessageAt" TIMESTAMP(3) NOT NULL,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesRiskIntentClassification_pkey" PRIMARY KEY ("customerId")
);

ALTER TABLE "SalesRiskIntentClassification" ADD CONSTRAINT "SalesRiskIntentClassification_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
