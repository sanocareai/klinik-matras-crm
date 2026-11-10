-- SSO Task & Meeting (D-200): kode handoff sekali-pakai. Additive — tabel baru
-- saja, tidak menyentuh tabel lama. Yang disimpan hanya HASH kode (SHA-256).
-- state_hash disertakan langsung di sini (gabungan tahap 3+4 cabang lama;
-- identitas migration ini BARU, bukan reuse dari cabang lama yang sudah
-- diterapkan di tempat lain — lihat km-sanss-task-meeting-sso-forward-port).

CREATE TABLE "hub_handoffs" (
  "id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "state_hash" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hub_handoffs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hub_handoffs_code_hash_key" ON "hub_handoffs"("code_hash");
CREATE INDEX "hub_handoffs_user_id_used_at_revoked_at_idx" ON "hub_handoffs"("user_id", "used_at", "revoked_at");
CREATE INDEX "hub_handoffs_expires_at_idx" ON "hub_handoffs"("expires_at");
ALTER TABLE "hub_handoffs"
  ADD CONSTRAINT "hub_handoffs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
