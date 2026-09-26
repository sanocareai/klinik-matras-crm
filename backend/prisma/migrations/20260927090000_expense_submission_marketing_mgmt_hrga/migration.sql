-- C2 Pengajuan Biaya Marketing / Management / HR-GA — hanya menambah 11 kategori pengeluaran bawaan yang memakai akun resmi YANG SUDAH ADA
-- (6-1200 Beban Iklan & Pemasaran, 6-1900 Beban Lain-lain). Tidak ada perubahan skema, akun baru, atau data lama. Idempoten; Finance boleh
-- mengarahkan kategori ke akun lain lewat Pengaturan. Kategori dilewati bila kode sudah ada atau akun tujuan tidak ada (tidak ada kategori yatim).
INSERT INTO "fin_expense_categories" ("id", "code", "name", "account_id", "division", "active", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.name, a."id", v.division::"FinDivision", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('MKT_PROMOSI', 'Iklan & Promosi (di luar AdSpend)', '6-1200', 'MARKETING'),
  ('MKT_KONTEN', 'Produksi Konten Marketing', '6-1200', 'MARKETING'),
  ('MKT_EVENT', 'Event & Aktivasi Marketing', '6-1200', 'MARKETING'),
  ('MKT_CETAK', 'Cetak Materi Promosi', '6-1200', 'MARKETING'),
  ('MGT_KONSULTAN', 'Konsultan & Jasa Profesional', '6-1900', 'MANAGEMENT'),
  ('MGT_LEGAL', 'Legal & Perizinan Management', '6-1900', 'MANAGEMENT'),
  ('HRGA_REKRUTMEN', 'Rekrutmen', '6-1900', 'HR_GA'),
  ('HRGA_PELATIHAN', 'Pelatihan Karyawan', '6-1900', 'HR_GA'),
  ('HRGA_KESEJAHTERAAN', 'Kesejahteraan Karyawan', '6-1900', 'HR_GA'),
  ('HRGA_PERAWATAN_FASILITAS', 'Perawatan Fasilitas Kantor', '6-1900', 'HR_GA'),
  ('HRGA_PERIZINAN', 'Perizinan & Administrasi', '6-1900', 'HR_GA')
) AS v(code, name, account_code, division)
JOIN "fin_accounts" a ON a."code" = v.account_code
WHERE NOT EXISTS (SELECT 1 FROM "fin_expense_categories" c WHERE c."code" = v.code);
