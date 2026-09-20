# Kalibrasi saldo riil Kas & Bank — 19 Sep 2026 20.00 WIB

Dijalankan di produksi 20 Sep 2026. Kode: `backend/src/services/finance/kalibrasiSaldo.js`, skrip `backend/scripts/kalibrasiSaldoRiil20260919.js`, tes `backend/tests/integration/financeKalibrasiSaldo.integration.test.js`.

## Hasil
Jurnal koreksi **JV-19092026-372** (id `b22a98ea-535c-42af-9e12-54db3b2c05e5`), tanggal buku 2026-09-19, source `SALDO_AWAL`, kunci idempotensi `KALIBRASI_SALDO_RIIL:2026-09-19T20:00+07:00` (unik di DB → tidak bisa terposting dua kali), keterangan "Kalibrasi saldo riil per 19 September 2026 pukul 20.00 WIB". Lawan jurnal: akun ekuitas sistem **3-4100 Koreksi Saldo Awal** (`systemKey KOREKSI_SALDO_AWAL`) — bukan pendapatan/biaya. Backup sebelum posting: `~/klinik-matras/backups/pre-kalibrasi-saldo-final_2026-09-20_22-33-09.sql.gz` (di VPS).

| Rekening | Saldo buku pada cutoff | Saldo riil | Selisih (koreksi) | Net movement sesudah cutoff | Saldo current |
|---|---:|---:|---:|---:|---:|
| KEM - Sano Bank | 12.438.768,10 | 766.507,00 | −11.672.261,10 | +5.950.000,00 | 6.716.507,00 |
| PT Sano | 115.627.793,00 | 36.870.615,00 | −78.757.178,00 | −7.000.000,00 | 29.870.615,00 |
| Uang Kas Sano | 22.500,00 | 54.500,00 | +32.000,00 | +50.000,00 | 104.500,00 |
| **Total** | 128.089.061,10 | 37.691.622,00 | −90.397.439,10 | −1.000.000,00 | 36.691.622,00 |

## Aturan waktu (ledger hanya menyimpan TANGGAL buku)
Klasifikasi jurnal terhadap cutoff (`sebelumCutoff`): tanggal buku < 19 Sep = sebelum; tanggal buku = 19 Sep dipilah **waktu posting** (`postedAt ?? createdAt` ≤ 13:00 UTC = 20:00 WIB, inklusif); tanggal buku > 19 Sep = sesudah; jurnal kalibrasi sendiri = sebelum. "Akhir hari" tidak diasumsikan.

Pengecualian eksplisit atas konfirmasi pemilik (`sebelumDikonfirmasi`): JV-19092026-368 (Servis mobil ZAE, Rp2.515.000) dan JV-19092026-362 (Etoll alwan tambahan, Rp50.000) dibayar sebelum cutoff walau baru diinput 20 Sep → dihitung SEBELUM. Pasangan kasbon ganda JV-19092026-343/344 (dibalik 20 Sep oleh JV-20092026-345/346) sengaja tetap sesudah cutoff agar netral. **Jangan** memakai pengecualian untuk jurnal ganda yang kemudian dibalik.

Konsekuensi: laporan berbasis tanggal (`saldoKasBank({ to: 2026-09-19 })`) mengikutsertakan jurnal yang bertanggal buku 19 Sep tetapi diposting sesudah cutoff (kasbon ganda, net 0 setelah dibalik), jadi saldo riil pada cutoff dijamin oleh `hitungPosisi`, bukan oleh laporan per-tanggal.

## Pembuktian
Saldo current (laporan Kas & Bank = sumber Dashboard) = saldo riil + net movement sesudah cutoff; 8 jurnal bertanggal 20 Sep utuh (nomor, status, mutasi identik sebelum/sesudah); Σ debit = Σ kredit (jurnal koreksi Rp90.461.439,10 dan seluruh ledger Rp5.579.966.443,20); Neraca Saldo seimbang; akun 1-1100 = Rp104.500, 1-1200 = Rp36.587.122 (= KEM + PT), 3-4100 = debit Rp90.397.439,10.

## Temuan terpisah (bukan akibat kalibrasi, tidak diubah)
Laporan **Neraca** menampilkan `seimbang=false` dengan selisih tetap **−Rp45.834.231** pada 31 Agu, 17, 18, 19, dan 20 Sep 2026 (sudah ada sebelum jurnal koreksi; jurnal ini menurunkan aset dan ekuitas sama besar). Perlu diselidiki sendiri (kewajiban bersaldo negatif −Rp42.398.335 tampak terlibat).

## Menjalankan ulang
`node scripts/kalibrasiSaldoRiil20260919.js` = pratinjau. `KALIBRASI_BACKUP_OK=1 … --apply` menolak jalan tanpa penegasan backup; aman diulang (idempoten). Kalibrasi berikutnya = konfigurasi baru (`KALIBRASI_<tanggal>`), bukan mengubah yang ini.
