// HARGA BERLAKU DARI PO (Okt 2026, revisi keputusan Owner 30 Okt) — harga bahan otomatis menjadi Harga Berlaku operasional SAAT PO BERHASIL DISIMPAN (draf dibuat / draf diubah),
// lewat layanan resmi hargaBerlaku.js (pratinjauUbahHarga + simpanHargaDiTx), di transaksi yang sama dengan penyimpanan PO. TIDAK ada izin/persetujuan harga tambahan: yang berwenang membuat/mengubah PO (finance:post) cukup.
//
// ATURAN (diuji di tests/integration/hargaDariPO.integration.test.js):
//   1. Input yang belum disimpan (pratinjau di formulir) TIDAK menulis apa pun. Gagal menyimpan PO ⇒ tidak ada harga yang berubah (satu transaksi).
//   2. Efektif saat penyimpanan berhasil ("saat disimpan", tanpa tanggal mundur). Sumber di riwayat: nomor PO, baris, revisi, pelaku, waktu, alasan otomatis ("Dari PO … — belum diterima").
//   3. Harga ditulis HANYA untuk baris yang harga/satuan/faktornya BERUBAH pada penyimpanan ini (baris baru atau diubah). Mengubah jumlah saja, memindah supplier, atau menyimpan ulang isi yang sama tidak menulis harga,
//      sehingga menyimpan ulang draf lama tidak pernah menimpa harga yang sudah lebih baru (dari PO lain atau ubah manual). Harga sama dengan Harga Berlaku sekarang ⇒ tidak ada baris baru.
//   4. Normalisasi ke SATUAN STOK hanya dengan konversi sah: satuan baris = satuan stok, atau satuan beli + faktor yang lolos validasiFaktor. Tanpa faktor sah ⇒ masalah di baris itu dan PO tidak tersimpan (tidak ada tebakan).
//      Hasil bagi >4 desimal dibulatkan ke 4 desimal dan ditampilkan. Bahan sama dengan harga stok berbeda dalam satu PO ⇒ konflik (PO tidak tersimpan); tidak ada "baris terakhir menang".
//   5. Persetujuan PO TIDAK menulis harga dan tidak mengembalikan harga; pembatalan PO tidak menghapus riwayat dan tidak mengembalikan harga lama (hanya dicatat apakah masih berlaku).
//   6. Idempoten: kunci po-harga:<poId>:<bahan>:r<revisi> (unik di DB; revisi = banyaknya harga yang sudah ditulis dari PO itu untuk bahan itu). Klik ganda/retry dengan isi sama tidak menulis lagi.
//   7. Ini HPP operasional: tidak menambah stok, tidak mengubah valuasi Finance/jurnal/GL, tidak menghitung ulang pemakaian lama. PO historis tidak diproses (tanpa migrasi/backfill/kode boot).
//   8. Saklar darurat: HARGA_DARI_PO=0 mematikan perilaku ini.
import { Decimal } from "./money.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { validasiFaktor } from "./skuBaru.js";
import { AWALAN_KUNCI_PO, keadaanHarga, pratinjauUbahHarga, simpanHargaDiTx, teksSumberPO } from "./hargaBerlaku.js";

export class HargaPOError extends Error {
  constructor(message, statusCode = 400, code = null, extra = null) { super(message); this.statusCode = statusCode; if (code) this.code = code; if (extra) this.extra = extra; }
}
const gagal = (m, s, c, extra) => new HargaPOError(m, s, c, extra);
const D = (v) => new Decimal(String(v ?? 0));

export const hargaDariPoAktif = () => process.env.HARGA_DARI_PO !== "0";

