// BUKU REVISI HIMPUNAN ITEM ORDER PKR (pkr_item_revisions, append-only).
//
// Setiap perubahan himpunan item — pembuatan (DIBUAT), pelengkapan spesifikasi (DILENGKAPI), koreksi (DIKOREKSI) — menulis SATU baris dengan nomor revisi berurutan per order.
// Revisi terbesar = token konkurensi optimistis: klien membaca revisi saat membuka pratinjau lalu mengirimnya kembali; bila sudah ada perubahan lain, penulisan DITOLAK (409)
// — bukan menimpa diam-diam. Indeks unik (order_id, revision) menjaga hal yang sama di tingkat basis data bila dua penulis lolos pemeriksaan aplikasi bersamaan.
import { PkrOrderError } from "./pkrGuard.js";
import { cerminanItem } from "../lib/domain/pkrItem.js";

const gagal = (m, s = 409, c = null, e = null) => new PkrOrderError(m, s, c, e);

/** Revisi terakhir order (0 = belum ada buku revisi: order PKR lama / bukan multi-item). */
export async function revisiTerakhir(db, orderId) {
  const r = await db.pkrItemRevision.findFirst({ where: { orderId }, orderBy: { revision: "desc" }, select: { revision: true } });
  return r?.revision ?? 0;
}

/** Bentuk ringkas himpunan item untuk before/after di buku revisi: item aktif (belum dihapus lunak) beserta kode unitnya. */
export async function snapshotItems(db, orderId) {
  const rows = await db.pkrOrderItem.findMany({
    where: { orderId }, orderBy: { seq: "asc" },
    include: { units: { select: { unit: { select: { unitCode: true, status: true } } } } },
  });
  return rows.map((r) => ({
    ...cerminanItem({
      no: r.seq, kategoriCode: r.categoryCode, kategoriNama: r.categoryName, bentuk: r.shape, jenisKerja: r.workKind, produkNama: r.productName, jumlah: r.qty,
      panjang: r.lengthCm == null ? null : Number(r.lengthCm), lebar: r.widthCm == null ? null : Number(r.widthCm), tebal: r.thicknessCm == null ? null : Number(r.thicknessCm),
      tinggi: r.heightCm == null ? null : Number(r.heightCm), spesifikasi: r.specNotes, perluDikirim: r.perluDikirim, bundleNo: r.bundleNo,
    }),
    dihapus: r.removedAt ? { alasan: r.removedReason } : null,
    unit: r.units.map((u) => ({ kode: u.unit.unitCode, status: u.unit.status })),
  }));
}

/**
 * Tulis revisi berikutnya. `expected` (opsional) = revisi yang dilihat klien; tidak cocok -> 409 REVISI_BERUBAH (beserta revisi saat ini).
 * Dipanggil di DALAM transaksi pemanggil dengan baris order terkunci.
 */
export async function tulisRevisi(tx, { orderId, penjualanId, kind, reason = null, before = null, after, impact = null, userId = null, idempotencyKey = null, expected = null, financeBefore = null, financeAfter = null }) {
  const sekarang = await revisiTerakhir(tx, orderId);
  if (expected !== null && expected !== sekarang) {
    throw gagal("Daftar item sudah diubah orang lain atau di layar lain. Muat ulang lalu periksa dampaknya sebelum mengirim lagi.", 409, "REVISI_BERUBAH", { revisiSaatIni: sekarang, revisiDikirim: expected });
  }
  try {
    return await tx.pkrItemRevision.create({
      data: { orderId, penjualanId, revision: sekarang + 1, kind, reason, beforeItems: before, afterItems: after, impact, actorId: userId, idempotencyKey, ...(financeBefore && { financeBefore }), ...(financeAfter && { financeAfter }) },
    });
  } catch (e) {
    if (e?.code === "P2002") throw gagal("Daftar item baru saja diubah oleh proses lain. Muat ulang lalu ulangi.", 409, "REVISI_BERUBAH", { revisiSaatIni: await revisiTerakhir(tx, orderId) });
    throw e;
  }
}
