// HPP PER ORDER (Nov 2026) — antrean PIC, biaya bahan per order TANPA stok (pemakaian pra-SO), konfirmasi pemakaian lengkap, dan laporan berdampingan.
//
// BATAS YANG DIJAGA (lihat lib/domain/hppOrder.js untuk aturan murni):
//   • Tidak ada pergerakan stok, jurnal, saldo kas/bank, PSA, atau cutover yang ditulis modul ini. Tulisan HANYA ke order_biaya_tanpa_stok(+events) dan unit_hpp_konfirmasi.
//   • Jalur dipilih TANGGAL PEMAKAIAN terhadap tanggal SO yang ditautkan ke bahan (periksaPraSO — aturan yang sama dengan penolakan 409 UNIT_PEMAKAIAN_PRA_SO):
//       sesudah SO / tanpa tautan → pengeluaran stok resmi (pembetulan unit yang sudah ada; modul ini menolak dengan JALUR_STOK_RESMI),
//       pada/sebelum SO           → biaya tanpa stok di sini.
//   • Tidak menebak jumlah, tanggal, atau harga. Harga = Harga Berlaku pada AWAL tanggal pemakaian yang dilaporkan (fungsi yang sama dengan pembetulan unit terkirim); belum ada → TANPA_HARGA (null, bukan Rp0).
//   • Biaya tanpa stok berlaku (masuk HPP operasional) hanya sesudah DISETUJUI orang lain dari pengaju; koreksi = entri pengganti; tidak ada hapus (trigger database).
import crypto from "node:crypto";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { hasPermission } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";
import { TIPE_OP, hargaUntukPergerakan, penyelesaiHargaBerlaku, hargaBerubahPadaHari, teksDasarHarga } from "./hargaBerlaku.js";
import { periksaPraSO, sudahTercatatUntuk, tanggalDilaporkan, catatanPembetulan } from "../pembetulanBahanUnit.js";
import { tautanSOAktif } from "../pengamanHistorisPascaSO.js";
import { terapkanKeadaanEfektif } from "../catatanPemakaianHistoris.js";
import { aturanBerlaku, aturanUntukBahan, konversiKeStok } from "../../lib/domain/satuanPakaiBahan.js";
import { bacaPenimpaanSatuanPakai } from "../satuanPakaiService.js";
import { barisPergerakan, wibKeyDari } from "../../lib/domain/laporanProduksi.js";
import { JALUR, STATUS_UNIT, statusUnitHpp, statusOrderHpp, tentukanJalur, hasilManajemen } from "../../lib/domain/hppOrder.js";
import { labaRugi } from "./reports.js";
import { muatBarisLabaRugi } from "./laporanTerinci/baris.js";
import { jalankanBacaSaja, periodeValid } from "./laporanTerinci/index.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../../utils/wib.js";
import { sumMoney, moneyToNumber, Decimal } from "./money.js";

export class HppOrderError extends Error {
  constructor(message, statusCode = 400, code = null, detail = null) { super(message); this.statusCode = statusCode; this.code = code; this.detail = detail; }
}
const wajib = (c, m, code, status = 400, detail = null) => { if (!c) throw new HppOrderError(m, status, code, detail); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const r2 = (v) => Math.round(Number(v) * 100) / 100;
const r4 = (v) => Math.round(Number(v) * 10000) / 10000;
const tglDate = (t) => new Date(`${t}T00:00:00.000Z`);
const tglStr = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const AKTIF = ["DIAJUKAN", "DISETUJUI"];
export const SUMBER_JENIS = Object.freeze({ CATATAN_HISTORIS: "Catatan pemakaian historis (Excel Admin)", LAPORAN_PIC: "Laporan PIC produksi", DOKUMEN: "Dokumen/foto kerja" });
const STATE_CATATAN_TERTAHAN = ["PERLU_DICEK", "SIAP_POSTING"];

export const bolehMencatat = (u) => hasPermission(u, P.UNIT_MATERIAL_WRITE);
export const bolehMenyetujui = (u) => hasPermission(u, P.FINANCE_APPROVE);
export const bolehNominal = (u) => hasPermission(u, P.FINANCE_READ);

// ───────────────────────────── pemuatan baris biaya per unit (BACA-SAJA) ─────────────────────────────
/** Baris biaya + fakta kelengkapan untuk banyak unit sekaligus. db = prisma (catatan historis memakai keadaan efektif yang membuka transaksinya sendiri). */
export async function muatBiayaUnit(db, unitIds) {
  const peta = new Map(); if (!unitIds?.length) return peta;
  for (const id of unitIds) peta.set(id, { stok: [], biaya: [], diajukan: [], catatanTertahan: [], sementara: 0, pernyataan: null, konfirmasi: null });
  const [mv, biaya, notes, sem, pern, konf] = await Promise.all([
    db.stockMovement.findMany({ where: { unitId: { in: unitIds }, type: { in: TIPE_OP } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, type: true, qty: true, createdAt: true, note: true, materialId: true, unitId: true, correctsMovementId: true, material: { select: { code: true, name: true, unit: true } },
        biayaOperasional: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { status: true, unitCost: true, value: true, priceEffectiveFrom: true, basisHarga: true, sumber: true, evidenceLabel: true } } } }),
    db.orderBiayaTanpaStok.findMany({ where: { unitId: { in: unitIds }, status: { in: AKTIF } }, orderBy: [{ diajukanPada: "asc" }], include: { material: { select: { code: true, name: true, unit: true } } } }),
    db.unitUsageNote.findMany({ where: { unitId: { in: unitIds } }, select: { id: true, unitId: true, state: true, origin: true, flags: true, materialId: true, qty: true, usedAt: true, rawName: true } }),
    db.unitProvisionalUsage.groupBy({ by: ["unitId"], where: { unitId: { in: unitIds }, status: "PERLU_REKONSILIASI" }, _count: { _all: true } }),
    db.unitMaterialDeclaration.findMany({ where: { unitId: { in: unitIds }, status: "ACTIVE" }, select: { unitId: true, kind: true, reason: true, declaredAt: true } }),
    db.unitHppKonfirmasi.findMany({ where: { unitId: { in: unitIds }, status: "ACTIVE" }, select: { id: true, unitId: true, sidik: true, dikonfirmasiOleh: true, dikonfirmasiPada: true, alasan: true } }),
  ]);
  for (const m of mv) {
    const b = barisPergerakan({ id: m.id, type: m.type, qty: m.qty, createdAt: m.createdAt, note: m.note, materialId: m.materialId, unitId: m.unitId, correctsMovementId: m.correctsMovementId, materialKode: m.material.code, materialNama: m.material.name, materialSatuan: m.material.unit }, m.biayaOperasional[0] ?? null);
    peta.get(m.unitId).stok.push({ ...b, sumber: "STOK", id: m.id });
  }
  const sumberAktif = new Set();
  for (const e of biaya) {
    const x = peta.get(e.unitId); if (e.sumberJenis === "CATATAN_HISTORIS" && e.sumberRef) sumberAktif.add(e.sumberRef);
    const baris = tampilBiaya(e);
    if (e.status === "DISETUJUI") x.biaya.push(baris); else x.diajukan.push(baris);
  }
  for (const n of await terapkanKeadaanEfektif(db, notes)) {
    if (!n.unitId || !STATE_CATATAN_TERTAHAN.includes(n.state) || sumberAktif.has(n.id)) continue; // catatan yang sudah menjadi sumber biaya aktif tidak dihitung dua kali
    peta.get(n.unitId)?.catatanTertahan.push({ id: n.id, state: n.state, materialId: n.materialId, qty: n.qty == null ? null : Number(n.qty), tanggal: n.usedAt ? wibKeyDari(n.usedAt) : null, nama: n.rawName ?? null });
  }
  for (const s of sem) peta.get(s.unitId).sementara = s._count._all;
  for (const p of pern) if (p.kind === "TANPA_BAHAN_BARU") peta.get(p.unitId).pernyataan = p;
  for (const k of konf) peta.get(k.unitId).konfirmasi = k;
  return peta;
}