export const STATUS_BARIS = Object.freeze({
  BARU: "Belum punya Harga Berlaku — harga PO menjadi Harga Berlaku pertama",
  NAIK: "Harga naik", TURUN: "Harga turun", SAMA: "Sama dengan Harga Berlaku sekarang — tidak ada perubahan",
  TIDAK_DIUBAH: "Harga baris ini tidak diubah pada penyimpanan ini — Harga Berlaku tidak disentuh",
  KONFLIK_HARGA_BEDA: "Bahan yang sama punya harga berbeda di beberapa baris PO ini",
  KONVERSI_TIDAK_ADA: "Satuan beli berbeda dari satuan stok dan tidak ada faktor konversi",
  KONVERSI_TIDAK_SAH: "Faktor konversi tidak sah",
});
const STATUS_TULIS = new Set(["BARU", "NAIK", "TURUN"]);
const STATUS_MASALAH = new Set(["KONFLIK_HARGA_BEDA", "KONVERSI_TIDAK_ADA", "KONVERSI_TIDAK_SAH"]);
export const ATURAN_TEKS = Object.freeze([
  "Saat PO berhasil disimpan (draf baru atau perubahan draf), harga tiap bahan yang harganya berubah otomatis menjadi Harga Berlaku operasional sejak saat itu, dengan sumber “Dari PO … — belum diterima”. Isian yang belum disimpan tidak mengubah harga.",
  "Harga ditulis per SATUAN STOK memakai faktor konversi di baris PO. Tanpa faktor yang sah atau bila bahan yang sama berharga beda di dua baris, baris itu ditandai dan PO belum bisa disimpan.",
  "Ini HPP operasional (harga kerja). Tidak menambah stok, tidak mengubah nilai persediaan/valuasi Finance, tidak membuat jurnal, tidak menghitung ulang pemakaian lama.",
  "Menyetujui atau membatalkan PO tidak menulis ulang dan tidak mengembalikan harga. Ubah harga manual tetap tersedia di Stok → bahan → Ubah harga (alasan wajib).",
]);

const satuanSama = (a, b) => String(a ?? "").toUpperCase() === String(b ?? "").toUpperCase();

/** Harga satu baris PO dalam SATUAN STOK. Kembalian: { ok, hargaEksak, harga(4dp), faktor, dibulatkan } | { ok:false, status, alasan }. */
export function hargaStokBaris(baris, bahan) {
  const beli = D(baris.unitPrice);
  if (satuanSama(baris.unit, bahan.unit)) return { ok: true, hargaEksak: beli, harga: beli.toDecimalPlaces(4), faktor: null, dibulatkan: false };
  if (!baris.purchaseUnit || baris.conversionFactor == null || String(baris.conversionFactor) === "") return { ok: false, status: "KONVERSI_TIDAK_ADA", alasan: `Harga per ${baris.unit}, satuan stok ${bahan.unit}, tidak ada faktor konversi. Harga per ${baris.unit} tidak ditulis sebagai harga per ${bahan.unit}.` };
  if (!satuanSama(baris.purchaseUnit, baris.unit)) return { ok: false, status: "KONVERSI_TIDAK_SAH", alasan: `Satuan beli ${baris.purchaseUnit} tidak sama dengan satuan baris ${baris.unit}.` };
  let f; try { f = validasiFaktor(baris.unit, bahan.unit, baris.conversionFactor); } catch (e) { return { ok: false, status: "KONVERSI_TIDAK_SAH", alasan: e?.message || "Faktor konversi tidak sah" }; }
  const eksak = D(baris.unitPrice).dividedBy(f); const bulat = eksak.toDecimalPlaces(4);
  return { ok: true, hargaEksak: eksak, harga: bulat, faktor: f, dibulatkan: !eksak.equals(bulat) };
}

const sama = (a, b) => (a == null && b == null) || (a != null && b != null && D(a).equals(D(b)));
/** Baris PO sebelumnya untuk bahan itu sama persis (satuan, harga, faktor) dengan yang baru? ⇒ harga tidak diubah pada penyimpanan ini. */
const barisSama = (lama, baru) => !!lama && satuanSama(lama.unit, baru.unit) && sama(lama.unitPrice, baru.unitPrice) && sama(lama.conversionFactor ?? null, baru.conversionFactor ?? null);

/**
 * Rencana harga untuk sekumpulan baris PO (BACA-SAJA; dipakai pratinjau formulir DAN penyimpanan). Satu hasil per BAHAN.
 * baris: [{ no, materialId, unit, unitPrice, purchaseUnit?, conversionFactor?, bahan:{code,name,unit}, barangBaru? }]; sebelum: baris PO tersimpan sebelumnya (untuk menandai yang tidak diubah).
 */
