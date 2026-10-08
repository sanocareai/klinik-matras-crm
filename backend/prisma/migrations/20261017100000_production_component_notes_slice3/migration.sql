-- Simplifikasi Production slice 3 (Catatan Komponen kanonis per unit) — ADITIF: satu tabel baru, tanpa DROP/UPDATE/DELETE; data lama tidak berubah.
-- Append-only: koreksi = baris versi baru. Informasi/dokumentasi saja — tidak menyentuh stok, BOM, retur, maupun lifecycle produksi.
CREATE TABLE "unit_component_entries_v2" (
    "id"         UUID         NOT NULL,
    "unit_id"    UUID         NOT NULL,
    "run_id"     UUID,
    "section"    VARCHAR(24)  NOT NULL,
    "version"    INTEGER      NOT NULL,
    "payload"    JSONB        NOT NULL DEFAULT '{}',
    "media"      JSONB        NOT NULL DEFAULT '[]',
    "reason"     TEXT,
    "actor_id"   TEXT,
    "command_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_component_entries_v2_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "unit_component_entries_v2_section_check" CHECK ("section" IN ('LAYERS_BEFORE', 'FOUNDATION_BEFORE', 'AFTER')),
    CONSTRAINT "unit_component_entries_v2_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "unit_component_entries_v2_unit_id_section_version_key" ON "unit_component_entries_v2"("unit_id", "section", "version");
CREATE INDEX "unit_component_entries_v2_unit_id_created_at_idx" ON "unit_component_entries_v2"("unit_id", "created_at");

ALTER TABLE "unit_component_entries_v2" ADD CONSTRAINT "unit_component_entries_v2_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
