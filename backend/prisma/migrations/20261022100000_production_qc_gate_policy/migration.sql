-- Gap Fase 2 (QC sebelum bongkar): kolom aditif pada production_runs_v2, pola sama adaptation_policy. Tanpa tabel baru, tanpa backfill.
ALTER TABLE "production_runs_v2" ADD COLUMN "qc_gate_policy_version" VARCHAR(40);
