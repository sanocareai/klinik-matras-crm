-- Fase 2 Laporan Divisi (fondasi) — ADITIF: satu nilai enum, satu kolom ber-default, satu enum + satu tabel baru. Tidak menyentuh data/ledger yang ada.

-- D&T divisi tersendiri pada keanggotaan divisi
ALTER TYPE "DivisiKeanggotaan" ADD VALUE 'DIGITAL_TECHNOLOGY';

-- Leader divisi (default false: tidak ada pengguna yang otomatis menjadi leader)
ALTER TABLE "user_divisions" ADD COLUMN "is_leader" BOOLEAN NOT NULL DEFAULT false;

-- Anggaran bulanan per divisi
CREATE TYPE "FinBudgetStatus" AS ENUM ('DRAF', 'DISETUJUI', 'DIGANTIKAN');

CREATE TABLE "fin_division_budgets" (
    "id" UUID NOT NULL,
    "line_key" VARCHAR(200) NOT NULL,
    "version" INTEGER NOT NULL,
    "division" VARCHAR(30) NOT NULL,
    "category_id" UUID,
    "project_key" VARCHAR(80),
    "period" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "FinBudgetStatus" NOT NULL DEFAULT 'DRAF',
    "reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),

    CONSTRAINT "fin_division_budgets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fin_division_budgets_line_key_version_key" ON "fin_division_budgets"("line_key", "version");
CREATE INDEX "fin_division_budgets_division_period_status_idx" ON "fin_division_budgets"("division", "period", "status");

ALTER TABLE "fin_division_budgets" ADD CONSTRAINT "fin_division_budgets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_division_budgets" ADD CONSTRAINT "fin_division_budgets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fin_division_budgets" ADD CONSTRAINT "fin_division_budgets_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