/** Satu entri biaya tanpa stok dalam bentuk baris biaya (selaras barisPergerakan: status DIBEKUKAN bila bernilai). */
function tampilBiaya(e) {
  const dinilai = e.statusHarga === "DINILAI";
  return {
    id: e.id, sumber: "BIAYA_TANPA_STOK", movementId: null, unitId: e.unitId, materialId: e.materialId, kode: e.material?.code ?? null, bahan: e.material?.name ?? null, satuan: e.satuan,
    jenis: "BIAYA_TANPA_STOK", tipe: "BIAYA_TANPA_STOK", qty: Number(e.qty), arah: "KELUAR", harga: dinilai ? Number(e.hargaSatuan) : null, subtotal: dinilai ? Number(e.nilai) : null,
    tanggalPemakaian: tglStr(e.tanggalPemakaian), dasarTanggal: "TANGGAL_DILAPORKAN", soTanggal: tglStr(e.soTanggal), status: dinilai ? "DIBEKUKAN" : "TANPA_HARGA", termasukHpp: dinilai,
    statusEntri: e.status, sumberJenis: e.sumberJenis, sumberRef: e.sumberRef, bukti: e.bukti, alasan: e.alasan, diajukanOleh: e.diajukanOleh, diajukanPada: e.diajukanPada,
    diputuskanOleh: e.diputuskanOleh, diputuskanPada: e.diputuskanPada, menggantikanId: e.menggantikanId, basisHarga: e.basisHarga,
  };
}

/** Status HPP per unit dari hasil muatBiayaUnit. Baris yang dinilai = pergerakan unit bertipe biaya (tanpa SUSUT) + biaya tanpa stok DISETUJUI. */
export function statusDariFakta(f) {
  const baris = [...f.stok.filter((b) => b.tipe !== "WASTE"), ...f.biaya].map((b) => ({ id: b.id, sumber: b.sumber, status: b.status, subtotal: b.subtotal }));
  return statusUnitHpp({ baris, catatanTertahan: f.catatanTertahan.length, sementara: f.sementara, biayaDiajukan: f.diajukan.length, pernyataanTanpaBahan: !!f.pernyataan, konfirmasi: f.konfirmasi });
}

// ───────────────────────────── ANTREAN PIC (BACA-SAJA) ─────────────────────────────
/** Unit yang pengirimannya selesai pada periode (job DELIVERY COMPLETED — dasar yang sama dengan HPP laporan terinci). */
async function unitTerkirimPeriode(db, { fromStr, toStr }) {
  const jobs = await db.job.findMany({ where: { type: "DELIVERY", status: "COMPLETED", completedAt: { gte: startOfDayWIB(fromStr), lt: endOfDayExclusiveWIB(toStr) } },
    select: { completedAt: true, orderId: true, units: { select: { unitId: true } } }, orderBy: { completedAt: "asc" } });
  const diserahkan = new Map(); let jobTanpaUnit = 0;
  for (const j of jobs) { if (!j.units.length) { jobTanpaUnit += 1; continue; } for (const u of j.units) if (!diserahkan.has(u.unitId)) diserahkan.set(u.unitId, j.completedAt); }
  return { diserahkan, jobTanpaUnit };
}

export async function antreanHpp(db, { fromStr, toStr, izinHarga = false, status = "", q = "" } = {}) {
  periodeValid({ fromStr, toStr });
  const { diserahkan, jobTanpaUnit } = await unitTerkirimPeriode(db, { fromStr, toStr });
  const ids = [...diserahkan.keys()];
  const units = ids.length ? await db.unit.findMany({ where: { id: { in: ids } }, select: { id: true, unitCode: true, status: true, createdAt: true, orderId: true, order: { select: { orderNumber: true, status: true, customer: { select: { name: true } } } } } }) : [];
  const fakta = await muatBiayaUnit(db, ids);
  const tautan = await tautanSOAktif(db);
  const soTanggal = [...new Set([...tautan.values()].map((t) => t.soTanggal).filter(Boolean))].sort();
  const baris = units.map((u) => {
    const f = fakta.get(u.id); const st = statusDariFakta(f);
    const semua = [...f.stok.filter((b) => b.tipe !== "WASTE"), ...f.biaya];
    return {
      unitId: u.id, unitKode: u.unitCode, statusUnit: u.status, orderId: u.orderId, orderNomor: u.order?.orderNumber ?? null, statusOrder: u.order?.status ?? null, pelanggan: u.order?.customer?.name ?? null,
      diserahkan: wibKeyDari(diserahkan.get(u.id)), unitDibuat: wibKeyDari(u.createdAt),
      pemakaian: { baris: semua.length, stok: f.stok.filter((b) => b.tipe === "ISSUE").length, biayaTanpaStok: f.biaya.length, bahan: [...new Set(semua.map((b) => b.kode).filter(Boolean))] },
      biayaKosong: semua.filter((b) => b.status !== "DIBEKUKAN").length, catatanTertahan: f.catatanTertahan.length, sementara: f.sementara, biayaDiajukan: f.diajukan.length,
      konfirmasi: f.konfirmasi ? { oleh: f.konfirmasi.dikonfirmasiOleh, pada: f.konfirmasi.dikonfirmasiPada, basi: st.key === "KONFIRMASI_BASI" } : null,
      pernyataanTanpaBahan: !!f.pernyataan, status: st.key, statusLabel: st.label, tone: st.tone, lengkap: st.lengkap, langkah: st.langkah, sidik: st.sidik,
      nilaiDiketahui: izinHarga ? st.nilaiDiketahui : null,
      adaPemakaian: semua.length > 0,
    };
  });
  const kata = String(q).trim().toLowerCase();
  let tampil = baris;
  if (kata) tampil = tampil.filter((b) => [b.orderNomor, b.unitKode, b.pelanggan].some((t) => String(t ?? "").toLowerCase().includes(kata)));
  const st = String(status).split(",").map((s) => s.trim()).filter(Boolean);
  if (st.length) tampil = tampil.filter((b) => st.includes(b.status));
  const urut = { BELUM_ADA_PEMAKAIAN: 0, BELUM_LENGKAP: 1, KONFIRMASI_BASI: 2, MENUNGGU_PERSETUJUAN: 3, SIAP_DIKONFIRMASI: 4, LENGKAP: 5, TANPA_BAHAN_BARU: 6 };
  tampil = [...tampil].sort((a, b) => (urut[a.status] - urut[b.status]) || a.diserahkan.localeCompare(b.diserahkan) || String(a.orderNomor).localeCompare(String(b.orderNomor)));
  const perStatus = Object.fromEntries(Object.keys(STATUS_UNIT).map((k) => [k, baris.filter((b) => b.status === k).length]));
  return {
    periode: { from: fromStr, to: toStr }, dasar: "Unit yang pengirimannya selesai (job Delivery COMPLETED) pada periode — hari kalender WIB",
    ringkasan: { unit: baris.length, order: new Set(baris.map((b) => b.orderId)).size, adaPemakaian: baris.filter((b) => b.adaPemakaian).length, hppLengkap: baris.filter((b) => b.lengkap).length,
      perStatus, jobTanpaUnit, nilaiDiketahui: izinHarga ? r2(baris.reduce((a, b) => a + (b.nilaiDiketahui ?? 0), 0)) : null },
    tautanSO: { jumlahBahan: tautan.size, tanggalSO: soTanggal, teks: soTanggal.length ? `Bahan bertaut SO: pemakaian bertanggal pada/sebelum ${soTanggal.join(", ")} dicatat sebagai biaya tanpa stok; sesudahnya sebagai pengeluaran stok resmi.` : "Belum ada bahan bertaut SO: semua pemakaian lewat pengeluaran stok resmi." },
    jalur: JALUR, status: STATUS_UNIT, baris: tampil,
    catatan: "Ada pemakaian ≠ HPP lengkap. Unit lengkap hanya bila semua baris bernilai, tidak ada catatan/biaya tertahan, dan PIC mengonfirmasi pemakaian lengkap (atau pernyataan tanpa bahan baru). Biaya kosong = belum diketahui, bukan Rp0.",
  };
}

