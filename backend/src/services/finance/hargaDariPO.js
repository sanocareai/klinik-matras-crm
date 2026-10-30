// HARGA BERLAKU DARI PO (Okt 2026) — persetujuan PO memperbarui Harga Berlaku operasional bahan, lewat layanan resmi hargaBerlaku.js (pratinjauUbahHarga + simpanHargaDiTx).
//
// ATURAN (jangan dilanggar; diuji di tests/integration/hargaDariPO.integration.test.js):
//   1. DRAF tidak mengubah harga. Harga baru lahir HANYA saat PO disetujui, berlaku efektif saat persetujuan ("saat disimpan"; tanpa tanggal mundur).
//   2. Harga dinormalisasi ke SATUAN STOK hanya dengan konversi yang SAH di sistem: satuan baris = satuan stok (faktor 1), atau baris punya satuan beli + faktor yang lolos validasiFaktor (disimpan saat PO dibuat).
//      Tanpa konversi sah → KONVERSI_TIDAK_ADA/KONVERSI_TIDAK_SAH (konflik); harga per BOX/CAN TIDAK PERNAH ditulis sebagai harga per PCS/KG. Hasil bagi >4 desimal dibulatkan ke 4 desimal DAN ditampilkan (tidak diam-diam).
//   3. Satu bahan dengan harga stok berbeda di baris-baris PO yang sama → KONFLIK_HARGA_BEDA; tidak pernah memilih baris terakhir. Konflik harus diselesaikan (ubah draf) atau dilewati EKSPLISIT oleh penyetuju; tidak ada yang dilewati diam-diam.
//   4. Harga sama dengan Harga Berlaku sekarang → tidak ada baris baru (SAMA). Harga terjadwal yang sudah ada TIDAK dihapus: ia tetap mengambil alih pada waktunya (peringatan di pratinjau).
//   5. Tidak menulis stok, valuasi Finance, jurnal, GL, maupun catatan pemakaian; pemakaian yang sudah dibekukan tidak dihitung ulang (itu aturan hargaBerlaku.js). PO historis yang sudah disetujui TIDAK diproses (tidak ada backfill/migrasi).
//   6. Idempoten: kunci = po-harga:<poId>:<baris>:r<revisi>; persetujuan ulang/klik ganda/retry tidak membuat baris ganda. Satu transaksi dengan persetujuan PO: gagal di mana pun ⇒ PO tetap draf (tidak ada "setengah berhasil").
//   7. Pembatalan PO TIDAK menghapus riwayat dan TIDAK mengembalikan harga lama (harga bisa sudah dipakai/ada yang lebih baru); statusnya hanya ditampilkan ("PO dibatalkan — harga tetap berlaku sampai diubah").
//   8. Izin: persetujuan PO = finance:approve (Finance, Admin, Owner). Bila persetujuan itu MENGUBAH Harga Berlaku, penyetuju wajib juga punya finance:harga_berlaku:edit (Finance + Owner, keputusan Owner); Admin tanpa peran itu tidak bisa menyetujui PO yang mengubah harga.
//   9. Saklar: HARGA_DARI_PO=0 mematikan seluruh perilaku ini (persetujuan PO kembali seperti sebelumnya).
import crypto from "node:crypto";
import { Decimal } from "./money.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { validasiFaktor } from "./skuBaru.js";
import { AWALAN_KUNCI_PO, keadaanHarga, pratinjauUbahHarga, simpanHargaDiTx, teksSumberPO } from "./hargaBerlaku.js";

export class HargaPOError extends Error {
  constructor(message, statusCode = 400, code = null, extra = null) { super(message); this.statusCode = statusCode; if (code) this.code = code; if (extra) this.extra = extra; }
}
const gagal = (m, s, c, extra) => new HargaPOError(m, s, c, extra);
const D = (v) => new Decimal(String(v ?? 0));
const sha = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex");