export async function rencanaHarga(db, { baris, sebelum = [], sekarang = new Date() }) {
  const per = new Map(); for (const b of baris) { const a = per.get(b.materialId) ?? []; a.push(b); per.set(b.materialId, a); }
  const lama = new Map(sebelum.map((l) => [l.materialId, l]));
  const hasil = [];
  for (const [materialId, daftar] of per) {
    const bahan = daftar[0].bahan; const nomor = daftar.map((x) => x.no);
    const dasar = { materialId, kode: bahan.code, nama: bahan.name, satuanStok: bahan.unit, barisPO: nomor, barangBaru: !!daftar[0].barangBaru };
    const hitung = daftar.map((b) => ({ b, h: hargaStokBaris(b, bahan) }));
    const buruk = hitung.find((x) => !x.h.ok);
    if (buruk) { hasil.push({ ...dasar, status: buruk.h.status, alasan: buruk.h.alasan, masalah: true, hargaLama: null, hargaBaru: null, barisMasalah: buruk.b.no }); continue; }
    const beda = new Set(hitung.map((x) => x.h.harga.toString()));
    if (beda.size > 1) { hasil.push({ ...dasar, status: "KONFLIK_HARGA_BEDA", alasan: `Bahan ini ada di baris ${nomor.join(", ")} dengan harga per ${bahan.unit} berbeda (${[...beda].join(" / ")}). Gabungkan menjadi satu baris atau samakan harganya.`, masalah: true, hargaLama: null, hargaBaru: null, barisMasalah: nomor[1] }); continue; }
    const b0 = daftar[0]; const h = hitung[0].h;
    const kead = materialId && !dasar.barangBaru ? await keadaanHarga(db, materialId, sekarang) : { berlaku: null, terjadwal: [] };
    const lamaHarga = kead.berlaku ? D(kead.berlaku.unitPrice) : null;
    const selisihPersen = lamaHarga && lamaHarga.greaterThan(0) ? Number(h.harga.minus(lamaHarga).dividedBy(lamaHarga).times(100).toDecimalPlaces(1)) : null;
    let status = !lamaHarga ? "BARU" : h.harga.greaterThan(lamaHarga) ? "NAIK" : h.harga.lessThan(lamaHarga) ? "TURUN" : "SAMA";
    if (barisSama(lama.get(materialId), b0)) status = "TIDAK_DIUBAH";
    const peringatan = [];
    if (kead.terjadwal.length && STATUS_TULIS.has(status)) peringatan.push({ kode: "ADA_HARGA_TERJADWAL", pesan: `Ada harga terjadwal ${Number(kead.terjadwal[0].unitPrice).toLocaleString("id-ID")} mulai ${new Date(kead.terjadwal[0].effectiveFrom).toISOString().slice(0, 16).replace("T", " ")} UTC — tetap berlaku dan akan menggantikan harga dari PO ini pada waktunya.` });
    if (selisihPersen != null && Math.abs(selisihPersen) >= 30 && STATUS_TULIS.has(status)) peringatan.push({ kode: "SELISIH_BESAR", pesan: `Harga ${selisihPersen > 0 ? "naik" : "turun"} ${Math.abs(selisihPersen)}% — periksa satuan (${bahan.unit}) dan faktor konversi.` });
    if (h.dibulatkan && STATUS_TULIS.has(status)) peringatan.push({ kode: "DIBULATKAN_4_DESIMAL", pesan: `Harga per ${bahan.unit} hasil bagi ${h.hargaEksak.toDecimalPlaces(8).toString()} dibulatkan ke 4 desimal (${h.harga.toString()}).` });
    hasil.push({ ...dasar, status, alasan: STATUS_BARIS[status], masalah: false, hargaLama: lamaHarga ? Number(lamaHarga) : null, hargaBaru: Number(h.harga), hargaBaruEksak: h.hargaEksak.toDecimalPlaces(8).toString(), dibulatkan: h.dibulatkan, selisihPersen, hargaBeli: Number(b0.unitPrice), satuanBeli: b0.unit, faktor: h.faktor ? Number(h.faktor) : null, peringatan, hargaTerjadwal: kead.terjadwal.map((x) => ({ harga: Number(x.unitPrice), mulai: x.effectiveFrom })), _b: b0 });
  }
  return hasil;
}