/** Rincian satu unit untuk panel PIC: baris biaya, catatan tertahan (dengan jalur yang disarankan), biaya diajukan, konfirmasi. */
export async function rincianUnit(db, unitId, { izinHarga = false } = {}) {
  wajib(UUID.test(String(unitId ?? "")), "unit tidak valid", "UNIT_TIDAK_VALID");
  const u = await db.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, createdAt: true, orderId: true, order: { select: { orderNumber: true } } } });
  wajib(u, "Unit tidak ditemukan", "UNIT_TIDAK_ADA", 404);
  const f = (await muatBiayaUnit(db, [unitId])).get(unitId); const st = statusDariFakta(f);
  const tautan = await tautanSOAktif(db, [...new Set(f.catatanTertahan.map((c) => c.materialId).filter(Boolean))]);
  const sembunyi = (b) => (izinHarga ? b : { ...b, harga: null, subtotal: null });
  return {
    unit: { id: u.id, kode: u.unitCode, status: u.status, order: u.order?.orderNumber ?? null, orderId: u.orderId, dibuat: wibKeyDari(u.createdAt) }, status: st,
    baris: [...f.stok, ...f.biaya].map(sembunyi), diajukan: f.diajukan.map(sembunyi),
    catatanTertahan: f.catatanTertahan.map((c) => { const t = c.materialId ? tautan.get(c.materialId) : null; return { ...c, soTanggal: t?.soTanggal ?? null, jalurDisarankan: c.tanggal ? tentukanJalur({ tanggal: c.tanggal, soTanggal: t?.soTanggal ?? null }).key : null }; }),
    sementara: f.sementara, pernyataan: f.pernyataan, konfirmasi: f.konfirmasi,
  };
}

// ───────────────────────────── BIAYA TANPA STOK: pratinjau, ajukan, putuskan ─────────────────────────────
/** Harga beku untuk satu biaya tanpa stok: Harga Berlaku pada AWAL tanggal pemakaian (fungsi yang sama dengan pembetulan unit terkirim). */
async function hargaBiaya(db, { unit, materialId, tanggal, qty }) {
  const r = await hargaUntukPergerakan(db, { id: null, type: "ISSUE", materialId, unitId: unit.id, createdAt: new Date(), correctsMovementId: null, note: catatanPembetulan(unit.unitCode, "biaya tanpa stok", tanggal) }, penyelesaiHargaBerlaku(db));
  const berubah = await hargaBerubahPadaHari(db, materialId, tanggal);
  const sidik = [tanggal, r.ada ? r.harga.toString() : "TANPA", r.priceId ?? "-", r.basis].join("|");
  const nilai = r.ada ? new Decimal(String(qty)).times(r.harga).toDecimalPlaces(2) : null;
  return { ada: r.ada, harga: r.ada ? r.harga : null, priceId: r.ada ? r.priceId : null, basis: r.basis, nilai, sidik, dasarTeks: teksDasarHarga(r.basis, tanggal), berubahPadaHari: berubah };
}

