-- Keputusan atribusi divisi per dokumen (Okt 2026) — ADITIF murni: 1 tabel baru (kosong). Tanpa backfill, tanpa UPDATE/DELETE, tanpa mengubah tabel/kolom lama.
-- Satu keputusan AKTIF per dokumen dijaga indeks unik parsial (ditambahkan manual di bawah; Prisma tidak mengekspresikannya).

-- CreateTable
CREATE TABLE "fin_attribution_decisions" (
    "id" UUID NOT NULL,
    "module" VARCHAR(24) NOT NULL,
    "document_id" UUID NOT NULL,
    "document_number" VARCHAR(60),
    "decided_scope" VARCHAR(32) NOT NULL,
    "previous_scope" VARCHAR(32) NOT NULL,
    "candidates" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "revoke_reason" TEXT,

    CONSTRAINT "fin_attribution_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_attribution_decisions_module_document_id_idx" ON "fin_attribution_decisions"("module", "document_id");

-- CreateIndex
CREATE INDEX "fin_attribution_decisions_revoked_at_idx" ON "fin_attribution_decisions"("revoked_at");

-- AddForeignKey
ALTER TABLE "fin_attribution_decisions" ADD CONSTRAINT "fin_attribution_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_attribution_decisions" ADD CONSTRAINT "fin_attribution_decisions_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateIndex (parsial): hanya satu keputusan belum dicabut per dokumen
CREATE UNIQUE INDEX "fin_attribution_decisions_active_doc_key" ON "fin_attribution_decisions"("module", "document_id") WHERE "revoked_at" IS NULL;