export const hargaDariPoAktif = () => process.env.HARGA_DARI_PO !== "0";

export const STATUS_BARIS = Object.freeze({
  BARU: "Belum punya Harga Berlaku — harga PO akan menjadi Harga Berlaku",
  NAIK: "Harga naik", TURUN: "Harga turun", SAMA: "Sama dengan Harga Berlaku sekarang — tidak ada perubahan",
  KONFLIK_HARGA_BEDA: "Bahan yang sama punya harga berbeda di beberapa baris PO ini",
  KONVERSI_TIDAK_ADA: "Satuan beli berbeda dari satuan stok dan tidak ada faktor konversi",
  KONVERSI_TIDAK_SAH: "Faktor konversi tidak sah",
  SUDAH_DITERAPKAN: "Sudah diterapkan dari PO ini (persetujuan/percobaan ulang tidak membuat harga ganda)",
});
const STATUS_UBAH = new Set(["BARU", "NAIK", "TURUN"]);
const STATUS_KONFLIK = new Set(["KONFLIK_HARGA_BEDA", "KONVERSI_TIDAK_ADA", "KONVERSI_TIDAK_SAH"]);
export const ATURAN_TEKS = Object.freeze([
  "Draf PO tidak mengubah harga. Harga baru dicatat HANYA saat PO disetujui, berlaku sejak saat persetujuan, dengan sumber “Dari PO … — belum diterima”.",
  "Harga ditulis per SATUAN STOK. Bila PO memakai satuan beli lain (BOX/CAN/…), hanya faktor konversi yang tersimpan di baris PO yang dipakai; tanpa faktor yang sah, bahan itu menjadi konflik dan harganya tidak diubah.",
  "Ini HPP operasional (harga kerja). Tidak menambah stok, tidak mengubah nilai persediaan/valuasi Finance, tidak membuat jurnal, dan tidak menghitung ulang pemakaian lama.",
  "Pembatalan PO tidak menghapus riwayat harga dan tidak mengembalikan harga lama. Gunakan Ubah harga bila harga perlu diubah.",
]);

const satuanSama = (a, b) => String(a ?? "").toUpperCase() === String(b ?? "").toUpperCase();

/** Harga satu baris PO dalam SATUAN STOK. Kembalian: { ok, hargaEksak, harga(4dp), faktor, dibulatkan } | { ok:false, status, alasan }. */
export function hargaStokBaris(baris, bahan) {
  const beli = D(baris.unitPrice);
  if (satuanSama(baris.unit, bahan.unit)) return { ok: true, hargaEksak: beli, harga: beli.toDecimalPlaces(4), faktor: null, dibulatkan: false };
  if (!baris.purchaseUnit || baris.conversionFactor == null) return { ok: false, status: "KONVERSI_TIDAK_ADA", alasan: `Harga PO per ${baris.unit}, satuan stok ${bahan.unit}, tidak ada faktor konversi di baris PO. Harga per ${baris.unit} tidak ditulis sebagai harga per ${bahan.unit}.` };
  if (!satuanSama(baris.purchaseUnit, baris.unit)) return { ok: false, status: "KONVERSI_TIDAK_SAH", alasan: `Satuan beli ${baris.purchaseUnit} tidak sama dengan satuan baris ${baris.unit}.` };
  let f; try { f = validasiFaktor(baris.unit, bahan.unit, baris.conversionFactor); } catch (e) { return { ok: false, status: "KONVERSI_TIDAK_SAH", alasan: e?.message || "Faktor konversi tidak sah" }; }
  const eksak = beli.dividedBy(f); const bulat = eksak.toDecimalPlaces(4);
  return { ok: true, hargaEksak: eksak, harga: bulat, faktor: f, dibulatkan: !eksak.equals(bulat) };
}

const urut = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Rencana pembaruan harga dari PO (BACA-SAJA; dipakai pratinjau dan persetujuan). Satu baris hasil per BAHAN.
 * `revisi` = nomor revisi harga PO (0 = persetujuan awal) — bagian dari kunci idempotensi.
 */