/** Validasi bersama pratinjau + ajukan. Tidak menulis. */
async function periksaMasukan(db, user, m) {
  wajib(UUID.test(String(m.unitId ?? "")), "unit tidak valid", "UNIT_TIDAK_VALID");
  wajib(UUID.test(String(m.materialId ?? "")), "bahan tidak valid", "BAHAN_TIDAK_VALID");
  const unit = await db.unit.findUnique({ where: { id: m.unitId }, select: { id: true, unitCode: true, status: true, createdAt: true, orderId: true } });
  wajib(unit, "Unit tidak ditemukan", "UNIT_TIDAK_ADA", 404);
  wajib(unit.status !== "CANCELLED", "Unit dibatalkan: biaya bahan tidak dicatat.", "UNIT_DIBATALKAN", 409);
  const bahan = await db.material.findUnique({ where: { id: m.materialId }, select: { id: true, code: true, name: true, unit: true } });
  wajib(bahan, "Bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  const w = tanggalDilaporkan(m.tanggalPemakaian, { unitDibuat: unit.createdAt });
  const qIn = Number(m.qty); wajib(Number.isFinite(qIn) && qIn > 0 && qIn <= 1_000_000, "Jumlah harus angka lebih dari 0", "QTY_TIDAK_VALID");
  wajib(Math.abs(r4(qIn) - qIn) < 1e-9, "Jumlah maksimum 4 angka di belakang koma", "DESIMAL_BERLEBIH");
  const aturan = aturanUntukBahan(bahan, aturanBerlaku(await bacaPenimpaanSatuanPakai(db)));
  const kv = konversiKeStok({ qty: qIn, satuanInput: m.satuan ?? null, aturan, satuanStok: bahan.unit }); wajib(kv.ok, kv.pesan, kv.kode ?? "QTY_TIDAK_VALID");
  const qty = r4(kv.qtyStok);
  const sumberJenis = String(m.sumberJenis ?? ""); wajib(SUMBER_JENIS[sumberJenis], `Sumber wajib dipilih: ${Object.keys(SUMBER_JENIS).join(", ")}`, "SUMBER_WAJIB");
  const bukti = String(m.bukti ?? "").trim(); wajib(bukti.length >= 5 && bukti.length <= 500, "Bukti/rujukan wajib diisi (5–500 karakter): siapa yang melaporkan, dari dokumen/foto/catatan apa.", "BUKTI_WAJIB");
  const alasan = String(m.alasan ?? "").trim(); wajib(alasan.length >= 5 && alasan.length <= 500, "Alasan wajib diisi (5–500 karakter).", "ALASAN_WAJIB");
  // Jalur: aturan SAMA dengan penolakan pengeluaran pra-SO.
  const pra = await periksaPraSO(db, { materialId: bahan.id, tanggal: w.tanggal, jenis: "TAMBAH" });
  const jalur = tentukanJalur({ tanggal: w.tanggal, soTanggal: pra?.soTanggal ?? null });
  const tautan = pra ? (await tautanSOAktif(db, [bahan.id])).get(bahan.id) : null;
  let catatan = null;
  if (sumberJenis === "CATATAN_HISTORIS") {
    wajib(UUID.test(String(m.sumberRef ?? "")), "Pilih catatan pemakaian historis yang menjadi sumber.", "SUMBER_CATATAN_WAJIB");
    const n = await db.unitUsageNote.findUnique({ where: { id: m.sumberRef }, select: { id: true, unitId: true, orderId: true, materialId: true, qty: true, usedAt: true, state: true, origin: true, flags: true, stockMovementId: true } });
    wajib(n && (n.unitId === unit.id || (!n.unitId && n.orderId === unit.orderId)), "Catatan historis tidak ditemukan pada unit/order ini.", "SUMBER_CATATAN_TIDAK_ADA", 404);
    const [ef] = await terapkanKeadaanEfektif(db, [n]);
    wajib(!n.stockMovementId && STATE_CATATAN_TERTAHAN.includes(ef.state), `Catatan historis ini berstatus ${ef.state}${n.stockMovementId ? " dan sudah tertaut ke pengeluaran stok" : ""}: biayanya sudah/tidak dihitung lewat jalur lain.`, "SUMBER_CATATAN_SUDAH_DIPROSES", 409);
    wajib(n.materialId === bahan.id, "Bahan berbeda dari catatan historis sumber. Petakan catatan ke bahan yang benar lebih dulu.", "SUMBER_CATATAN_TIDAK_COCOK", 409);
    if (n.usedAt) wajib(wibKeyDari(n.usedAt) === w.tanggal, `Tanggal pemakaian berbeda dari catatan sumber (${wibKeyDari(n.usedAt)}).`, "SUMBER_CATATAN_TIDAK_COCOK", 409);
    if (n.qty != null) wajib(Math.abs(Number(n.qty) - qty) < 0.00005, `Jumlah berbeda dari catatan sumber (${Number(n.qty)} ${bahan.unit}).`, "SUMBER_CATATAN_TIDAK_COCOK", 409);
    catatan = { id: n.id, state: ef.state };
  }
  return { unit, bahan, tanggal: w.tanggal, terlambatHari: w.terlambatHari, qty, konversi: kv.dikonversi ? kv.teks : null, sumberJenis, sumberRef: sumberJenis === "CATATAN_HISTORIS" ? m.sumberRef : (m.sumberRef ? String(m.sumberRef).slice(0, 200) : null), bukti, alasan, jalur, pra, tautan, catatan };
}

/** Pemeriksaan ganda: entri aktif sama unit+bahan+tanggal, dan pengeluaran stok/kandidat yang mungkin mencatat pemakaian yang sama. */
async function periksaGanda(db, v, { menggantikanId = null } = {}) {
  const aktif = await db.orderBiayaTanpaStok.findMany({ where: { unitId: v.unit.id, materialId: v.bahan.id, tanggalPemakaian: tglDate(v.tanggal), status: { in: AKTIF } }, select: { id: true, status: true, qty: true } });
  const bentrok = aktif.filter((a) => a.id !== menggantikanId);
  const stok = await sudahTercatatUntuk(db, { unitId: v.unit.id, materialId: v.bahan.id, qty: v.qty, tanggal: v.tanggal, orderId: v.unit.orderId });
  const kemungkinan = stok.kemungkinan.filter((k) => !(k.kind === "CATATAN_HISTORIS" && k.id === v.catatan?.id)); // catatan sumber sendiri bukan kandidat ganda
  return { bentrok, tertaut: stok.tertaut, kemungkinan, perluKonfirmasi: stok.tertaut.length + kemungkinan.length > 0 };
}

export async function pratinjauBiayaTanpaStok(db, user, masukan) {
  const v = await periksaMasukan(db, user, masukan);
  const penghalang = [];
  if (v.jalur.key !== "BIAYA_TANPA_STOK") penghalang.push({ kode: "JALUR_STOK_RESMI", pesan: `Tanggal pemakaian ${v.tanggal} ${v.pra ? "" : "untuk bahan tanpa tautan SO "}tidak tercakup SO: catat sebagai pengeluaran bahan resmi lewat pembetulan unit (stok berkurang + HPP), hanya bila belum tercatat.` });
  let menggantikan = null;
  if (masukan.menggantikanId) {
    menggantikan = await db.orderBiayaTanpaStok.findUnique({ where: { id: String(masukan.menggantikanId) }, select: { id: true, unitId: true, status: true } });
    if (!menggantikan || menggantikan.unitId !== v.unit.id || menggantikan.status !== "DISETUJUI") penghalang.push({ kode: "KOREKSI_TIDAK_SAH", pesan: "Yang dikoreksi harus biaya tanpa stok DISETUJUI pada unit yang sama." });
  }
  const g = await periksaGanda(db, v, { menggantikanId: menggantikan?.id ?? null });
  if (g.bentrok.length) penghalang.push({ kode: "BIAYA_GANDA", pesan: `Sudah ada biaya tanpa stok ${g.bentrok.map((b) => b.status).join("/")} untuk bahan ${v.bahan.code} pada unit ini tanggal ${v.tanggal}. Koreksi lewat entri pengganti, bukan entri baru.` });
  const h = v.jalur.key === "BIAYA_TANPA_STOK" ? await hargaBiaya(db, { unit: v.unit, materialId: v.bahan.id, tanggal: v.tanggal, qty: v.qty }) : null;
  const izinHarga = bolehNominal(user);
  return {
    boleh: penghalang.length === 0, penghalang, jalur: v.jalur,
    unit: { id: v.unit.id, kode: v.unit.unitCode, status: v.unit.status }, bahan: { id: v.bahan.id, kode: v.bahan.code, nama: v.bahan.name, satuan: v.bahan.unit },
    qty: v.qty, konversi: v.konversi, tanggalPemakaian: v.tanggal, terlambatHari: v.terlambatHari, soTanggal: v.pra?.soTanggal ?? null,
    harga: h ? { status: h.ada ? "DINILAI" : "TANPA_HARGA", harga: izinHarga && h.ada ? Number(h.harga) : null, nilai: izinHarga && h.ada ? Number(h.nilai) : null, dasar: h.dasarTeks, sidik: h.sidik,
      teks: h.ada ? "Harga Berlaku pada awal tanggal pemakaian yang dilaporkan dibekukan saat disetujui." : `Belum ada Harga Berlaku untuk ${v.bahan.code} pada ${v.tanggal}: dicatat TANPA_HARGA (belum diketahui, bukan Rp0).`,
      berubahPadaHari: h.berubahPadaHari.length ? "Harga bahan ini berubah di tengah tanggal itu; yang dipakai harga awal hari." : null } : null,
    ganda: { tertaut: g.tertaut, kemungkinan: g.kemungkinan, perluKonfirmasi: g.perluKonfirmasi },
    dampak: ["Stok Gudang TIDAK berubah (hitung fisik SO sudah mencakup pemakaian ini).", "Tidak ada jurnal Finance; saldo kas/bank tidak berubah.", "HPP operasional order bertambah hanya sesudah DISETUJUI orang lain dari pengaju.", "Koreksi kelak = entri pengganti; entri ini tidak bisa diubah atau dihapus."],
    sumber: { jenis: v.sumberJenis, label: SUMBER_JENIS[v.sumberJenis], ref: v.sumberRef },
  };
}

async function catatEvent(tx, entryId, kind, actorId, reason, before = null, after = null) {
  await tx.orderBiayaTanpaStokEvent.create({ data: { entryId, kind, actorId: actorId ?? null, reason: reason ?? null, before, after } });
}

/** Ajukan biaya tanpa stok. kunci = idempotensi (wajib). Tidak menulis stok/jurnal. */
export async function ajukanBiayaTanpaStok(prisma, user, masukan, { kunci }) {
  wajib(bolehMencatat(user), "Anda tidak punya akses mencatat pemakaian bahan.", "TIDAK_BERWENANG", 403);
  wajib(typeof kunci === "string" && kunci.length >= 8 && kunci.length <= 120, "Kunci idempotensi wajib (8–120 karakter).", "KUNCI_WAJIB");
  const ada = await prisma.orderBiayaTanpaStok.findUnique({ where: { idempotencyKey: kunci } });
  if (ada) { wajib(ada.diajukanOleh === user.id, "Kunci idempotensi sudah dipakai orang lain.", "KUNCI_BENTROK", 409); return { ulang: true, entri: ada }; }
  try {
    return await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "units", masukan.unitId);
      const v = await periksaMasukan(tx, user, masukan);
      wajib(v.jalur.key === "BIAYA_TANPA_STOK", `Tanggal pemakaian ${v.tanggal} tidak tercakup SO bahan ${v.bahan.code}: gunakan pengeluaran bahan resmi (pembetulan unit), bukan biaya tanpa stok.`, "JALUR_STOK_RESMI", 409, { jalur: v.jalur.key });
      let ganti = null;
      if (masukan.menggantikanId) {
        ganti = await tx.orderBiayaTanpaStok.findUnique({ where: { id: String(masukan.menggantikanId) } });
        wajib(ganti && ganti.unitId === v.unit.id && ganti.status === "DISETUJUI", "Yang dikoreksi harus biaya tanpa stok DISETUJUI pada unit yang sama.", "KOREKSI_TIDAK_SAH", 409);
        const lain = await tx.orderBiayaTanpaStok.count({ where: { menggantikanId: ganti.id, status: "DIAJUKAN" } });
        wajib(lain === 0, "Sudah ada koreksi yang menunggu persetujuan untuk entri ini.", "KOREKSI_SUDAH_DIAJUKAN", 409);
      }
      const g = await periksaGanda(tx, v, { menggantikanId: ganti?.id ?? null });
      wajib(!g.bentrok.length, `Sudah ada biaya tanpa stok aktif untuk ${v.bahan.code} pada unit ini tanggal ${v.tanggal}.`, "BIAYA_GANDA", 409, { bentrok: g.bentrok.map((b) => b.id) });
      wajib(!g.perluKonfirmasi || masukan.konfirmasiBukanGanda === true, `Ada ${g.tertaut.length} pengeluaran stok bahan ini pada unit dan ${g.kemungkinan.length} catatan lain yang mungkin mencatat pemakaian yang sama. Periksa daftarnya lalu konfirmasi bahwa ini biaya yang BELUM tercatat.`, "KEMUNGKINAN_GANDA", 409, { tertaut: g.tertaut.length, kemungkinan: g.kemungkinan.length });
      const h = await hargaBiaya(tx, { unit: v.unit, materialId: v.bahan.id, tanggal: v.tanggal, qty: v.qty });
      wajib(!masukan.sidikHarga || masukan.sidikHarga === h.sidik, "Dasar harga berubah sejak pratinjau. Lihat pratinjau lagi; tidak ada yang tersimpan.", "DASAR_HARGA_BERGESER", 409);
      const e = await tx.orderBiayaTanpaStok.create({ data: {
        unitId: v.unit.id, orderId: v.unit.orderId, materialId: v.bahan.id, qty: new Decimal(String(v.qty)), satuan: v.bahan.unit, tanggalPemakaian: tglDate(v.tanggal), soTanggal: tglDate(v.pra.soTanggal), soTautanId: v.tautan?.id ?? null,
        statusHarga: h.ada ? "DINILAI" : "TANPA_HARGA", hargaSatuan: h.ada ? h.harga : null, nilai: h.ada ? h.nilai : null, priceId: h.priceId, basisHarga: h.basis, sidikHarga: h.sidik,
        sumberJenis: v.sumberJenis, sumberRef: v.sumberRef, bukti: v.bukti, alasan: v.alasan, menggantikanId: ganti?.id ?? null, diajukanOleh: user.id, idempotencyKey: kunci,
      } });
      await catatEvent(tx, e.id, "DIAJUKAN", user.id, v.alasan, null, { qty: v.qty, tanggal: v.tanggal, soTanggal: v.pra.soTanggal, statusHarga: e.statusHarga, nilai: e.nilai == null ? null : Number(e.nilai), menggantikanId: ganti?.id ?? null, konfirmasiBukanGanda: masukan.konfirmasiBukanGanda === true, kandidatGanda: g.tertaut.length + g.kemungkinan.length });
      return { ulang: false, entri: e };
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  } catch (err) {
    if (err?.code === "P2002") { const s = await prisma.orderBiayaTanpaStok.findUnique({ where: { idempotencyKey: kunci } }); if (s) return { ulang: true, entri: s }; throw new HppOrderError("Biaya yang sama sudah aktif (catatan sumber atau unit+bahan+tanggal).", 409, "BIAYA_GANDA"); }
    throw err;
  }
}