/** Pratinjau untuk formulir PO (BACA-SAJA, tidak menulis). body: { poId?, lines:[{materialId?, materialBaru?, satuanBeli, faktorKonversi, unitPrice}] }. */
export async function pratinjauHargaFormulir(db, body = {}) {
  const lines = Array.isArray(body.lines) ? body.lines.slice(0, 100) : [];
  let sebelum = [];
  if (body.poId) sebelum = await db.finPurchaseOrderLine.findMany({ where: { purchaseOrderId: String(body.poId) }, select: { materialId: true, unit: true, unitPrice: true, conversionFactor: true } });
  const baris = []; const ids = [...new Set(lines.map((l) => l?.materialId).filter(Boolean))];
  const bahan = new Map((await db.material.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, unit: true } })).map((m) => [m.id, m]));
  lines.forEach((l, i) => {
    const harga = Number(l?.unitPrice); if (!Number.isFinite(harga) || harga <= 0) return;
    const baru = l?.materialBaru && !l?.materialId; const m = baru ? { code: "(baru)", name: String(l.materialBaru.nama ?? "Barang baru"), unit: String(l.materialBaru.satuanStok ?? "") } : bahan.get(l?.materialId); if (!m) return;
    const satuanBeli = String((baru ? l.materialBaru.satuanBeli : l?.satuanBeli) || m.unit); const faktorIn = baru ? l.materialBaru.faktorKonversi : l?.faktorKonversi; const beda = !satuanSama(satuanBeli, m.unit);
    baris.push({ no: i + 1, materialId: baru ? `baru-${i + 1}` : l.materialId, unit: satuanBeli, unitPrice: harga, ...(beda && { purchaseUnit: satuanBeli, conversionFactor: faktorIn === "" || faktorIn == null ? null : faktorIn }), bahan: m, barangBaru: !!baru });
  });
  const rencana = (await rencanaHarga(db, { baris, sebelum })).map(({ _b, ...x }) => x);
  return { aktif: hargaDariPoAktif(), baris: rencana, ringkas: { akanMenulis: rencana.filter((r) => STATUS_TULIS.has(r.status)).length, masalah: rencana.filter((r) => r.masalah).length }, aturan: ATURAN_TEKS };
}

const tulisSumber = (po, aksi, b, revisi, pelakuId, h) => ({ sumber: "PO", poId: po.id, poNumber: po.poNumber, materialId: b.materialId, barisPO: b.barisPO[0], revisi, aksi, pelakuId, hargaBeli: b.hargaBeli, satuanBeli: b.satuanBeli, faktor: b.faktor, hargaStokEksak: b.hargaBaruEksak, dibulatkan: b.dibulatkan, hargaLama: b.hargaLama });

/**
 * Terapkan harga SAAT PO DISIMPAN — dipanggil buatPO/ubahDraf DI DALAM transaksinya (PO + baris sudah tertulis, nomor PO ada).
 * `baris` = baris PO baru [{no, materialId, unit, unitPrice, purchaseUnit?, conversionFactor?}], `sebelum` = baris tersimpan sebelumnya (kosong untuk PO baru).
 * Masalah (konversi/konflik/harga tidak masuk akal) ⇒ HargaPOError dengan nomor baris ⇒ seluruh penyimpanan PO dibatalkan.
 */
