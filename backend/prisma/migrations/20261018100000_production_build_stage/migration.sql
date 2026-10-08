-- Tahap "Pengerjaan Pesanan" untuk pesanan BARU/custom (jalur Production Run WORKSHOP_BORN). ADITIF: satu baris master `routing_stages` (pola yang sama dengan
-- migrasi 20260731100200_sano_hub_routing). Tidak dipetakan ke layanan mana pun (tanpa baris service_catalog_modules) sehingga jalur unit LAYANAN dan histori lama
-- TIDAK berubah; hanya unit BARU yang lahir di workshop memakainya (lib/domain/productionBuildTrack.js). Idempoten (ON CONFLICT DO NOTHING).
INSERT INTO "routing_stages"
    ("id", "code", "label_id", "phase", "sequence", "service_line", "is_optional", "requires_photo", "requires_qc", "required_role")
VALUES
    (gen_random_uuid(), 'custom_build', 'Pengerjaan Pesanan', 'MODULE', 10, NULL, false, true, false, 'PRODUCTION_WORKER')
ON CONFLICT ("code") DO NOTHING;
