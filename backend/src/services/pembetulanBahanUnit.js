// PEMBETULAN BAHAN PER ORDER dari drawer Order Produksi — termasuk unit yang sudah selesai/terkirim (Okt 2026).
// File ini TIDAK menulis apa pun. Ia (1) menjaga aturan alasan wajib untuk unit selesai, dan (2) menghitung PRATINJAU dampak (stok, jurnal/nilai Finance, HPP operasional) sebelum pengguna
// mengonfirmasi lewat layanan resmi yang SUDAH ada:
//   • tambah / kurangi pengeluaran stok  -> POST /api/units/:id/materials (postStockMovement + bukukanNilaiPergerakanBaru; pengurangan = pengembalian BARU, baris asal tetap)
//   • catat pemakaian sementara           -> POST /api/production/units/:id/provisional-usages (tanpa stok)
//   • koreksi jumlah (butuh persetujuan)  -> POST /api/production/units/:id/koreksi-pemakaian (penyetuju ≠ pemohon)
//   • koreksi catatan belum diposting     -> POST /api/production/catatan-historis/:id/koreksi (tanpa stok)
import { computeStockSnapshot } from "./inventoryLedger.js";
import { dasarHargaRataRata } from "./finance/posting/inventory.js";
import { statusCutoverUntuk } from "./finance/persediaanAwal.js";
import { hargaBerlakuPada } from "./finance/hargaBerlaku.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";