/** Setujui (FINANCE_APPROVE, orang lain dari pengaju). Memeriksa ulang jalur SO, ganda, dan dasar harga. Koreksi: entri lama → DIGANTI pada transaksi yang sama. */
export async function setujuiBiayaTanpaStok(prisma, user, { id, catatan = null }) {
  wajib(bolehMenyetujui(user), "Persetujuan biaya tanpa stok hanya untuk Finance/Owner (finance:approve).", "TIDAK_BERWENANG", 403);
  wajib(UUID.test(String(id ?? "")), "id tidak valid", "ID_TIDAK_VALID");
  try {
    return await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "order_biaya_tanpa_stok", id);
      const e = await tx.orderBiayaTanpaStok.findUnique({ where: { id }, include: { unit: { select: { id: true, unitCode: true, orderId: true, status: true } }, material: { select: { id: true, code: true, unit: true } } } });
      wajib(e, "Entri tidak ditemukan", "TIDAK_ADA", 404);
      if (e.status === "DISETUJUI") return { ulang: true, entri: e };
      wajib(e.status === "DIAJUKAN", `Entri berstatus ${e.status}, tidak bisa disetujui.`, "STATUS_TIDAK_SAH", 409);
      wajib(e.diajukanOleh !== user.id, "Penyetuju harus orang lain dari pengaju.", "PENYETUJU_SAMA_DENGAN_PENGAJU", 403);
      wajib(e.unit.status !== "CANCELLED", "Unit sudah dibatalkan.", "UNIT_DIBATALKAN", 409);
      const tanggal = tglStr(e.tanggalPemakaian);
      const pra = await periksaPraSO(tx, { materialId: e.materialId, tanggal, jenis: "TAMBAH" });
      wajib(pra && pra.soTanggal === tglStr(e.soTanggal), "Tautan SO bahan ini berubah sejak diajukan. Tolak lalu ajukan ulang dari kondisi terbaru.", "TAUTAN_SO_BERUBAH", 409, { soSaatAjukan: tglStr(e.soTanggal), soSekarang: pra?.soTanggal ?? null });
      const h = await hargaBiaya(tx, { unit: e.unit, materialId: e.materialId, tanggal, qty: Number(e.qty) });
      wajib(h.sidik === e.sidikHarga, "Dasar harga (Harga Berlaku pada tanggal pemakaian) berubah sejak diajukan. Tolak lalu ajukan ulang.", "DASAR_HARGA_BERGESER", 409, { diajukan: e.sidikHarga, sekarang: h.sidik });
      const aktif = await tx.orderBiayaTanpaStok.count({ where: { id: { notIn: [e.id, ...(e.menggantikanId ? [e.menggantikanId] : [])] }, unitId: e.unitId, materialId: e.materialId, tanggalPemakaian: e.tanggalPemakaian, status: "DISETUJUI" } });
      wajib(aktif === 0, "Sudah ada biaya DISETUJUI untuk unit + bahan + tanggal ini.", "BIAYA_GANDA", 409);
      if (e.sumberJenis === "CATATAN_HISTORIS" && e.sumberRef) {
        const n = await tx.unitUsageNote.findUnique({ where: { id: e.sumberRef }, select: { stockMovementId: true, state: true, origin: true, flags: true, id: true } });
        const [ef] = await terapkanKeadaanEfektif(tx, [n]);
        wajib(!n.stockMovementId && STATE_CATATAN_TERTAHAN.includes(ef.state), "Catatan historis sumber sudah diproses lewat jalur lain (diposting/tercatat di stok) sejak diajukan.", "SUMBER_CATATAN_SUDAH_DIPROSES", 409);
      }
      const sekarang = new Date();
      if (e.menggantikanId) {
        const lama = await tx.orderBiayaTanpaStok.findUnique({ where: { id: e.menggantikanId } });
        wajib(lama?.status === "DISETUJUI", "Entri yang dikoreksi sudah tidak berlaku.", "KOREKSI_TIDAK_SAH", 409);
        await tx.orderBiayaTanpaStok.update({ where: { id: lama.id }, data: { status: "DIGANTI" } });
        await catatEvent(tx, lama.id, "DIGANTI", user.id, `Diganti koreksi ${e.id}`, { status: "DISETUJUI" }, { status: "DIGANTI", penggantiId: e.id });
      }
      const s = await tx.orderBiayaTanpaStok.update({ where: { id: e.id }, data: { status: "DISETUJUI", diputuskanOleh: user.id, diputuskanPada: sekarang, catatanKeputusan: catatan ? String(catatan).slice(0, 500) : null } });
      await catatEvent(tx, e.id, "DISETUJUI", user.id, catatan, { status: "DIAJUKAN" }, { status: "DISETUJUI", sidikHarga: h.sidik });
      return { ulang: false, entri: s };
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  } catch (err) {
    if (err?.code === "P2002") throw new HppOrderError("Sudah ada biaya DISETUJUI untuk unit + bahan + tanggal ini.", 409, "BIAYA_GANDA");
    throw err;
  }
}

