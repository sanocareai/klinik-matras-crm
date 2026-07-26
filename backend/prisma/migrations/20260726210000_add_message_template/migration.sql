-- Template pesan pindah dari backend/data/templates.json (file JSON polos,
-- tanpa kepemilikan, race condition nyata kalau 2 sales edit bersamaan)
-- ke tabel database dengan kepemilikan eksplisit (isShared + authorId).
--
-- CATATAN MIGRASI DATA: isi templates.json TIDAK ikut dipindah otomatis di
-- sini (raw SQL tidak bisa baca file dari container backend). Dipindah lewat
-- script terpisah `scripts/migrate-templates-json.js`, dijalankan SEKALI
-- setelah migration ini — lihat catatan deploy.

CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "kategori" TEXT NOT NULL DEFAULT 'lainnya',
    "isi" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageTemplate_authorId_idx" ON "MessageTemplate"("authorId");
CREATE INDEX "MessageTemplate_isShared_idx" ON "MessageTemplate"("isShared");

-- SetNull: template pribadi TETAP ADA kalau pemiliknya (sales) dihapus —
-- isi yang sudah teruji tidak boleh hilang begitu saja saat sales resign.
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