export class PembetulanError extends Error {
  constructor(message, statusCode = 400, code = null, detail = null) { super(message); this.statusCode = statusCode; this.code = code; this.detail = detail; }
}
const wajib = (c, m, code, status = 400, detail = null) => { if (!c) throw new PembetulanError(m, status, code, detail); };
const r4 = (v) => Math.round(Number(v ?? 0) * 10000) / 10000;
const EPS = 1e-6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rp = (n) => `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;

/** Unit yang pemakaiannya normalnya sudah terkunci di layar (selesai/terkirim atau dibatalkan). */
export const STATUS_UNIT_SELESAI = Object.freeze(["DELIVERED", "CANCELLED"]);
export const unitSelesai = (status) => STATUS_UNIT_SELESAI.includes(status);
export const LABEL_STATUS_SELESAI = Object.freeze({ DELIVERED: "terkirim", CANCELLED: "dibatalkan" });

/**
 * Alasan pembetulan WAJIB (5–500 karakter) bila unit sudah selesai/terkirim/dibatalkan. Mengembalikan teks alasan ('' bila unit masih aktif dan alasan tidak diberikan).
 * Dipakai route yang SUDAH ada agar akses ke unit selesai selalu berjejak: alasan masuk ke catatan pergerakan stok / catatan pemakaian sementara dan ke log aktivitas unit.
 */
export function alasanPembetulan(unitStatus, alasan) {
  const t = String(alasan ?? "").trim();
  if (unitSelesai(unitStatus)) {
    wajib(t.length >= 5 && t.length <= 500, `Unit ini sudah ${LABEL_STATUS_SELESAI[unitStatus]}. Pembetulan bahan wajib disertai alasan (5–500 karakter) agar riwayatnya jelas.`, "UNIT_ALASAN_PEMBETULAN_WAJIB", 400);
  } else if (t) wajib(t.length <= 500, "Alasan maksimal 500 karakter", "UNIT_ALASAN_TERLALU_PANJANG", 400);
  return t;
}
/** Awalan baku pada catatan agar pembetulan unit selesai mudah dicari di riwayat stok: "Pembetulan unit terkirim (RES-…): <alasan> | <catatan>". */
export function catatanPembetulan(unitStatus, unitCode, alasan, catatan = null) {
  if (!unitSelesai(unitStatus)) return catatan ?? null;
  return [`Pembetulan unit ${LABEL_STATUS_SELESAI[unitStatus]} (${unitCode}): ${alasan}`, catatan].filter(Boolean).join(" | ").slice(0, 480);
}

/**
 * Pratinjau dampak SATU pembetulan pengeluaran stok pada unit. Baca-saja. Menjawab sebelum konfirmasi:
 *   stok (sebelum/sesudah, cukup atau tidak), pemakaian bersih unit, nilai & jurnal Finance (apa yang akan lahir: jurnal / catatan celah), HPP operasional (harga berlaku SAAT INI, bukan saat unit dikerjakan),
 *   serta apa yang TIDAK berubah. jenis: TAMBAH (pengeluaran/ISSUE baru) | KURANGI (pengembalian/RETURN baru bertaut unit). qty selalu positif.
 */
export async function pratinjauPembetulan(db, user, { unitId, materialId, jenis, qty } = {}) {
  wajib(UUID.test(String(unitId ?? "")), "unit tidak valid", "UNIT_TIDAK_VALID");
  wajib(UUID.test(String(materialId ?? "")), "bahan tidak valid", "BAHAN_TIDAK_VALID");
  wajib(["TAMBAH", "KURANGI"].includes(jenis), "jenis harus TAMBAH atau KURANGI", "JENIS_TIDAK_VALID");
  const q = Number(qty); wajib(Number.isFinite(q) && q > 0 && q <= 1_000_000, "Jumlah harus angka lebih dari 0", "QTY_TIDAK_VALID");
  wajib(Math.abs(r4(q) - q) < 1e-9, "Jumlah maksimum 4 angka di belakang koma", "DESIMAL_BERLEBIH");
  const unit = await db.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, order: { select: { orderNumber: true, status: true } } } });
  wajib(unit, "Unit tidak ditemukan", "UNIT_TIDAK_ADA", 404);
  const m = await db.material.findUnique({ where: { id: materialId }, select: { id: true, code: true, name: true, unit: true, active: true } });
  wajib(m, "Bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  const sekarang = new Date();
  const snap = (await computeStockSnapshot(db)).find((x) => x.materialId === materialId);
  const [{ n }] = await db.$queryRaw`SELECT COUNT(*)::int AS n FROM stock_movements WHERE material_id = ${materialId}::uuid`;
  const net = await db.stockMovement.aggregate({ where: { unitId, materialId, type: { in: ["ISSUE", "RETURN", "WASTE"] } }, _sum: { qty: true } });
  const pemakaianSebelum = r4(-Number(net._sum.qty ?? 0));
  const saldo = r4(snap?.balance ?? 0); const dipesan = r4(snap?.reserved ?? 0);
  const delta = jenis === "TAMBAH" ? q : -q; // + = pemakaian naik (stok turun)
  const saldoSesudah = r4(saldo - delta); const pemakaianSesudah = r4(pemakaianSebelum + delta);
  const penghalang = [];
  if (!m.active) penghalang.push({ kode: "BAHAN_NONAKTIF", pesan: `Bahan ${m.code} nonaktif.` });
  if (jenis === "KURANGI" && q > pemakaianSebelum + 0.00005) penghalang.push({ kode: "UNIT_KOREKSI_MELEBIHI_PEMAKAIAN", pesan: `Pengembalian ${q} melebihi pemakaian bersih bahan ini pada unit (${Math.max(pemakaianSebelum, 0)} ${m.unit}).` });
  if (jenis === "TAMBAH" && n === 0) penghalang.push({ kode: "STOK_BELUM_DIKETAHUI", pesan: `Bahan ${m.code} belum punya catatan stok sama sekali — pengeluaran ditolak (tidak ada stok yang bisa dikurangi). Gunakan "Catat sementara — stok belum diketahui", atau minta Gudang mencatat stok awal/opname.` });
  else if (jenis === "TAMBAH" && saldoSesudah < -EPS) penghalang.push({ kode: "SALDO_KURANG", pesan: `Stok ${m.code} tidak cukup: tersedia ${saldo} ${m.unit}, butuh ${q}.` });
  // ── Finance: apa yang akan lahir dari pengeluaran/pengembalian BARU ini (sama dengan bukukanNilaiPergerakanBaru)
  const cut = await statusCutoverUntuk(db, sekarang);
  const harga = (await dasarHargaRataRata(db, materialId, { asOf: sekarang })).harga; const hargaNum = harga == null ? null : Number(harga);
  const nilai = hargaNum == null ? null : Math.round(q * hargaNum);
  let finance;
  if (cut.status === "tertutup") finance = { hasil: "TIDAK_DIJURNAL", teks: "Tanggal pergerakan sebelum cutover perpetual: nilainya sudah tercakup stok opname, tidak dijurnal lagi." };
  else if (cut.status === "tunggu_pembuka") finance = { hasil: "GAP_PERSEDIAAN_AWAL", teks: "Persediaan awal (stok opname) belum diposting: TIDAK ada jurnal; lahir catatan celah PERSEDIAAN_AWAL_BELUM_DIPOSTING yang tampil di Finance dan dijurnal belakangan oleh Finance." };
  else if (hargaNum == null) finance = { hasil: "GAP_TANPA_HARGA", teks: "Bahan belum punya harga perolehan berbukti: TIDAK ada jurnal (bukan Rp0); lahir catatan celah TANPA_HARGA_PEROLEHAN di Finance." };
  else finance = { hasil: "JURNAL", nilai, hargaDasar: hargaNum, teks: `Jurnal HPP bertanggal HARI INI sebesar ${rp(nilai)} (${q} ${m.unit} × ${rp(hargaNum)}): ${jenis === "TAMBAH" ? "beban pokok bahan naik, persediaan turun" : "beban pokok bahan turun, persediaan naik"}.` };
  // ── HPP operasional (Harga Berlaku): dibekukan pada harga berlaku SAAT pergerakan baru diposting
  const hb = await hargaBerlakuPada(db, materialId, sekarang);
  const hpp = hb
    ? { dibekukan: true, harga: Number(hb.harga), label: hb.label, nilai: Math.round(q * Number(hb.harga)), teks: `HPP operasional order ini ${jenis === "TAMBAH" ? "bertambah" : "berkurang"} ${rp(q * Number(hb.harga))} (${q} ${m.unit} × ${rp(hb.harga)}, harga berlaku SAAT INI — bukan harga saat unit dikerjakan).` }
    : { dibekukan: false, harga: null, label: null, nilai: null, teks: "Belum ada Harga Berlaku untuk bahan ini: pembetulan dibekukan TANPA harga operasional (bukan Rp0); HPP operasional order tidak berubah." };
  const finalOrder = unit.order?.status === "DELIVERED" || unit.status === "DELIVERED";
  const dampak = [
    `Stok ${m.code}: ${saldo} → ${saldoSesudah} ${m.unit}${snap && dipesan > 0 ? ` (dipesan ${dipesan}; tersedia ${r4(saldoSesudah - dipesan)})` : ""}.`,
    `Pemakaian bersih bahan pada ${unit.unitCode}: ${pemakaianSebelum} → ${pemakaianSesudah} ${m.unit}.`,
    `Finance: ${finance.teks}`,
    `HPP operasional: ${hpp.teks}`,
    "Baris pemakaian yang sudah ada TIDAK diubah atau dihapus; pembetulan menjadi baris BARU di riwayat. Nilai beku pemakaian lama tidak berubah.",
  ];
  if (finalOrder) dampak.push(`Order ${unit.order?.orderNumber ?? ""} sudah ${LABEL_STATUS_SELESAI[unit.status] ?? "terkirim"}: angka HPP/pemakaian order ini akan berubah sesudah pembetulan.`);
  return {
    unit: { id: unit.id, kode: unit.unitCode, status: unit.status, selesai: unitSelesai(unit.status), order: unit.order?.orderNumber ?? null },
    bahan: { id: m.id, kode: m.code, nama: m.name, satuan: m.unit }, jenis, qty: r4(q),
    stok: { saldoSebelum: n > 0 ? saldo : null, saldoSesudah, dipesan, belumAdaCatatan: n === 0 }, pemakaianBersih: { sebelum: pemakaianSebelum, sesudah: pemakaianSesudah },
    finance, hppOperasional: hpp, dampak, penghalang, boleh: penghalang.length === 0,
    alasanWajib: unitSelesai(unit.status),
    izin: { bolehMencatat: hasPermission(user, P.UNIT_MATERIAL_WRITE), bolehMengajukanKoreksiJumlah: hasPermission(user, P.INVENTORY_WRITE) || hasPermission(user, P.UNIT_MATERIAL_WRITE), penyetujuKoreksi: "Owner atau Finance (orang lain dari pemohon)" },
  };
}
