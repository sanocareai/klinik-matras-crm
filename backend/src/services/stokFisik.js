// SALDO DILACAK SECARA FISIK (Okt 2026) — dasar cakupan bawaan Opname Penuh.
//
// Master bahan TIDAK punya flag "saldo dilacak fisik", dan keputusan ini TIDAK diambil dari nama kategori ("Habis Pakai" bisa saja stok sungguhan, "Barang Jadi" bisa saja tidak).
// Satu-satunya dasar adalah BUKTI bahwa bahan itu dikelola sebagai stok. Bahan aktif dianggap dilacak bila punya SATU atau lebih jejak berikut:
//   CATATAN_LEDGER   — ada pergerakan di ledger stok (stock_movements)
//   NILAI_REFERENSI  — ada nilai/harga referensi stok dari berkas stock opname Excel
//   TITIK_PESAN      — titik/jumlah pesan ulang diatur (dipantau kecukupannya)
//   JENIS_SKU        — didaftarkan lewat SKU baru sebagai item stok (kind: Bahan Produksi / Perlengkapan Stok)
//   DOKUMEN_GUDANG   — muncul di Penerimaan, Material Issue, Transfer, atau Riwayat Referensi
//   PERNAH_DIHITUNG  — pernah diberi angka hasil hitung pada sesi Stock Count yang tidak dibatalkan
//   BOM_PRODUKSI     — dipakai di rencana BOM Produksi
// Bahan aktif TANPA satu pun jejak → "tidak dilacak" beserta alasannya; tidak ikut Opname Penuh/Per kelompok bawaan, tetapi bisa DIIKUTKAN secara eksplisit (dengan alasan) bila ternyata
// barangnya ada di rak. Bahan nonaktif tidak pernah ikut. Pencarian jejak murni BACA-SAJA.

export const SINYAL_STOK = Object.freeze({
  CATATAN_LEDGER: "ada catatan di ledger stok",
  NILAI_REFERENSI: "ada nilai/harga referensi stok dari berkas stock opname",
  TITIK_PESAN: "titik pesan ulang diatur",
  JENIS_SKU: "didaftarkan sebagai item stok (SKU baru)",
  DOKUMEN_GUDANG: "muncul di dokumen Gudang",
  PERNAH_DIHITUNG: "pernah dihitung di sesi Stock Count",
  BOM_PRODUKSI: "dipakai di BOM Produksi",
});

export const ALASAN_TIDAK_DILACAK = "Tidak ada jejak stok: belum ada catatan ledger, nilai referensi, titik pesan ulang, dokumen Gudang, BOM Produksi, atau hasil hitung sebelumnya.";

/** Murni. Dari baris jejak SQL (boolean per sinyal) menjadi daftar kode sinyal. */
export function sinyalDariJejak(r) {
  const s = [];
  if (r.catatan) s.push("CATATAN_LEDGER");
  if (r.referensi) s.push("NILAI_REFERENSI");
  if (r.pesan_ulang) s.push("TITIK_PESAN");
  if (r.jenis_sku) s.push("JENIS_SKU");
  if (r.dokumen) s.push("DOKUMEN_GUDANG");
  if (r.pernah_dihitung) s.push("PERNAH_DIHITUNG");
  if (r.bom) s.push("BOM_PRODUKSI");
  return s;
}

/** BACA-SAJA. Map(materialId → { dilacak, sinyal[] }) untuk semua bahan aktif. */
export async function muatJejakStok(db) {
  const rows = await db.$queryRaw`
    SELECT m.id,
      EXISTS (SELECT 1 FROM stock_movements s WHERE s.material_id = m.id) AS catatan,
      (m.reference_stock_value IS NOT NULL OR m.reference_unit_cost IS NOT NULL) AS referensi,
      (m.reorder_point IS NOT NULL OR m.reorder_qty IS NOT NULL) AS pesan_ulang,
      (m.kind IS NOT NULL) AS jenis_sku,
      (EXISTS (SELECT 1 FROM goods_receipt_lines l WHERE l.material_id = m.id)
        OR EXISTS (SELECT 1 FROM material_issue_lines l WHERE l.material_id = m.id)
        OR EXISTS (SELECT 1 FROM stock_transfer_lines l WHERE l.material_id = m.id)
        OR EXISTS (SELECT 1 FROM stok_riwayat_referensi l WHERE l.material_id = m.id)) AS dokumen,
      EXISTS (SELECT 1 FROM stock_count_lines l JOIN stock_counts c ON c.id = l.stock_count_id WHERE l.material_id = m.id AND l.counted_qty IS NOT NULL AND c.status <> 'CANCELLED') AS pernah_dihitung,
      EXISTS (SELECT 1 FROM planned_bom_lines_v2 b WHERE b.material_id = m.id) AS bom
    FROM materials m WHERE m.active`;
  return new Map(rows.map((r) => { const sinyal = sinyalDariJejak(r); return [r.id, { dilacak: sinyal.length > 0, sinyal }]; }));
}
