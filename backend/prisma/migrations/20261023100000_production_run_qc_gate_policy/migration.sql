-- Fase 2 LAYANAN: versi kebijakan gerbang QC sebelum bongkar dipin per Production Run. Aditif; NULL = run lama (gerbang tidak berlaku). Tidak ada data diubah.
ALTER TABLE "production_runs_v2" ADD COLUMN "qc_gate_policy_version" VARCHAR(40);
