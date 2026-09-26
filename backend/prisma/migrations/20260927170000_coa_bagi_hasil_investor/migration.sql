-- Bagi Hasil Investor: dua akun COA baru (murni tambahan, idempoten, tidak menimpa/mengubah jurnal atau akun yang sudah ada).
--   3-4200 Distribusi Laba / Bagi Hasil Investor (Ekuitas, saldo normal Debit) — pembagian laba/profit sharing ke investor; bukan beban.
--   2-1800 Utang Bagi Hasil Investor (Kewajiban Lancar, saldo normal Kredit) — bila bagi hasil diakui dulu sebelum dibayar.
-- Dilewati bila kode sudah ada. Induk dicari lewat kode; bila belum ada (database kosong) parent dibiarkan NULL dan diisi oleh
-- ensureDefaultChartOfAccounts.
INSERT INTO "fin_accounts" ("id", "code", "name", "type", "normal_balance", "parent_id", "is_postable", "cash_flow_category", "description", "active", "created_at", "updated_at")
SELECT gen_random_uuid(), '3-4200', 'Distribusi Laba / Bagi Hasil Investor', 'EKUITAS', 'DEBIT',
       (SELECT "id" FROM "fin_accounts" WHERE "code" = '3-0000'), true, 'PENDANAAN',
       'Akun untuk mencatat pembagian laba/profit sharing kepada investor. Bukan beban operasional, bukan biaya produksi, dan bukan pengeluaran biasa: tidak masuk Laba Rugi maupun ringkasan Pengeluaran, tampil sebagai pengurang ekuitas di Neraca. Dibayar langsung: Dr 3-4200, Cr Bank/Kas. Diakui dulu: Dr 3-4200, Cr 2-1800. Lihat docs/FINANCE-BAGI-HASIL-INVESTOR.md.',
       true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "fin_accounts" WHERE "code" = '3-4200');

INSERT INTO "fin_accounts" ("id", "code", "name", "type", "normal_balance", "parent_id", "is_postable", "cash_flow_category", "description", "active", "created_at", "updated_at")
SELECT gen_random_uuid(), '2-1800', 'Utang Bagi Hasil Investor', 'KEWAJIBAN', 'KREDIT',
       (SELECT "id" FROM "fin_accounts" WHERE "code" = '2-1000'), true, 'PENDANAAN',
       'Bagi hasil investor yang sudah diakui (Dr 3-4200) tetapi belum dibayar. Saat dibayar: Dr 2-1800, Cr Bank/Kas. Bukan beban operasional. Lihat docs/FINANCE-BAGI-HASIL-INVESTOR.md.',
       true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "fin_accounts" WHERE "code" = '2-1800');