export async function rencanaHargaPO(db, poId, { revisi = 0, sekarang = new Date() } = {}) {
  const po = await db.finPurchaseOrder.findUnique({ where: { id: poId }, include: { supplier: { select: { name: true } }, lines: { orderBy: { sortOrder: "asc" }, include: { material: { select: { id: true, code: true, name: true, unit: true, active: true } } } } } });
  if (!po) throw gagal("PO tidak ditemukan", 404, "PO_TIDAK_ADA");
  const per = new Map(); po.lines.forEach((l, i) => { const a = per.get(l.materialId) ?? []; a.push({ l, no: i + 1 }); per.set(l.materialId, a); });
  const baris = [];
  for (const [materialId, daftar] of [...per.entries()].sort((a, b) => urut(a[0], b[0]))) {
    const bahan = daftar[0].l.material; const idBaris = daftar.map((x) => x.l.id).sort();
    const hitung = daftar.map(({ l, no }) => ({ l, no, h: hargaStokBaris(l, bahan) }));
    const rincian = hitung.map(({ l, no, h }) => ({ barisPO: no, qty: Number(l.qty), satuanBeli: l.unit, hargaBeli: l.unitPrice, faktor: l.conversionFactor == null ? null : Number(l.conversionFactor), hargaStok: h.ok ? Number(h.harga) : null, masalah: h.ok ? null : h.status }));
    const dasar = { materialId, kode: bahan.code, nama: bahan.name, satuanStok: bahan.unit, barisPO: daftar.map((x) => x.no), rincian, kunci: `${AWALAN_KUNCI_PO}${poId}:${idBaris[0]}:r${revisi}`, poLineIds: idBaris };
    const buruk = hitung.find((x) => !x.h.ok);
    if (buruk) { baris.push({ ...dasar, status: buruk.h.status, alasan: buruk.h.alasan, hargaLama: null, hargaBaru: null }); continue; }
    const beda = new Set(hitung.map((x) => x.h.harga.toString()));
    if (beda.size > 1) { baris.push({ ...dasar, status: "KONFLIK_HARGA_BEDA", alasan: `Bahan ini ada di baris ${dasar.barisPO.join(", ")} dengan harga per ${bahan.unit} berbeda (${[...beda].join(" / ")}). Gabungkan menjadi satu baris atau samakan harganya.`, hargaLama: null, hargaBaru: null }); continue; }
    const h = hitung[0].h; const kead = await keadaanHarga(db, materialId, sekarang); const lama = kead.berlaku ? D(kead.berlaku.unitPrice) : null;
    const sudah = await db.materialHargaBerlaku.findUnique({ where: { idempotencyKey: dasar.kunci }, select: { id: true, unitPrice: true } });
    let status = !lama ? "BARU" : h.harga.greaterThan(lama) ? "NAIK" : h.harga.lessThan(lama) ? "TURUN" : "SAMA";
    if (sudah) status = "SUDAH_DITERAPKAN";
    const selisihPersen = lama && lama.greaterThan(0) ? Number(h.harga.minus(lama).dividedBy(lama).times(100).toDecimalPlaces(1)) : null;
    const peringatan = [];
    if (kead.terjadwal.length) peringatan.push({ kode: "ADA_HARGA_TERJADWAL", pesan: `Ada harga terjadwal ${Number(kead.terjadwal[0].unitPrice).toLocaleString("id-ID")} mulai ${new Date(kead.terjadwal[0].effectiveFrom).toISOString()} — tetap berlaku dan akan menggantikan harga dari PO ini pada waktunya.` });
    if (selisihPersen != null && Math.abs(selisihPersen) >= 30 && STATUS_UBAH.has(status)) peringatan.push({ kode: "SELISIH_BESAR", pesan: `Harga ${selisihPersen > 0 ? "naik" : "turun"} ${Math.abs(selisihPersen)}% — periksa satuan (${bahan.unit}) dan faktor konversi.` });
    if (h.dibulatkan) peringatan.push({ kode: "DIBULATKAN_4_DESIMAL", pesan: `Harga per ${bahan.unit} hasil bagi ${h.hargaEksak.toDecimalPlaces(8).toString()} dibulatkan ke 4 desimal (${h.harga.toString()}).` });
    if (!bahan.active) peringatan.push({ kode: "BAHAN_NONAKTIF", pesan: "Bahan nonaktif." });
    baris.push({ ...dasar, status, alasan: STATUS_BARIS[status], hargaLama: lama ? Number(lama) : null, hargaLamaId: kead.berlaku?.id ?? null, hargaBaru: Number(h.harga), hargaBaruEksak: h.hargaEksak.toDecimalPlaces(8).toString(), dibulatkan: h.dibulatkan, selisihPersen, hargaBeli: daftar[0].l.unitPrice, satuanBeli: daftar[0].l.unit, faktor: h.faktor ? Number(h.faktor) : null, peringatan, hargaTerjadwal: kead.terjadwal.map((x) => ({ harga: Number(x.unitPrice), mulai: x.effectiveFrom })) });
  }
  const hitungStatus = (s) => baris.filter((b) => b.status === s).length;
  const ringkas = { bahan: baris.length, baru: hitungStatus("BARU"), naik: hitungStatus("NAIK"), turun: hitungStatus("TURUN"), sama: hitungStatus("SAMA"), sudahDiterapkan: hitungStatus("SUDAH_DITERAPKAN"), konflik: baris.filter((b) => STATUS_KONFLIK.has(b.status)).length };
  ringkas.akanMengubahHarga = ringkas.baru + ringkas.naik + ringkas.turun;
  const hash = sha({ po: po.id, revisi, b: baris.map((b) => [b.materialId, b.status, b.hargaBaru, b.hargaLamaId ?? null, b.kunci]) }); // hash dihitung menurut urutan materialId (tetap); tampilan menurut urutan baris PO
  const urutTampil = [...baris].sort((a, b) => a.barisPO[0] - b.barisPO[0]);
  return { po: { id: po.id, poNumber: po.poNumber, status: po.status, supplier: po.supplier.name }, revisi, sumberTeks: teksSumberPO(po.poNumber, "DISETUJUI"), aktif: hargaDariPoAktif(), baris: urutTampil, ringkas, hash, aturan: ATURAN_TEKS, sekarang: sekarang.toISOString() };
}

