// STOK & LOKASI YANG JUJUR (Okt 2026) — membedakan: ada catatan stok, nol hasil hitungan pergerakan, MINUS, dan BELUM ADA CATATAN sama sekali; serta batas minimum yang belum diatur.
// Tidak ada kesimpulan yang tidak didukung data:
//   • "Stok habis" hanya untuk bahan yang punya pergerakan dan saldonya nol. Bahan yang belum pernah punya pergerakan = "Belum ada catatan stok" (belum diketahui, bukan habis).
//   • "Perlu reorder/menipis" hanya untuk bahan yang batas minimumnya DIATUR. Bila belum ada yang diatur, ringkasan menyatakannya, bukan "0 perlu reorder".
//   • Lokasi: sistem TIDAK menyimpan saldo per lokasi. Yang ditampilkan "lokasi penerimaan terakhir" (lokasi pergerakan RECEIPT terbaru), bukan saldo di lokasi itu.
// Sumber angka: SUM(qty) ledger stock_movements (computeStockSnapshot); reservasi dari Material Issue/reservasi Produksi. Baca-saja.
import { computeStockSnapshot } from "./inventoryLedger.js";
import { kelompokDariItemGroup, ringkasKelompok } from "../constants/kelompokBahan.js";

export const KEADAAN = Object.freeze({
  ADA: "ADA", MENIPIS: "MENIPIS", TERPESAN_PENUH: "TERPESAN_PENUH", NOL_TERHITUNG: "NOL_TERHITUNG", MINUS: "MINUS", BELUM_ADA_CATATAN: "BELUM_ADA_CATATAN", NONAKTIF: "NONAKTIF",
});
export const LABEL_KEADAAN = Object.freeze({
  ADA: "Ada stok", MENIPIS: "Menipis (di bawah batas minimum)", TERPESAN_PENUH: "Seluruhnya sudah dipesan", NOL_TERHITUNG: "Nol (habis menurut pergerakan)",
  MINUS: "Catatan minus — perlu dihitung fisik", BELUM_ADA_CATATAN: "Belum ada catatan stok", NONAKTIF: "Nonaktif",
});

const r4 = (v) => Math.round(Number(v ?? 0) * 10000) / 10000;

/** Murni: keadaan satu bahan dari angka ledger. */
export function keadaanStok({ active, balance, available, reorderPoint, jumlahPergerakan }) {
  if (!active) return KEADAAN.NONAKTIF;
  if (!(jumlahPergerakan > 0)) return KEADAAN.BELUM_ADA_CATATAN;
  if (r4(balance) < 0) return KEADAAN.MINUS;
  if (r4(balance) === 0) return KEADAAN.NOL_TERHITUNG;
  if (r4(available) <= 0) return KEADAAN.TERPESAN_PENUH;
  if (reorderPoint != null && r4(available) <= Number(reorderPoint)) return KEADAAN.MENIPIS;
  return KEADAAN.ADA;
}

export function ringkasStok(rows) {
  const aktif = rows.filter((r) => r.keadaan !== KEADAAN.NONAKTIF);
  const hitung = (k) => aktif.filter((r) => r.keadaan === k).length;
  const diatur = aktif.filter((r) => r.batasMinimum != null).length;
  const hasil = {
    terdaftar: rows.length, aktif: aktif.length, nonaktif: rows.length - aktif.length,
    ada: hitung(KEADAAN.ADA) + hitung(KEADAAN.MENIPIS) + hitung(KEADAAN.TERPESAN_PENUH),
    belumAdaCatatan: hitung(KEADAAN.BELUM_ADA_CATATAN), nolTerhitung: hitung(KEADAAN.NOL_TERHITUNG), minus: hitung(KEADAAN.MINUS), terpesanPenuh: hitung(KEADAAN.TERPESAN_PENUH),
    batasMinimumDiatur: diatur, batasMinimumBelumDiatur: aktif.length - diatur, menipis: hitung(KEADAAN.MENIPIS),
  };
  hasil.kesimpulan = {
    stokHabis: hasil.nolTerhitung > 0 ? `${hasil.nolTerhitung} bahan habis menurut pergerakan` : "Belum ada bahan yang terbukti habis",
    belumDiketahui: hasil.belumAdaCatatan > 0 ? `${hasil.belumAdaCatatan} bahan belum punya catatan stok (belum diketahui — bukan berarti habis)` : null,
    minus: hasil.minus > 0 ? `${hasil.minus} bahan bersaldo minus: catatan perlu dihitung fisik dan dikoreksi resmi` : null,
    reorder: diatur === 0 ? "Batas minimum belum diatur untuk satu pun bahan — belum bisa menyatakan bahan yang perlu dipesan ulang" : `${hasil.menipis} dari ${diatur} bahan ber-batas-minimum berada di batas atau di bawahnya`,
  };
  return hasil;
}

