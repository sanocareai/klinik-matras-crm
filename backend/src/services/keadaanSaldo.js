// KEADAAN SALDO BAHAN — pembeda jujur: belum ada catatan stok (saldo BELUM DIKETAHUI) ≠ nol menurut pergerakan ≠ nol TERVERIFIKASI hitung fisik ≠ positif ≠ minus.
// Dipakai Stok & Lokasi (services/stokLokasi.js) dan Koreksi Saldo (services/koreksiSaldoBahan.js). Baca-saja; tidak menulis apa pun.
const r4 = (v) => Math.round(Number(v ?? 0) * 10000) / 10000;
const EPS = 1e-6;

export const KEADAAN_SALDO = Object.freeze({
  BELUM_ADA_CATATAN: "BELUM_ADA_CATATAN", NOL_MENURUT_PERGERAKAN: "NOL_MENURUT_PERGERAKAN", NOL_TERVERIFIKASI: "NOL_TERVERIFIKASI", POSITIF: "POSITIF", MINUS: "MINUS",
});
export const LABEL_KEADAAN_SALDO = Object.freeze({
  BELUM_ADA_CATATAN: "Belum ada catatan stok — saldo belum diketahui (BUKAN nol)",
  NOL_MENURUT_PERGERAKAN: "Nol menurut pergerakan — belum diverifikasi hitung fisik",
  NOL_TERVERIFIKASI: "Nol terverifikasi — hasil hitung fisik/koreksi resmi menyatakan 0",
  POSITIF: "Ada stok menurut catatan",
  MINUS: "Catatan minus — perlu dihitung fisik",
});

/** Murni. NOL terverifikasi hanya bila ada bukti hitung fisik/koreksi resmi; "belum ada catatan" TIDAK pernah dianggap nol. */
export function klasifikasiSaldo({ jumlahPergerakan, saldo, nolTerverifikasi }) {
  const s = r4(saldo);
  if (s < -EPS) return KEADAAN_SALDO.MINUS;
  if (s > EPS) return KEADAAN_SALDO.POSITIF;
  if (nolTerverifikasi) return KEADAAN_SALDO.NOL_TERVERIFIKASI;
  return jumlahPergerakan > 0 ? KEADAAN_SALDO.NOL_MENURUT_PERGERAKAN : KEADAAN_SALDO.BELUM_ADA_CATATAN;
}

/**
 * Bukti saldo 0 yang TERVERIFIKASI per bahan: (a) Stock Count selesai dengan hasil hitung 0 pada bahan itu (baris tidak dikeluarkan), atau (b) koreksi saldo resmi ke 0 yang sudah diposting.
 * Berlaku hanya bila TIDAK ada pergerakan stok SESUDAH waktu verifikasi (toleransi 60 dtk untuk pergerakan penyesuaian yang dibuat verifikasi itu sendiri).
 * Mengembalikan Map(materialId -> { sumber, nomor, waktu }).
 */
export async function nolTerverifikasiPer(db, materialId = null) {
  const filter = materialId ? "AND x.material_id = $1::uuid" : "";
  const args = materialId ? [materialId] : [];
  const rows = await db.$queryRawUnsafe(`
    WITH bukti AS (
      SELECT l.material_id, c.completed_at AS waktu, c.count_number AS nomor, 'STOCK_COUNT' AS sumber
        FROM stock_count_lines l JOIN stock_counts c ON c.id = l.stock_count_id
       WHERE c.status = 'COMPLETED' AND c.completed_at IS NOT NULL AND l.counted_qty = 0 AND l.excluded_at IS NULL
      UNION ALL
      SELECT k.material_id, r.posted_at, r.adjustment_number, 'KOREKSI_SALDO'
        FROM koreksi_saldo_bahan k JOIN stock_adjustment_requests r ON r.id = k.adjustment_request_id
       WHERE r.status = 'POSTED' AND r.posted_at IS NOT NULL AND k.jumlah_fisik = 0
    )
    SELECT DISTINCT ON (x.material_id) x.material_id::text AS "materialId", x.sumber, x.nomor, x.waktu
      FROM bukti x
     WHERE NOT EXISTS (SELECT 1 FROM stock_movements s WHERE s.material_id = x.material_id AND s.created_at > x.waktu + interval '60 seconds') ${filter}
     ORDER BY x.material_id, x.waktu DESC`, ...args);
  return new Map(rows.map((r) => [r.materialId, { sumber: r.sumber, nomor: r.nomor, waktu: r.waktu }]));
}