/**
 * Terapkan rencana saat PO disetujui — DI DALAM transaksi persetujuan (pemanggil sudah mengunci baris PO). Lewat layanan resmi (pratinjau + simpan ber-hash).
 *   bolehEditHarga: penyetuju punya finance:harga_berlaku:edit · hashPratinjau: hash rencana yang dilihat penyetuju · lewatiBahan: materialId konflik yang DIPILIH dilewati.
 * Kembalian: ringkasan hasil per bahan untuk riwayat PO dan respons API.
 */
export async function terapkanHargaPO(tx, { poId, aktor, bolehEditHarga, hashPratinjau = null, wajibHash = true, lewatiBahan = [], revisi = 0 }) {
  if (!hargaDariPoAktif()) return { aktif: false, diterapkan: [], dilewati: [], tidakBerubah: [] };
  const ids = (await tx.finPurchaseOrderLine.findMany({ where: { purchaseOrderId: poId }, select: { materialId: true } })).map((x) => x.materialId);
  for (const id of [...new Set(ids)].sort()) await lockRowForUpdate(tx, "materials", id); // urutan tetap ⇒ dua PO serentak tidak saling kunci-mati; rencana dihitung SETELAH kunci
  const rencana = await rencanaHargaPO(tx, poId, { revisi });
  const lewati = new Set((Array.isArray(lewatiBahan) ? lewatiBahan : []).map(String));
  const konflikTerbuka = rencana.baris.filter((b) => STATUS_KONFLIK.has(b.status) && !lewati.has(b.materialId));
  if (konflikTerbuka.length) throw gagal(`Ada ${konflikTerbuka.length} bahan dengan konflik harga/satuan di PO ini. Selesaikan di draf (satukan baris, isi faktor konversi) atau pilih “lewati pembaruan harga” untuk bahan tersebut sebelum menyetujui.`, 409, "HARGA_PO_KONFLIK", { konflik: konflikTerbuka.map((b) => ({ materialId: b.materialId, kode: b.kode, status: b.status, alasan: b.alasan })) });
  const ubah = rencana.baris.filter((b) => STATUS_UBAH.has(b.status));
  if (ubah.length) {
    if (!bolehEditHarga) throw gagal(`PO ini akan memperbarui Harga Berlaku ${ubah.length} bahan. Persetujuan PO yang mengubah harga hanya untuk Finance/Owner (izin finance:harga_berlaku:edit); Admin tanpa peran itu hanya dapat melihat. Minta Finance/Owner menyetujui.`, 403, "HARGA_PO_BUTUH_IZIN_HARGA");
    if (!hashPratinjau && wajibHash) throw gagal("Persetujuan PO ini mengubah Harga Berlaku. Buka pratinjau harga lama → baru dan setujui dari sana.", 409, "PRATINJAU_HARGA_PO_WAJIB", { pratinjau: rencana });
    if (hashPratinjau && String(hashPratinjau) !== rencana.hash) throw gagal("Pratinjau harga yang Anda lihat sudah berbeda dari keadaan sekarang (harga bahan berubah atau isian PO berubah). Muat ulang pratinjau lalu setujui lagi.", 409, "PRATINJAU_BERUBAH", { pratinjau: rencana });
  }
  const diterapkan = []; const dilewatiOut = []; const tidakBerubah = [];
  for (const b of rencana.baris) {
    if (STATUS_KONFLIK.has(b.status)) { dilewatiOut.push({ materialId: b.materialId, kode: b.kode, status: b.status, alasan: b.alasan }); continue; }
    if (!STATUS_UBAH.has(b.status)) { tidakBerubah.push({ materialId: b.materialId, kode: b.kode, status: b.status, harga: b.hargaBaru }); continue; }
    const masukan = { materialId: b.materialId, hargaBaru: String(b.hargaBaru), satuan: b.satuanStok, berlakuMulai: null, alasan: teksSumberPO(rencana.po.poNumber, "DISETUJUI"),
      catatan: `Baris PO ${b.barisPO.join(", ")}: ${b.hargaBeli} per ${b.satuanBeli}${b.faktor ? ` ÷ faktor ${b.faktor} ${b.satuanStok}/${b.satuanBeli}` : ""} = ${b.hargaBaru} per ${b.satuanStok}`, catatanBukti: null };
    const pra = await pratinjauUbahHarga(tx, masukan, { lengkap: false });
    const sumber = { sumber: "PO", poId, poNumber: rencana.po.poNumber, poLineIds: b.poLineIds, revisi, hargaBeli: b.hargaBeli, satuanBeli: b.satuanBeli, faktor: b.faktor, hargaStokEksak: b.hargaBaruEksak, dibulatkan: b.dibulatkan, hargaLama: b.hargaLama };
    const hasil = await simpanHargaDiTx(tx, { ...masukan, hashPratinjau: pra.hash }, { aktor, kunci: b.kunci, sumber });
    diterapkan.push({ materialId: b.materialId, kode: b.kode, status: b.status, hargaLama: b.hargaLama, hargaBaru: b.hargaBaru, satuan: b.satuanStok, hargaId: hasil.id, ulang: hasil.ulang });
  }
  return { aktif: true, revisi, diterapkan, dilewati: dilewatiOut, tidakBerubah, hash: rencana.hash };
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