/** Tolak (penyetuju lain) atau batalkan (pengaju selama DIAJUKAN; penyetuju untuk DISETUJUI). Alasan wajib. */
export async function akhiriBiayaTanpaStok(prisma, user, { id, aksi, alasan }) {
  wajib(["TOLAK", "BATALKAN"].includes(aksi), "aksi harus TOLAK atau BATALKAN", "AKSI_TIDAK_VALID");
  wajib(UUID.test(String(id ?? "")), "id tidak valid", "ID_TIDAK_VALID");
  const t = String(alasan ?? "").trim(); wajib(t.length >= 5 && t.length <= 500, "Alasan wajib (5–500 karakter).", "ALASAN_WAJIB");
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "order_biaya_tanpa_stok", id);
    const e = await tx.orderBiayaTanpaStok.findUnique({ where: { id } }); wajib(e, "Entri tidak ditemukan", "TIDAK_ADA", 404);
    let status;
    if (aksi === "TOLAK") {
      wajib(bolehMenyetujui(user), "Penolakan hanya untuk Finance/Owner.", "TIDAK_BERWENANG", 403);
      wajib(e.status === "DIAJUKAN", `Entri berstatus ${e.status}, tidak bisa ditolak.`, "STATUS_TIDAK_SAH", 409);
      wajib(e.diajukanOleh !== user.id, "Penolak harus orang lain dari pengaju (pengaju memakai Batalkan).", "PENYETUJU_SAMA_DENGAN_PENGAJU", 403);
      status = "DITOLAK";
    } else {
      wajib(e.status === "DIAJUKAN" || e.status === "DISETUJUI", `Entri berstatus ${e.status}, tidak bisa dibatalkan.`, "STATUS_TIDAK_SAH", 409);
      if (e.status === "DIAJUKAN") wajib(e.diajukanOleh === user.id || bolehMenyetujui(user), "Hanya pengaju atau Finance/Owner yang bisa membatalkan pengajuan.", "TIDAK_BERWENANG", 403);
      else wajib(bolehMenyetujui(user), "Membatalkan biaya yang sudah disetujui hanya untuk Finance/Owner.", "TIDAK_BERWENANG", 403);
      status = "DIBATALKAN";
    }
    const s = await tx.orderBiayaTanpaStok.update({ where: { id }, data: { status, diputuskanOleh: user.id, diputuskanPada: new Date(), catatanKeputusan: t } });
    await catatEvent(tx, id, status, user.id, t, { status: e.status }, { status });
    return { entri: s };
  });
}

export async function daftarBiayaTanpaStok(db, { status = "DIAJUKAN", unitId = null, izinHarga = false } = {}) {
  const st = String(status || "").split(",").map((s) => s.trim()).filter(Boolean);
  const rows = await db.orderBiayaTanpaStok.findMany({ where: { ...(st.length ? { status: { in: st } } : {}), ...(unitId ? { unitId } : {}) }, orderBy: [{ diajukanPada: "asc" }], take: 500,
    include: { material: { select: { code: true, name: true, unit: true } }, unit: { select: { unitCode: true } }, order: { select: { orderNumber: true } } } });
  return { baris: rows.map((e) => { const b = tampilBiaya(e); return { ...b, unitKode: e.unit.unitCode, orderNomor: e.order.orderNumber, harga: izinHarga ? b.harga : null, subtotal: izinHarga ? b.subtotal : null }; }) };
}