export async function terapkanHargaSimpanPO(tx, { po, aksi, aktor, baris, sebelum = [] }) {
  if (!hargaDariPoAktif()) return { aktif: false, diterapkan: [], tidakBerubah: [] };
  const ids = [...new Set(baris.map((b) => b.materialId))].sort();
  for (const id of ids) await lockRowForUpdate(tx, "materials", id); // urutan tetap ⇒ dua penyimpanan serentak tidak saling kunci-mati; rencana dihitung SETELAH kunci
  const bahan = new Map((await tx.material.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, unit: true } })).map((m) => [m.id, m]));
  const rencana = await rencanaHarga(tx, { baris: baris.map((b) => ({ ...b, bahan: bahan.get(b.materialId) })), sebelum });
  const salah = rencana.find((r) => r.masalah);
  if (salah) throw gagal(`Baris ${salah.barisMasalah} (${salah.kode}): ${salah.alasan}`, 422, salah.status, { baris: salah.barisMasalah, bahan: salah.kode, hargaDariPO: true });
  const diterapkan = []; const tidakBerubah = [];
  for (const r of rencana) {
    if (!STATUS_TULIS.has(r.status)) { tidakBerubah.push({ materialId: r.materialId, kode: r.kode, status: r.status, harga: r.hargaBaru }); continue; }
    const revisi = await tx.materialHargaBerlaku.count({ where: { materialId: r.materialId, impact: { path: ["poId"], equals: po.id } } });
    const kunci = `${AWALAN_KUNCI_PO}${po.id}:${r.materialId}:r${revisi}`;
    const masukan = { materialId: r.materialId, hargaBaru: String(r.hargaBaru), satuan: r.satuanStok, berlakuMulai: null, alasan: `Otomatis dari PO ${po.poNumber} (baris ${r.barisPO[0]}, revisi ${revisi}) — ${aksi === "DIBUAT" ? "draf PO dibuat" : "draf PO diubah"}, belum diterima`,
      catatan: `Baris PO ${r.barisPO[0]}: ${r.hargaBeli} per ${r.satuanBeli}${r.faktor ? ` ÷ faktor ${r.faktor} ${r.satuanStok}/${r.satuanBeli}` : ""} = ${r.hargaBaru} per ${r.satuanStok}`, catatanBukti: null };
    try {
      const pra = await pratinjauUbahHarga(tx, masukan, { lengkap: false });
      const hasil = await simpanHargaDiTx(tx, { ...masukan, hashPratinjau: pra.hash }, { aktor, kunci, sumber: tulisSumber(po, aksi, r, revisi, aktor.id) });
      diterapkan.push({ materialId: r.materialId, kode: r.kode, status: r.status, hargaLama: r.hargaLama, hargaBaru: r.hargaBaru, satuan: r.satuanStok, barisPO: r.barisPO[0], revisi, hargaId: hasil.id, ulang: hasil.ulang });
    } catch (e) {
      throw gagal(`Baris ${r.barisPO[0]} (${r.kode}): ${e?.message || "Harga Berlaku tidak dapat diperbarui"}`, e?.statusCode ?? 422, e?.code ?? "HARGA_PO_GAGAL", { baris: r.barisPO[0], bahan: r.kode, hargaDariPO: true });
    }
  }
  return { aktif: true, aksi, diterapkan, tidakBerubah };
}

/** Untuk pembatalan PO: harga yang bersumber PO ini, dan apakah masih menjadi Harga Berlaku sekarang. TIDAK mengubah apa pun. */
export async function hargaBersumberPO(db, poId, sekarang = new Date()) {
  const rows = await db.materialHargaBerlaku.findMany({ where: { impact: { path: ["poId"], equals: poId } }, include: { material: { select: { code: true, name: true, unit: true } } }, orderBy: [{ effectiveFrom: "asc" }] });
  const hasil = [];
  for (const r of rows.filter((x) => x.impact?.sumber === "PO")) {
    const kead = await keadaanHarga(db, r.materialId, sekarang);
    hasil.push({ hargaId: r.id, materialId: r.materialId, kode: r.material.code, harga: Number(r.unitPrice), satuan: r.material.unit, revisi: r.impact.revisi ?? 0, masihBerlaku: kead.berlaku?.id === r.id, adaHargaLebihBaru: !!kead.terbaru && kead.terbaru.id !== r.id && new Date(kead.terbaru.effectiveFrom) > new Date(r.effectiveFrom) });
  }
  return hasil;
}

export { teksSumberPO };
