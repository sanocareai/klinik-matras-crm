// P8.2 (UI Polish) — laporan owner dari screenshot live: angka tab "Semua
// 595" vs "500 unit" di kanan atas tabel Work Order terlihat seperti data
// tidak konsisten. DIBUKTIKAN (backend/src/routes/production.js, baca saja,
// TIDAK diubah): dua angka itu memang MENGUKUR HAL BERBEDA, bukan bug —
//   - Angka pada TAB ("Semua", "Di Bengkel", dst) = `statusCounts`,
//     `prisma.unit.groupBy(...)` TANPA klausa where sama sekali — TOTAL
//     GLOBAL seluruh unit per status, sengaja TIDAK mengikuti tab/pencarian/
//     filter lini layanan yang aktif (supaya angka di tab stabil, tidak
//     berubah-ubah saat pengguna pindah tab — lihat komentar di endpoint).
//   - Jumlah BARIS tabel = `data.units.length`, dari query `prisma.unit.
//     findMany({ where, ..., take: 500 })` — MENGIKUTI filter aktif, TAPI
//     dibatasi maksimum 500 baris.
// Jadi "595" bukan salah hitung dari "500" — 595 adalah total seluruh unit
// TANPA filter apa pun, sedangkan 500 adalah baris hasil query (bisa jadi
// sudah difilter DAN/ATAU kena batas 500). Perbaikan di sini murni PRESENTASI
// (teks yang menjelaskan bedanya) — tidak ada perubahan backend/data.
export const WORK_ORDER_ROW_CAP = 500;

export function describeRowCount({ rowCount, hasActiveFilter }) {
  const capped = rowCount >= WORK_ORDER_ROW_CAP;
  if (hasActiveFilter) {
    return capped
      ? `${rowCount} unit ditemukan sesuai filter (dibatasi ${WORK_ORDER_ROW_CAP} baris — mungkin masih ada lagi, persempit pencarian untuk memastikan)`
      : `${rowCount} unit ditemukan sesuai filter`;
  }
  return capped
    ? `Menampilkan ${rowCount} dari maksimum ${WORK_ORDER_ROW_CAP} baris yang ditarik sekaligus — angka pada tab di atas adalah TOTAL seluruh unit per status (tidak mengikuti pencarian/filter)`
    : `Menampilkan ${rowCount} unit — angka pada tab di atas adalah TOTAL seluruh unit per status (tidak mengikuti pencarian/filter)`;
}