export async function riwayatBiayaTanpaStok(db, id) {
  wajib(UUID.test(String(id ?? "")), "id tidak valid", "ID_TIDAK_VALID");
  return db.orderBiayaTanpaStokEvent.findMany({ where: { entryId: id }, orderBy: { createdAt: "asc" } });
}

// ───────────────────────────── KONFIRMASI PEMAKAIAN LENGKAP ─────────────────────────────
export async function konfirmasiLengkap(prisma, user, { unitId, sidik, alasan }, { kunci }) {
  wajib(bolehMencatat(user) || bolehMenyetujui(user), "Anda tidak punya akses mengonfirmasi pemakaian.", "TIDAK_BERWENANG", 403);
  wajib(UUID.test(String(unitId ?? "")), "unit tidak valid", "UNIT_TIDAK_VALID");
  wajib(typeof kunci === "string" && kunci.length >= 8 && kunci.length <= 120, "Kunci idempotensi wajib (8–120 karakter).", "KUNCI_WAJIB");
  const t = String(alasan ?? "").trim(); wajib(t.length >= 5 && t.length <= 300, "Keterangan konfirmasi wajib (5–300 karakter): siapa yang memeriksa dan dari catatan apa.", "ALASAN_WAJIB");
  const ada = await prisma.unitHppKonfirmasi.findUnique({ where: { idempotencyKey: kunci } }); if (ada) return { ulang: true, konfirmasi: ada };
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "units", unitId);
    const f = (await muatBiayaUnit(tx, [unitId])).get(unitId); const st = statusDariFakta(f);
    wajib(st.key === "SIAP_DIKONFIRMASI" || st.key === "KONFIRMASI_BASI", `Unit belum bisa dikonfirmasi lengkap: ${st.label}. ${st.langkah}`, "BELUM_SIAP_DIKONFIRMASI", 409, { status: st.key });
    wajib(sidik === st.sidik, "Baris biaya unit berubah sejak Anda melihatnya. Muat ulang lalu periksa lagi.", "SIDIK_BERGESER", 409);
    if (f.konfirmasi) await tx.unitHppKonfirmasi.update({ where: { id: f.konfirmasi.id }, data: { status: "REVOKED", dicabutOleh: user.id, dicabutPada: new Date(), alasanCabut: "Diganti konfirmasi baru (baris biaya berubah)" } });
    const k = await tx.unitHppKonfirmasi.create({ data: { unitId, sidik: st.sidik, ringkasan: { barisBiaya: st.barisBiaya, nilaiDiketahui: st.nilaiDiketahui }, alasan: t, dikonfirmasiOleh: user.id, idempotencyKey: kunci } });
    return { ulang: false, konfirmasi: k };
  });
}

export async function cabutKonfirmasi(prisma, user, { unitId, alasan }) {
  wajib(bolehMencatat(user) || bolehMenyetujui(user), "Anda tidak punya akses.", "TIDAK_BERWENANG", 403);
  const t = String(alasan ?? "").trim(); wajib(t.length >= 5 && t.length <= 300, "Alasan wajib (5–300 karakter).", "ALASAN_WAJIB");
  const k = await prisma.unitHppKonfirmasi.findFirst({ where: { unitId, status: "ACTIVE" } }); wajib(k, "Tidak ada konfirmasi aktif.", "TIDAK_ADA", 404);
  return prisma.unitHppKonfirmasi.update({ where: { id: k.id }, data: { status: "REVOKED", dicabutOleh: user.id, dicabutPada: new Date(), alasanCabut: t } });
}

// ───────────────────────────── LAPORAN BERDAMPINGAN (BACA-SAJA) ─────────────────────────────
/**
 * Tiga kolom: (1) laba rugi menurut jurnal, (2) HPP operasional per order + cakupan, (3) hasil manajemen sementara.
 * Pencocokan: biaya bahan dihitung untuk order yang PENDAPATANNYA DIAKUI pada periode (jurnal PENGAKUAN_PENDAPATAN, neto pembalik) — seluruh pemakaian unitnya, kapan pun dipakai.
 * Pemakaian pada periode untuk order yang pendapatannya TIDAK diakui pada periode → kelompok terpisah "biaya order belum diserahkan/diakui" (tidak masuk hasil manajemen).
 */