export async function stokLokasi(db) {
  const [dasar, jumlah, lokasi, grup] = await Promise.all([
    computeStockSnapshot(db),
    db.$queryRaw`SELECT material_id AS "materialId", COUNT(*)::int AS n FROM stock_movements GROUP BY material_id`,
    db.$queryRaw`SELECT DISTINCT ON (material_id) material_id AS "materialId", location, created_at AS "waktu" FROM stock_movements WHERE type = 'RECEIPT' AND qty > 0 ORDER BY material_id, created_at DESC`,
    db.material.findMany({ select: { id: true, itemGroup: true } }),
  ]);
  const nGrup = new Map(grup.map((g) => [g.id, g.itemGroup ?? null]));
  const nJumlah = new Map(jumlah.map((x) => [x.materialId, x.n]));
  const nLokasi = new Map(lokasi.map((x) => [x.materialId, x]));
  const rows = dasar.map((r) => {
    const n = nJumlah.get(r.materialId) ?? 0; const lok = nLokasi.get(r.materialId) ?? null;
    const keadaan = keadaanStok({ active: r.active, balance: r.balance, available: r.available, reorderPoint: r.reorderPoint, jumlahPergerakan: n });
    return {
      materialId: r.materialId, kode: r.code, nama: r.name, satuan: r.unit, aktif: r.active, kategori: r.category, vendor: r.vendor ?? null,
      itemGroup: nGrup.get(r.materialId) ?? null, kelompok: kelompokDariItemGroup(nGrup.get(r.materialId)), // turunan dari itemGroup (tabel eksplisit), bukan tebakan nama; tidak disimpan
      saldo: n > 0 ? r4(r.balance) : null, // null = belum diketahui (BUKAN nol)
      dipesan: n > 0 ? r4(r.reserved) : null, tersedia: n > 0 ? r4(r.available) : null,
      batasMinimum: r.reorderPoint ?? null, // null = belum diatur (BUKAN nol)
      keadaan, keadaanLabel: LABEL_KEADAAN[keadaan],
      lokasiTerakhir: lok ? { lokasi: lok.location, waktu: lok.waktu, catatan: "Lokasi penerimaan terakhir (bukan saldo per lokasi)" } : null,
      sumberAngka: n > 0 ? { jenis: "LEDGER", jumlahPergerakan: n, pergerakanTerakhir: r.lastMovementAt, teks: `Ledger pergerakan: ${n} pergerakan, terakhir ${r.lastMovementAt ? new Date(r.lastMovementAt).toISOString().slice(0, 10) : "—"}` } : { jenis: "BELUM_ADA", jumlahPergerakan: 0, pergerakanTerakhir: null, teks: "Belum ada pergerakan stok untuk bahan ini" },
      catatanData: r.dataNote ?? null,
    };
  });
  return { rows, ringkasan: ringkasStok(rows), kelompok: ringkasKelompok(rows), catatan: "Saldo dihitung dari ledger pergerakan. Sistem tidak menyimpan saldo per lokasi; lokasi yang tampil adalah lokasi penerimaan terakhir." };
}
