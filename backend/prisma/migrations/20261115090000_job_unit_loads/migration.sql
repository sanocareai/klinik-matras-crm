-- KONFIRMASI MUAT UNIT PER JOB (manifest Delivery): satu baris = satu unit job yang sudah dikonfirmasi dimuat/dibawa. Aditif: tabel baru KOSONG, tanpa backfill,
-- tanpa mengubah tabel lama. Unik per (job, unit) => klik ulang/replay tidak menggandakan. Dihapus berantai bersama job (konfirmasi hanya bermakna untuk job itu).
CREATE TABLE "job_unit_loads" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_unit_loads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_unit_loads_job_id_unit_id_key" ON "job_unit_loads"("job_id", "unit_id");
CREATE INDEX "job_unit_loads_unit_id_idx" ON "job_unit_loads"("unit_id");

ALTER TABLE "job_unit_loads" ADD CONSTRAINT "job_unit_loads_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_unit_loads" ADD CONSTRAINT "job_unit_loads_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_unit_loads" ADD CONSTRAINT "job_unit_loads_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