export async function laporanHppOrder(prisma, { fromStr, toStr, izinHarga = false, bolehSensitif = false }) {
  const { from, to } = periodeValid({ fromStr, toStr });
  const jurnal = await jalankanBacaSaja(prisma, async (tx) => {
    const lr = await labaRugi(tx, { from, to });
    const baris = await muatBarisLabaRugi(tx, { from, to, bolehSensitif });
    return { lr, baris };
  });
  const { lr, baris } = jurnal;
  const pendapatanOrder = new Map(); const pendapatanTanpaOrder = [];
  for (const r of baris) {
    if (r.akunTipe !== "PENDAPATAN") continue;
    if (r.sumber === "PENGAKUAN_PENDAPATAN" && r.orderId) { const a = pendapatanOrder.get(r.orderId) ?? { nilai: [], nomor: r.orderNomor }; a.nilai.push(r.efek); pendapatanOrder.set(r.orderId, a); }
    else pendapatanTanpaOrder.push(r.efek);
  }
  const diakui = [...pendapatanOrder.entries()].map(([orderId, a]) => ({ orderId, orderNomor: a.nomor, pendapatan: moneyToNumber(sumMoney(a.nilai)) })).filter((o) => o.pendapatan !== 0);
  const idDiakui = new Set(diakui.map((o) => o.orderId));
  const unitsDiakui = idDiakui.size ? await prisma.unit.findMany({ where: { orderId: { in: [...idDiakui] }, status: { not: "CANCELLED" } }, select: { id: true, unitCode: true, orderId: true } }) : [];
  // Pemakaian pada periode (tanggal pemakaian WIB) untuk SEMUA unit → untuk kelompok "belum diakui" dan susut periode.
  const mulai = startOfDayWIB(fromStr); const selesai = endOfDayExclusiveWIB(toStr);
  const kandidat = await prisma.stockMovement.findMany({ where: { unitId: { not: null }, type: { in: TIPE_OP }, createdAt: { gte: new Date(mulai.getTime() - 120 * 86_400_000) } }, select: { unitId: true }, distinct: ["unitId"] });
  const bts = await prisma.orderBiayaTanpaStok.findMany({ where: { status: "DISETUJUI", tanggalPemakaian: { gte: tglDate(fromStr), lte: tglDate(toStr) } }, select: { unitId: true } });
  const semuaUnit = [...new Set([...unitsDiakui.map((u) => u.id), ...kandidat.map((k) => k.unitId), ...bts.map((b) => b.unitId)])];
  const fakta = await muatBiayaUnit(prisma, semuaUnit);
  const unitInfo = new Map((semuaUnit.length ? await prisma.unit.findMany({ where: { id: { in: semuaUnit } }, select: { id: true, unitCode: true, orderId: true, status: true, order: { select: { orderNumber: true, status: true } } } }) : []).map((u) => [u.id, u]));
  const dalam = (t) => !!t && t >= fromStr && t <= toStr;

  // (2) per order berpendapatan diakui
  const perOrder = diakui.map((o) => {
    const us = unitsDiakui.filter((u) => u.orderId === o.orderId);
    const st = us.map((u) => ({ unitId: u.id, unitKode: u.unitCode, ...statusDariFakta(fakta.get(u.id)) }));
    const so = statusOrderHpp(st);
    const bahanSebelumPeriode = r2(us.flatMap((u) => [...fakta.get(u.id).stok.filter((b) => b.tipe !== "WASTE"), ...fakta.get(u.id).biaya]).filter((b) => b.status === "DIBEKUKAN" && b.tanggalPemakaian && b.tanggalPemakaian < fromStr).reduce((a, b) => a + Number(b.subtotal), 0));
    return { orderId: o.orderId, orderNomor: o.orderNomor, pendapatan: izinHarga ? o.pendapatan : null, status: so.key, unit: so.unit, unitLengkap: so.unitLengkap, nilaiDiketahui: izinHarga ? so.nilaiDiketahui : null, nilaiLengkap: izinHarga ? so.nilaiLengkap : null,
      bahanSebelumPeriode: izinHarga ? bahanSebelumPeriode : null, marginDiketahui: izinHarga && so.nilaiLengkap != null ? r2(o.pendapatan - so.nilaiLengkap) : null, unitRinci: st.map((u) => ({ unitId: u.unitId, unitKode: u.unitKode, status: u.key, label: u.label, nilaiDiketahui: izinHarga ? u.nilaiDiketahui : null })) };
  });
  const cakupan = {
    orderDiakui: perOrder.length, orderLengkap: perOrder.filter((o) => o.status === "LENGKAP").length, orderParsial: perOrder.filter((o) => o.status === "PARSIAL").length, orderBelumDiketahui: perOrder.filter((o) => o.status === "BELUM_DIKETAHUI").length,
    unitDiakui: perOrder.reduce((a, o) => a + o.unit, 0), unitLengkap: perOrder.reduce((a, o) => a + o.unitLengkap, 0),
  };
  cakupan.unitBelumDiketahui = cakupan.unitDiakui - cakupan.unitLengkap;
  const bahanDiakui = r2(unitsDiakui.reduce((a, u) => { const s = statusDariFakta(fakta.get(u.id)); return a + (s.nilaiDiketahui ?? 0); }, 0));

  // kelompok terpisah: biaya pada periode untuk order yang pendapatannya tidak diakui pada periode
  const belumDiakui = new Map(); let susutPeriode = 0; let susutTanpaNilai = 0;
  for (const id of semuaUnit) {
    const f = fakta.get(id); const u = unitInfo.get(id); if (!u || u.status === "CANCELLED") continue;
    for (const b of f.stok) if (b.tipe === "WASTE" && dalam(b.tanggalPemakaian)) { if (b.status === "DIBEKUKAN") susutPeriode += Number(b.subtotal); else susutTanpaNilai += 1; }
    if (idDiakui.has(u.orderId)) continue;
    const periode = [...f.stok.filter((b) => b.tipe !== "WASTE"), ...f.biaya].filter((b) => dalam(b.tanggalPemakaian)); if (!periode.length) continue;
    const g = belumDiakui.get(u.orderId) ?? { orderId: u.orderId, orderNomor: u.order?.orderNumber ?? null, statusOrder: u.order?.status ?? null, baris: 0, tanpaNilai: 0, nilaiDiketahui: 0 };
    g.baris += periode.length; g.tanpaNilai += periode.filter((b) => b.status !== "DIBEKUKAN").length; g.nilaiDiketahui += periode.filter((b) => b.status === "DIBEKUKAN").reduce((a, b) => a + Number(b.subtotal), 0);
    belumDiakui.set(u.orderId, g);
  }
  const daftarBelum = [...belumDiakui.values()].map((g) => ({ ...g, nilaiDiketahui: izinHarga ? r2(g.nilaiDiketahui) : null }));

  const akunBebanPokok = lr.bebanPokok.map((a) => ({ kode: a.kode ?? a.code ?? a.akunKode, nama: a.nama ?? a.name, nilai: Number(a.nilai) }));
  const mgmt = hasilManajemen({ jurnal: { pendapatanBersih: lr.ringkasan.pendapatanBersih, akunBebanPokok, bebanOperasional: lr.ringkasan.bebanOperasional }, operasional: { bahanDiakui, susutPeriode: r2(susutPeriode), ...cakupan } });
  const sembunyi = (x) => (izinHarga ? x : null);
  return {
    periode: { from: fromStr, to: toStr }, diambilPada: new Date().toISOString(),
    jurnal: izinHarga ? { ringkasan: lr.ringkasan, akunBebanPokok, final: false, teks: "Angka jurnal resmi. HPP bahan jurnal belum mencerminkan pemakaian (pemakaian belum dicatat dan jurnal pemakaian tertahan selama persediaan awal belum diposting)." } : null,
    operasional: { cakupan, bahanDiakui: sembunyi(bahanDiakui), susutPeriode: sembunyi(r2(susutPeriode)), susutTanpaNilai, order: perOrder, pendapatanTanpaOrder: sembunyi(moneyToNumber(sumMoney(pendapatanTanpaOrder))),
      belumDiakui: { order: daftarBelum, nilaiDiketahui: sembunyi(r2(daftarBelum.reduce((a, g) => a + (g.nilaiDiketahui ?? 0), 0))), teks: "Pemakaian bahan pada periode untuk order yang pendapatannya TIDAK diakui pada periode ini (belum diserahkan, atau diakui di periode lain). Ditampilkan terpisah; tidak masuk hasil manajemen." },
      teks: "HPP operasional = Harga Berlaku Gudang pada tanggal pemakaian (pengeluaran stok + biaya tanpa stok yang disetujui). Bukan jurnal. Nilai order hanya disebut lengkap bila semua unitnya lengkap." },
    manajemen: izinHarga ? mgmt : { status: mgmt.status, final: false, teksStatus: mgmt.teksStatus },
    pencegahanGanda: [
      "Bahan di hasil manajemen = HPP operasional order berpendapatan diakui; beban bahan jurnal (5-1100/5-1150/5-1900/5-1950/5-1960) dikeluarkan dan ditampilkan terpisah.",
      "Satu pemakaian hanya punya satu jalur: pengeluaran stok (sesudah SO) ATAU biaya tanpa stok (pada/sebelum SO); database menolak biaya tanpa stok kedua untuk unit+bahan+tanggal yang sama.",
      "Catatan historis yang menjadi sumber biaya tanpa stok tidak dihitung lagi sebagai catatan tertahan.",
      "Biaya order yang pendapatannya belum diakui ditampilkan terpisah, tidak ikut hasil periode.",
    ],
    saldoLama: "Selisih saldo persediaan lama (PSA/rekonsiliasi) adalah paket terpisah dan TIDAK dibebankan ke periode ini.",
  };
}
