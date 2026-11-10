// HPP PER ORDER (Nov 2026) — antrean PIC, biaya bahan per order TANPA stok (pemakaian pra-SO), konfirmasi pemakaian lengkap, dan laporan berdampingan.
//
// BATAS YANG DIJAGA (lihat lib/domain/hppOrder.js untuk aturan murni):
//   • Tidak ada pergerakan stok, jurnal, saldo kas/bank, PSA, atau cutover yang ditulis modul ini. Tulisan HANYA ke order_biaya_tanpa_stok(+events) dan unit_hpp_konfirmasi.
//   • Jalur dipilih TANGGAL PEMAKAIAN terhadap tanggal SO yang ditautkan ke bahan (periksaPraSO — aturan yang sama dengan penolakan 409 UNIT_PEMAKAIAN_PRA_SO):
//       sesudah SO / tanpa tautan → pengeluaran stok resmi (pembetulan unit yang sudah ada; modul ini menolak dengan JALUR_STOK_RESMI),
//       pada/sebelum SO           → biaya tanpa stok di sini.
//   • Tidak menebak jumlah, tanggal, atau harga (dasarHargaBiaya): jam diketahui → harga pada jam itu; hanya tanggal & harga tak berubah hari itu → harga awal hari (= sepanjang hari);
//     harga berubah hari itu → PERLU_KEPUTUSAN (penyetuju memilih dari kandidat, beralasan); tidak ada harga → TANPA_HARGA (null, bukan Rp0).
//   • Ganda dicegah per IDENTITAS SUMBER + kunci idempotensi (indeks unik database); pemakaian identik yang sudah terwakili ISSUE/catatan/biaya lain ditolak keras.
//   • Biaya tanpa stok berlaku (masuk HPP operasional) hanya sesudah DISETUJUI orang lain dari pengaju; koreksi = entri pengganti yang disetujui atomik; tidak ada hapus (trigger database).
import { lockRowForUpdate } from "../inventoryLedger.js";
import { hasPermission } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";
import { TIPE_OP, penyelesaiHargaBerlaku, hargaBerubahPadaHari, batasHargaTanggal } from "./hargaBerlaku.js";
import { periksaPraSO, sudahTercatatUntuk, tanggalDilaporkan } from "../pembetulanBahanUnit.js";
import { tautanSOAktif } from "../pengamanHistorisPascaSO.js";
import { terapkanKeadaanEfektif } from "../catatanPemakaianHistoris.js";
import { aturanBerlaku, aturanUntukBahan, konversiKeStok } from "../../lib/domain/satuanPakaiBahan.js";
import { bacaPenimpaanSatuanPakai } from "../satuanPakaiService.js";
import { barisPergerakan, wibKeyDari } from "../../lib/domain/laporanProduksi.js";
import {
  JALUR, STATUS_UNIT, statusUnitHpp, statusOrderHpp, tentukanJalur, hasilManajemen, klasifikasiBarisJurnal, KELOMPOK_JURNAL,
  dasarHargaBiaya, DASAR_HARGA, normalRujukan, pisahkanGanda, sidikKandidat,
} from "../../lib/domain/hppOrder.js";
import { labaRugi } from "./reports.js";
import { muatBarisLabaRugi } from "./laporanTerinci/baris.js";
import { jalankanBacaSaja, periodeValid } from "./laporanTerinci/index.js";
import { STATUS_DIHITUNG } from "./journal.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../../utils/wib.js";
import { sumMoney, moneyToNumber, Decimal } from "./money.js";
import crypto from "node:crypto";

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
      select: { id: true, type: true, qty: true, createdAt: true, note: true, materialId: true, unitId: true, materialIssueId: true, correctsMovementId: true, material: { select: { code: true, name: true, unit: true } },
        biayaOperasional: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { status: true, unitCost: true, value: true, priceEffectiveFrom: true, basisHarga: true, sumber: true, evidenceLabel: true } } } }),
    db.orderBiayaTanpaStok.findMany({ where: { unitId: { in: unitIds }, status: { in: AKTIF } }, orderBy: [{ diajukanPada: "asc" }], include: { material: { select: { code: true, name: true, unit: true } } } }),
    db.unitUsageNote.findMany({ where: { unitId: { in: unitIds } }, select: { id: true, unitId: true, state: true, origin: true, flags: true, materialId: true, qty: true, usedAt: true, rawName: true } }),
    db.unitProvisionalUsage.groupBy({ by: ["unitId"], where: { unitId: { in: unitIds }, status: "PERLU_REKONSILIASI" }, _count: { _all: true } }),
    db.unitMaterialDeclaration.findMany({ where: { unitId: { in: unitIds }, status: "ACTIVE" }, select: { id: true, unitId: true, kind: true, reason: true, declaredById: true, declaredAt: true } }),
    db.unitHppKonfirmasi.findMany({ where: { unitId: { in: unitIds }, status: "ACTIVE" }, select: { id: true, unitId: true, sidik: true, dikonfirmasiOleh: true, dikonfirmasiPada: true, alasan: true } }),
  ]);
  for (const m of mv) {
    const b = barisPergerakan({ id: m.id, type: m.type, qty: m.qty, createdAt: m.createdAt, note: m.note, materialId: m.materialId, unitId: m.unitId, correctsMovementId: m.correctsMovementId, materialKode: m.material.code, materialNama: m.material.name, materialSatuan: m.material.unit }, m.biayaOperasional[0] ?? null);
    peta.get(m.unitId).stok.push({ ...b, sumber: "STOK", id: m.id, materialIssueId: m.materialIssueId ?? null });
  }
  const sumberAktif = new Set();
  for (const e of biaya) {
    const x = peta.get(e.unitId); if (e.sumberJenis === "CATATAN_HISTORIS") sumberAktif.add(e.sumberRef);
    const baris = tampilBiaya(e);
    if (e.status === "DISETUJUI") x.biaya.push(baris); else x.diajukan.push(baris);
  }
  for (const n of await terapkanKeadaanEfektif(db, notes)) {
    if (!n.unitId || !STATE_CATATAN_TERTAHAN.includes(n.state) || sumberAktif.has(n.id)) continue; // catatan yang sudah menjadi sumber biaya aktif tidak dihitung dua kali
    peta.get(n.unitId)?.catatanTertahan.push({ id: n.id, state: n.state, materialId: n.materialId, qty: n.qty == null ? null : Number(n.qty), tanggal: n.usedAt ? wibKeyDari(n.usedAt) : null, nama: n.rawName ?? null });
  }
  for (const s of sem) peta.get(s.unitId).sementara = s._count._all;
  const namaPeta = pern.length ? new Map((await db.user.findMany({ where: { id: { in: [...new Set(pern.map((p) => p.declaredById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map();
  for (const p of pern) if (p.kind === "TANPA_BAHAN_BARU") peta.get(p.unitId).pernyataan = { id: p.id, alasan: p.reason, olehId: p.declaredById, oleh: namaPeta.get(p.declaredById) ?? null, pada: p.declaredAt };
  for (const k of konf) peta.get(k.unitId).konfirmasi = k;
  return peta;
}

/** Satu entri biaya tanpa stok dalam bentuk baris biaya (selaras barisPergerakan: status DIBEKUKAN bila bernilai). */
function tampilBiaya(e) {
  const dinilai = e.statusHarga === "DINILAI";
  return {
    id: e.id, sumber: "BIAYA_TANPA_STOK", movementId: null, unitId: e.unitId, materialId: e.materialId, kode: e.material?.code ?? null, bahan: e.material?.name ?? null, satuan: e.satuan,
    jenis: "BIAYA_TANPA_STOK", tipe: "BIAYA_TANPA_STOK", qty: Number(e.qty), arah: "KELUAR", harga: dinilai ? Number(e.hargaSatuan) : null, subtotal: dinilai ? Number(e.nilai) : null,
    tanggalPemakaian: tglStr(e.tanggalPemakaian), waktuPemakaian: e.waktuPemakaian ?? null, dasarTanggal: e.waktuPemakaian ? "WAKTU_DIKETAHUI" : "TANGGAL_DILAPORKAN", soTanggal: tglStr(e.soTanggal),
    status: dinilai ? "DIBEKUKAN" : e.statusHarga, termasukHpp: dinilai, statusHarga: e.statusHarga, kandidatHarga: e.kandidatHarga ?? null,
    statusEntri: e.status, sumberJenis: e.sumberJenis, sumberRef: e.sumberRef, bukti: e.bukti, alasan: e.alasan, diajukanOleh: e.diajukanOleh, diajukanPada: e.diajukanPada,
    diputuskanOleh: e.diputuskanOleh, diputuskanPada: e.diputuskanPada, menggantikanId: e.menggantikanId, basisHarga: e.basisHarga, teksDasarHarga: DASAR_HARGA[e.basisHarga] ?? e.basisHarga,
    keputusanHargaOleh: e.keputusanHargaOleh ?? null, keputusanHargaAlasan: e.keputusanHargaAlasan ?? null, kandidatGanda: e.kandidatGanda ?? null,
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
      biayaKosong: semua.filter((b) => b.status !== "DIBEKUKAN").length, perluKeputusanHarga: [...f.biaya, ...f.diajukan].filter((b) => b.statusHarga === "PERLU_KEPUTUSAN").length,
      catatanTertahan: f.catatanTertahan.length, sementara: f.sementara, biayaDiajukan: f.diajukan.length,
      konfirmasi: f.konfirmasi ? { oleh: f.konfirmasi.dikonfirmasiOleh, pada: f.konfirmasi.dikonfirmasiPada, basi: st.key === "KONFIRMASI_BASI" } : null,
      pernyataanTanpaBahan: !!f.pernyataan, pernyataan: f.pernyataan ? { oleh: f.pernyataan.oleh, pada: f.pernyataan.pada, alasan: f.pernyataan.alasan } : null,
      status: st.key, statusLabel: st.label, tone: st.tone, lengkap: st.lengkap, langkah: st.langkah, sidik: st.sidik,
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
    jalur: JALUR, status: STATUS_UNIT, dasarHarga: DASAR_HARGA, baris: tampil,
    catatan: "Ada pemakaian ≠ HPP lengkap. Unit lengkap hanya bila semua baris bernilai, tidak ada catatan/biaya tertahan, dan PIC mengonfirmasi pemakaian lengkap (atau pernyataan tanpa bahan baru yang tercatat pelaku, waktu, dan alasannya). Biaya kosong = belum diketahui, bukan Rp0.",
  };
}

/** Rincian satu unit untuk panel PIC: baris biaya, catatan tertahan (dengan jalur yang disarankan), biaya diajukan, konfirmasi. */
export async function rincianUnit(db, unitId, { izinHarga = false } = {}) {
  wajib(UUID.test(String(unitId ?? "")), "unit tidak valid", "UNIT_TIDAK_VALID");
  const u = await db.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, createdAt: true, orderId: true, order: { select: { orderNumber: true } } } });
  wajib(u, "Unit tidak ditemukan", "UNIT_TIDAK_ADA", 404);
  const f = (await muatBiayaUnit(db, [unitId])).get(unitId); const st = statusDariFakta(f);
  const tautan = await tautanSOAktif(db, [...new Set(f.catatanTertahan.map((c) => c.materialId).filter(Boolean))]);
  const sembunyi = (b) => (izinHarga ? b : { ...b, harga: null, subtotal: null, kandidatHarga: b.kandidatHarga ? b.kandidatHarga.map((k) => ({ ...k, harga: null })) : null });
  return {
    unit: { id: u.id, kode: u.unitCode, status: u.status, order: u.order?.orderNumber ?? null, orderId: u.orderId, dibuat: wibKeyDari(u.createdAt) }, status: st,
    baris: [...f.stok, ...f.biaya].map(sembunyi), diajukan: f.diajukan.map(sembunyi),
    catatanTertahan: f.catatanTertahan.map((c) => { const t = c.materialId ? tautan.get(c.materialId) : null; return { ...c, soTanggal: t?.soTanggal ?? null, jalurDisarankan: c.tanggal ? tentukanJalur({ tanggal: c.tanggal, soTanggal: t?.soTanggal ?? null }).key : null }; }),
    sementara: f.sementara, pernyataan: f.pernyataan, konfirmasi: f.konfirmasi,
  };
}

// ───────────────────────────── BIAYA TANPA STOK: dasar harga, ganda, pratinjau, ajukan, putuskan ─────────────────────────────
/** Waktu pemakaian (opsional): ISO dengan zona waktu, harus jatuh pada tanggal pemakaian (WIB) dan tidak di masa depan. */
function bacaWaktu(waktu, tanggal) {
  if (waktu == null || waktu === "") return null;
  const s = String(waktu); wajib(/T\d{2}:\d{2}/.test(s) && /(Z|[+-]\d{2}:?\d{2})$/.test(s), "Jam pemakaian harus lengkap dengan zona waktu, mis. 2026-11-03T14:30+07:00.", "WAKTU_TIDAK_VALID");
  const d = new Date(s); wajib(!Number.isNaN(d.getTime()), "Jam pemakaian tidak valid.", "WAKTU_TIDAK_VALID");
  wajib(wibKeyDari(d) === tanggal, `Jam pemakaian (${wibKeyDari(d)} WIB) tidak jatuh pada tanggal pemakaian ${tanggal}.`, "WAKTU_TIDAK_COCOK");
  wajib(d.getTime() <= Date.now(), "Jam pemakaian di masa depan.", "WAKTU_TIDAK_VALID");
  return d;
}

const kand = (h) => (h ? { priceId: h.baris?.id ?? h.priceId, harga: new Decimal(String(h.baris?.unitPrice ?? h.unitPrice ?? h.harga)).toDecimalPlaces(4).toString(), mulai: new Date(h.baris?.effectiveFrom ?? h.mulai).toISOString() } : null);

/** Dasar harga satu biaya — TIDAK memilih diam-diam (lihat dasarHargaBiaya). sidik mengikat tanggal, jam, status, pilihan, dan seluruh kandidat. */
async function hargaBiaya(db, { materialId, tanggal, waktu = null, qty }) {
  const sel = penyelesaiHargaBerlaku(db);
  const awalHari = kand(await sel(materialId, batasHargaTanggal(tanggal)));
  const berubahPadaHari = (await hargaBerubahPadaHari(db, materialId, tanggal)).map(kand);
  const diWaktu = waktu ? kand(await sel(materialId, waktu)) : null;
  const d = dasarHargaBiaya({ waktuDiketahui: !!waktu, awalHari, berubahPadaHari, diWaktu });
  const sidik = crypto.createHash("sha256").update(JSON.stringify([tanggal, waktu ? waktu.toISOString() : null, d.status, d.basis, d.pilihan, d.kandidat ?? null])).digest("hex");
  const harga = d.pilihan ? new Decimal(d.pilihan.harga) : null;
  return { ...d, harga, priceId: d.pilihan?.priceId ?? null, nilai: harga ? new Decimal(String(qty)).times(harga).toDecimalPlaces(2) : null, sidik, teks: DASAR_HARGA[d.basis] };
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
  const waktu = bacaWaktu(m.waktuPemakaian, w.tanggal);
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
  let catatan = null; let sumberRef;
  if (sumberJenis === "CATATAN_HISTORIS") {
    wajib(UUID.test(String(m.sumberRef ?? "")), "Pilih catatan pemakaian historis yang menjadi sumber.", "SUMBER_CATATAN_WAJIB");
    const n = await db.unitUsageNote.findUnique({ where: { id: m.sumberRef }, select: { id: true, unitId: true, orderId: true, materialId: true, qty: true, usedAt: true, state: true, origin: true, flags: true, stockMovementId: true } });
    wajib(n && (n.unitId === unit.id || (!n.unitId && n.orderId === unit.orderId)), "Catatan historis tidak ditemukan pada unit/order ini.", "SUMBER_CATATAN_TIDAK_ADA", 404);
    const [ef] = await terapkanKeadaanEfektif(db, [n]);
    wajib(!n.stockMovementId && STATE_CATATAN_TERTAHAN.includes(ef.state), `Catatan historis ini berstatus ${ef.state}${n.stockMovementId ? " dan sudah tertaut ke pengeluaran stok" : ""}: biayanya sudah/tidak dihitung lewat jalur lain.`, "SUMBER_CATATAN_SUDAH_DIPROSES", 409);
    wajib(n.materialId === bahan.id, "Bahan berbeda dari catatan historis sumber. Petakan catatan ke bahan yang benar lebih dulu.", "SUMBER_CATATAN_TIDAK_COCOK", 409);
    if (n.usedAt) wajib(wibKeyDari(n.usedAt) === w.tanggal, `Tanggal pemakaian berbeda dari catatan sumber (${wibKeyDari(n.usedAt)}).`, "SUMBER_CATATAN_TIDAK_COCOK", 409);
    if (n.qty != null) wajib(Math.abs(Number(n.qty) - qty) < 0.00005, `Jumlah berbeda dari catatan sumber (${Number(n.qty)} ${bahan.unit}).`, "SUMBER_CATATAN_TIDAK_COCOK", 409);
    catatan = { id: n.id, state: ef.state }; sumberRef = n.id;
  } else {
    sumberRef = normalRujukan(m.sumberRef);
    wajib(sumberRef.length >= 3 && sumberRef.length <= 200, "Rujukan sumber wajib (3–200 karakter) dan UNIK per baris pemakaian, mis. \"laporan pic 05/11 lembar 2 baris 3\" atau nama file foto. Rujukan yang sama tidak bisa dipakai dua kali.", "RUJUKAN_SUMBER_WAJIB");
  }
  return { unit, bahan, tanggal: w.tanggal, waktu, terlambatHari: w.terlambatHari, qty, konversi: kv.dikonversi ? kv.teks : null, sumberJenis, sumberRef, bukti, alasan, jalur, pra, tautan, catatan };
}

/**
 * Pemeriksaan ganda (baca-saja):
 *   sumberDipakai = entri aktif lain dengan identitas sumber yang sama (selain entri yang dikoreksi) → ditolak keras.
 *   identik       = ISSUE tertaut unit / catatan historis lain / pemakaian sementara / biaya tanpa stok lain dengan tanggal DAN jumlah sama → ditolak keras.
 *   mirip         = kandidat lain (jumlah atau tanggal berbeda, tanpa unit, unit lain, Material Issue belum final) → konfirmasi "bukan duplikat" beralasan.
 */
async function periksaGanda(db, v, { menggantikanId = null, kecualiId = null, sebelum = null } = {}) {
  const sumberDipakai = await db.orderBiayaTanpaStok.findMany({ where: { sumberJenis: v.sumberJenis, sumberRef: v.sumberRef, status: { in: AKTIF }, id: { notIn: [menggantikanId, kecualiId].filter(Boolean) } }, select: { id: true, status: true, unitId: true } });
  const stok = await sudahTercatatUntuk(db, { unitId: v.unit.id, materialId: v.bahan.id, qty: v.qty, tanggal: v.tanggal, orderId: v.unit.orderId });
  const kandidat = [];
  for (const t of stok.tertaut) {
    const k = { kind: t.tipe === "ISSUE" ? "ISSUE_UNIT" : `${t.tipe}_UNIT`, id: t.id, qty: t.qty, tanggal: t.tipe === "ISSUE" ? (t.dilaporkan ?? wibKeyDari(t.dicatatPada)) : null, dokumen: t.dokumen ?? null, catatan: t.catatan ?? null };
    kandidat.push(k);
  }
  for (const x of stok.kemungkinan) {
    if (x.kind === "CATATAN_HISTORIS" && x.id === v.catatan?.id) continue; // catatan sumber sendiri bukan kandidat ganda
    const unitSendiri = x.kind === "CATATAN_HISTORIS" || x.kind === "PEMAKAIAN_SEMENTARA";
    kandidat.push({ kind: x.kind, id: x.id, qty: x.qty ?? null, tanggal: unitSendiri ? (x.dilaporkan ?? null) : null, catatan: x.catatan ?? null, status: x.status ?? null });
  }
  const lain = await db.orderBiayaTanpaStok.findMany({ where: { unitId: v.unit.id, materialId: v.bahan.id, status: { in: AKTIF }, id: { notIn: [menggantikanId, kecualiId].filter(Boolean) }, ...(sebelum ? { diajukanPada: { lt: sebelum } } : {}) }, select: { id: true, qty: true, tanggalPemakaian: true, status: true, sumberRef: true } });
  for (const e of lain) kandidat.push({ kind: "BIAYA_TANPA_STOK", id: e.id, qty: Number(e.qty), tanggal: tglStr(e.tanggalPemakaian), status: e.status, catatan: `Biaya tanpa stok ${e.status} (sumber ${e.sumberRef})` });
  const { identik, mirip } = pisahkanGanda(kandidat, { qty: v.qty, tanggal: v.tanggal });
  return { sumberDipakai, identik, mirip, kandidat, kunci: kandidat.map((k) => `${k.kind}|${k.id}`).sort(), sidik: sidikKandidat(kandidat) };
}

async function bacaPengganti(db, id, unitId) {
  const g = await db.orderBiayaTanpaStok.findUnique({ where: { id: String(id) } });
  return g && g.unitId === unitId && g.status === "DISETUJUI" ? g : null;
}

export async function pratinjauBiayaTanpaStok(db, user, masukan) {
  const v = await periksaMasukan(db, user, masukan);
  const penghalang = [];
  if (v.jalur.key !== "BIAYA_TANPA_STOK") penghalang.push({ kode: "JALUR_STOK_RESMI", pesan: `Tanggal pemakaian ${v.tanggal} ${v.pra ? "" : "untuk bahan tanpa tautan SO "}tidak tercakup SO: catat sebagai pengeluaran bahan resmi lewat pembetulan unit (stok berkurang + HPP), hanya bila belum tercatat.` });
  let menggantikan = null;
  if (masukan.menggantikanId) { menggantikan = await bacaPengganti(db, masukan.menggantikanId, v.unit.id); if (!menggantikan) penghalang.push({ kode: "KOREKSI_TIDAK_SAH", pesan: "Yang dikoreksi harus biaya tanpa stok DISETUJUI pada unit yang sama." }); }
  const g = await periksaGanda(db, v, { menggantikanId: menggantikan?.id ?? null });
  if (g.sumberDipakai.length) penghalang.push({ kode: "SUMBER_SUDAH_DIPAKAI", pesan: "Sumber ini sudah menjadi biaya tanpa stok yang aktif. Satu baris sumber hanya dicatat sekali; koreksi lewat entri pengganti." });
  if (g.identik.length) penghalang.push({ kode: "GANDA_IDENTIK", pesan: `Pemakaian identik (bahan, tanggal ${v.tanggal}, jumlah ${v.qty}) sudah terwakili: ${g.identik.map((k) => k.kind).join(", ")}. Tidak bisa dikonfirmasi "bukan duplikat"; selesaikan catatan lama lebih dulu.` });
  const h = v.jalur.key === "BIAYA_TANPA_STOK" ? await hargaBiaya(db, { materialId: v.bahan.id, tanggal: v.tanggal, waktu: v.waktu, qty: v.qty }) : null;
  const izinHarga = bolehNominal(user);
  return {
    boleh: penghalang.length === 0, penghalang, jalur: v.jalur,
    unit: { id: v.unit.id, kode: v.unit.unitCode, status: v.unit.status }, bahan: { id: v.bahan.id, kode: v.bahan.code, nama: v.bahan.name, satuan: v.bahan.unit },
    qty: v.qty, konversi: v.konversi, tanggalPemakaian: v.tanggal, waktuPemakaian: v.waktu ? v.waktu.toISOString() : null, terlambatHari: v.terlambatHari, soTanggal: v.pra?.soTanggal ?? null,
    harga: h ? { status: h.status, basis: h.basis, teks: h.teks, harga: izinHarga && h.harga ? Number(h.harga) : null, nilai: izinHarga && h.nilai ? Number(h.nilai) : null, sidik: h.sidik,
      kandidat: h.kandidat ? h.kandidat.map((k) => ({ ...k, harga: izinHarga ? Number(k.harga) : null })) : null } : null,
    ganda: { identik: g.identik, mirip: g.mirip, perluKonfirmasi: g.mirip.length > 0, sidik: g.sidik },
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
        ganti = await bacaPengganti(tx, masukan.menggantikanId, v.unit.id);
        wajib(ganti, "Yang dikoreksi harus biaya tanpa stok DISETUJUI pada unit yang sama.", "KOREKSI_TIDAK_SAH", 409);
        const lain = await tx.orderBiayaTanpaStok.count({ where: { menggantikanId: ganti.id, status: "DIAJUKAN" } });
        wajib(lain === 0, "Sudah ada koreksi yang menunggu persetujuan untuk entri ini.", "KOREKSI_SUDAH_DIAJUKAN", 409);
      }
      const g = await periksaGanda(tx, v, { menggantikanId: ganti?.id ?? null });
      wajib(!g.sumberDipakai.length, "Sumber ini sudah menjadi biaya tanpa stok yang aktif. Satu baris sumber hanya dicatat sekali; koreksi lewat entri pengganti.", "SUMBER_SUDAH_DIPAKAI", 409, { entri: g.sumberDipakai.map((x) => x.id) });
      wajib(!g.identik.length, `Pemakaian identik sudah terwakili (${g.identik.map((k) => k.kind).join(", ")}). Konfirmasi "bukan duplikat" tidak berlaku untuk sumber identik.`, "GANDA_IDENTIK", 409, { identik: g.identik });
      const alasanBukan = String(masukan.alasanBukanGanda ?? "").trim();
      wajib(!g.mirip.length || (masukan.konfirmasiBukanGanda === true && alasanBukan.length >= 5), `Ada ${g.mirip.length} catatan/pengeluaran lain bahan ini yang mungkin mencatat pemakaian yang sama. Periksa daftarnya, lalu konfirmasi "bukan duplikat" dengan alasan (min. 5 karakter).`, "KEMUNGKINAN_GANDA", 409, { mirip: g.mirip });
      wajib(!masukan.sidikGanda || masukan.sidikGanda === g.sidik, "Daftar kemungkinan ganda berubah sejak pratinjau. Lihat pratinjau lagi; tidak ada yang tersimpan.", "KANDIDAT_GANDA_BERUBAH", 409);
      const h = await hargaBiaya(tx, { materialId: v.bahan.id, tanggal: v.tanggal, waktu: v.waktu, qty: v.qty });
      wajib(!masukan.sidikHarga || masukan.sidikHarga === h.sidik, "Dasar harga berubah sejak pratinjau. Lihat pratinjau lagi; tidak ada yang tersimpan.", "DASAR_HARGA_BERGESER", 409);
      const e = await tx.orderBiayaTanpaStok.create({ data: {
        unitId: v.unit.id, orderId: v.unit.orderId, materialId: v.bahan.id, qty: new Decimal(String(v.qty)), satuan: v.bahan.unit, tanggalPemakaian: tglDate(v.tanggal), waktuPemakaian: v.waktu, soTanggal: tglDate(v.pra.soTanggal), soTautanId: v.tautan?.id ?? null,
        statusHarga: h.status, hargaSatuan: h.harga, nilai: h.nilai, priceId: h.priceId, basisHarga: h.basis, sidikHarga: h.sidik, kandidatHarga: h.kandidat ?? undefined,
        sumberJenis: v.sumberJenis, sumberRef: v.sumberRef, sidikGanda: g.sidik, kandidatGanda: { kunci: g.kunci, mirip: g.mirip, alasanBukanGanda: alasanBukan || null },
        bukti: v.bukti, alasan: v.alasan, menggantikanId: ganti?.id ?? null, diajukanOleh: user.id, idempotencyKey: kunci,
      } });
      await catatEvent(tx, e.id, "DIAJUKAN", user.id, v.alasan, null, { qty: v.qty, tanggal: v.tanggal, waktu: v.waktu ? v.waktu.toISOString() : null, soTanggal: v.pra.soTanggal, statusHarga: e.statusHarga, basisHarga: h.basis,
        nilai: e.nilai == null ? null : Number(e.nilai), menggantikanId: ganti?.id ?? null, sumber: `${v.sumberJenis}:${v.sumberRef}`, kandidatGandaMirip: g.mirip.length, alasanBukanGanda: alasanBukan || null });
      return { ulang: false, entri: e };
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  } catch (err) {
    if (err?.code === "P2002") { const s = await prisma.orderBiayaTanpaStok.findUnique({ where: { idempotencyKey: kunci } }); if (s) return { ulang: true, entri: s }; throw new HppOrderError("Sumber ini sudah menjadi biaya tanpa stok yang aktif.", 409, "SUMBER_SUDAH_DIPAKAI"); }
    throw err;
  }
}

/**
 * Setujui (FINANCE_APPROVE, orang lain dari pengaju). Memeriksa ulang: jalur SO, dasar harga (sidik), sumber, ganda identik, dan daftar kemungkinan ganda (sidik).
 * PERLU_KEPUTUSAN: keputusanHarga { priceId, alasan } wajib dan harus salah satu kandidat yang disimpan. Koreksi: entri lama → DIGANTI lalu pengganti → DISETUJUI, satu transaksi.
 */
export async function setujuiBiayaTanpaStok(prisma, user, { id, catatan = null, keputusanHarga = null }) {
  wajib(bolehMenyetujui(user), "Persetujuan biaya tanpa stok hanya untuk Finance/Owner (finance:approve).", "TIDAK_BERWENANG", 403);
  wajib(UUID.test(String(id ?? "")), "id tidak valid", "ID_TIDAK_VALID");
  try {
    return await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "order_biaya_tanpa_stok", id);
      const e = await tx.orderBiayaTanpaStok.findUnique({ where: { id }, include: { unit: { select: { id: true, unitCode: true, orderId: true, status: true } }, material: { select: { id: true, code: true, name: true, unit: true } } } });
      wajib(e, "Entri tidak ditemukan", "TIDAK_ADA", 404);
      if (e.status === "DISETUJUI") return { ulang: true, entri: e };
      wajib(e.status === "DIAJUKAN", `Entri berstatus ${e.status}, tidak bisa disetujui.`, "STATUS_TIDAK_SAH", 409);
      wajib(e.diajukanOleh !== user.id, "Penyetuju harus orang lain dari pengaju.", "PENYETUJU_SAMA_DENGAN_PENGAJU", 403);
      wajib(e.unit.status !== "CANCELLED", "Unit sudah dibatalkan.", "UNIT_DIBATALKAN", 409);
      await lockRowForUpdate(tx, "units", e.unitId);
      const tanggal = tglStr(e.tanggalPemakaian);
      const pra = await periksaPraSO(tx, { materialId: e.materialId, tanggal, jenis: "TAMBAH" });
      wajib(pra && pra.soTanggal === tglStr(e.soTanggal), "Tautan SO bahan ini berubah sejak diajukan. Tolak lalu ajukan ulang dari kondisi terbaru.", "TAUTAN_SO_BERUBAH", 409, { soSaatAjukan: tglStr(e.soTanggal), soSekarang: pra?.soTanggal ?? null });
      const h = await hargaBiaya(tx, { materialId: e.materialId, tanggal, waktu: e.waktuPemakaian, qty: Number(e.qty) });
      wajib(h.sidik === e.sidikHarga, "Dasar harga (Harga Berlaku pada waktu pemakaian) berubah sejak diajukan. Tolak lalu ajukan ulang.", "DASAR_HARGA_BERGESER", 409, { diajukan: e.sidikHarga, sekarang: h.sidik });
      let harga = null;
      if (e.statusHarga === "PERLU_KEPUTUSAN") {
        const alasanHarga = String(keputusanHarga?.alasan ?? "").trim();
        const pilih = (e.kandidatHarga ?? []).find((k) => k.priceId === keputusanHarga?.priceId);
        wajib(pilih, "Harga berubah pada hari pemakaian: pilih SATU kandidat harga (atau tolak dan minta jam pemakaian dari sumber).", "KEPUTUSAN_HARGA_WAJIB", 409, { kandidat: e.kandidatHarga });
        wajib(alasanHarga.length >= 5 && alasanHarga.length <= 300, "Alasan pemilihan harga wajib (5–300 karakter).", "ALASAN_HARGA_WAJIB");
        const hs = new Decimal(pilih.harga);
        harga = { statusHarga: "DINILAI", hargaSatuan: hs, nilai: new Decimal(String(e.qty)).times(hs).toDecimalPlaces(2), priceId: pilih.priceId, basisHarga: "KEPUTUSAN_PENYETUJU", keputusanHargaOleh: user.id, keputusanHargaAlasan: alasanHarga };
      } else wajib(!keputusanHarga, "Entri ini tidak butuh keputusan harga.", "KEPUTUSAN_HARGA_TIDAK_PERLU", 400);
      if (e.sumberJenis === "CATATAN_HISTORIS") {
        const n = await tx.unitUsageNote.findUnique({ where: { id: e.sumberRef }, select: { stockMovementId: true, state: true, origin: true, flags: true, id: true } });
        const [ef] = await terapkanKeadaanEfektif(tx, [n]);
        wajib(!n.stockMovementId && STATE_CATATAN_TERTAHAN.includes(ef.state), "Catatan historis sumber sudah diproses lewat jalur lain (diposting/tercatat di stok) sejak diajukan.", "SUMBER_CATATAN_SUDAH_DIPROSES", 409);
      }
      const v = { unit: e.unit, bahan: e.material, qty: Number(e.qty), tanggal, sumberJenis: e.sumberJenis, sumberRef: e.sumberRef, catatan: e.sumberJenis === "CATATAN_HISTORIS" ? { id: e.sumberRef } : null };
      // Biaya tanpa stok yang diajukan SESUDAH entri ini sudah memperhitungkan entri ini saat diajukan → tidak dihitung sebagai kandidat baru di sini.
      const g = await periksaGanda(tx, v, { menggantikanId: e.menggantikanId, kecualiId: e.id, sebelum: e.diajukanPada });
      wajib(!g.sumberDipakai.some((x) => x.status === "DISETUJUI"), "Sumber ini sudah disetujui pada entri lain.", "SUMBER_SUDAH_DIPAKAI", 409);
      wajib(!g.identik.length, `Pemakaian yang sama sudah terwakili sejak diajukan (${g.identik.map((k) => k.kind).join(", ")}). Tolak entri ini.`, "GANDA_IDENTIK", 409, { identik: g.identik });
      const lamaKunci = new Set(e.kandidatGanda?.kunci ?? []); const baru = g.kandidat.filter((k) => !lamaKunci.has(`${k.kind}|${k.id}`));
      wajib(!baru.length, "Ada catatan/pengeluaran baru bahan ini yang mungkin ganda sejak diajukan. Tolak lalu ajukan ulang supaya pengaju memeriksa daftar terbaru.", "KANDIDAT_GANDA_BERUBAH", 409, { baru });
      const sekarang = new Date();
      if (e.menggantikanId) {
        const lama = await tx.orderBiayaTanpaStok.findUnique({ where: { id: e.menggantikanId } });
        wajib(lama?.status === "DISETUJUI", "Entri yang dikoreksi sudah tidak berlaku.", "KOREKSI_TIDAK_SAH", 409);
        await tx.orderBiayaTanpaStok.update({ where: { id: lama.id }, data: { status: "DIGANTI" } }); // DULU, supaya indeks sumber tidak pernah melihat dua yang disetujui
        await catatEvent(tx, lama.id, "DIGANTI", user.id, `Diganti koreksi ${e.id}`, { status: "DISETUJUI" }, { status: "DIGANTI", penggantiId: e.id });
      }
      const s = await tx.orderBiayaTanpaStok.update({ where: { id: e.id }, data: { status: "DISETUJUI", diputuskanOleh: user.id, diputuskanPada: sekarang, catatanKeputusan: catatan ? String(catatan).slice(0, 500) : null, ...(harga ?? {}) } });
      await catatEvent(tx, e.id, "DISETUJUI", user.id, catatan, { status: "DIAJUKAN", statusHarga: e.statusHarga }, { status: "DISETUJUI", sidikHarga: h.sidik, ...(harga ? { keputusanHarga: { priceId: harga.priceId, harga: harga.hargaSatuan.toString(), alasan: harga.keputusanHargaAlasan } } : {}) });
      return { ulang: false, entri: s };
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  } catch (err) {
    if (err?.code === "P2002") throw new HppOrderError("Sumber ini sudah disetujui pada entri lain.", 409, "SUMBER_SUDAH_DIPAKAI");
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
  return { baris: rows.map((e) => { const b = tampilBiaya(e); return { ...b, unitKode: e.unit.unitCode, orderNomor: e.order.orderNumber, harga: izinHarga ? b.harga : null, subtotal: izinHarga ? b.subtotal : null,
    kandidatHarga: b.kandidatHarga ? b.kandidatHarga.map((k) => ({ ...k, harga: izinHarga ? Number(k.harga) : null })) : null }; }) };
}

export async function riwayatBiayaTanpaStok(db, id) {
  wajib(UUID.test(String(id ?? "")), "id tidak valid", "ID_TIDAK_VALID");
  return db.orderBiayaTanpaStokEvent.findMany({ where: { entryId: id }, orderBy: { createdAt: "asc" } });
}

// ───────────────────────────── KONFIRMASI PEMAKAIAN LENGKAP ─────────────────────────────
/** Ditolak bila masih ada biaya kosong (TANPA_HARGA/PERLU_KEPUTUSAN/belum dibekukan), catatan/pemakaian tertahan, atau biaya yang menunggu persetujuan. */
export async function konfirmasiLengkap(prisma, user, { unitId, sidik, alasan }, { kunci }) {
  wajib(bolehMencatat(user) || bolehMenyetujui(user), "Anda tidak punya akses mengonfirmasi pemakaian.", "TIDAK_BERWENANG", 403);
  wajib(UUID.test(String(unitId ?? "")), "unit tidak valid", "UNIT_TIDAK_VALID");
  wajib(typeof kunci === "string" && kunci.length >= 8 && kunci.length <= 120, "Kunci idempotensi wajib (8–120 karakter).", "KUNCI_WAJIB");
  const t = String(alasan ?? "").trim(); wajib(t.length >= 5 && t.length <= 300, "Keterangan konfirmasi wajib (5–300 karakter): siapa yang memeriksa dan dari catatan apa.", "ALASAN_WAJIB");
  const ada = await prisma.unitHppKonfirmasi.findUnique({ where: { idempotencyKey: kunci } }); if (ada) return { ulang: true, konfirmasi: ada };
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "units", unitId);
    const f = (await muatBiayaUnit(tx, [unitId])).get(unitId); const st = statusDariFakta(f);
    wajib(st.key === "SIAP_DIKONFIRMASI" || st.key === "KONFIRMASI_BASI", `Unit belum bisa dikonfirmasi lengkap: ${st.label}. ${st.langkah}`, "BELUM_SIAP_DIKONFIRMASI", 409,
      { status: st.key, biayaKosong: st.barisTanpaNilai, tertahan: st.tertahan, biayaDiajukan: st.biayaDiajukan });
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
 * Tiga kolom: (1) laba rugi menurut jurnal, (2) HPP operasional per order + cakupan, (3) hasil manajemen sementara + JEMBATAN dari laba jurnal.
 * Pencocokan: biaya bahan dihitung untuk order yang PENDAPATANNYA DIAKUI pada periode (jurnal PENGAKUAN_PENDAPATAN, neto pembalik) — seluruh pemakaian unitnya, kapan pun dipakai.
 * Setiap baris jurnal beban pokok diklasifikasi tepat satu kelompok (klasifikasiBarisJurnal); kontrol jembatan wajib cocok.
 */
export async function laporanHppOrder(prisma, { fromStr, toStr, izinHarga = false, bolehSensitif = false }) {
  const { from, to } = periodeValid({ fromStr, toStr });
  const jurnal = await jalankanBacaSaja(prisma, async (tx) => {
    const lr = await labaRugi(tx, { from, to });
    const baris = await muatBarisLabaRugi(tx, { from, to, bolehSensitif });
    const idBalik = [...new Set(baris.filter((r) => r.sumber === "REVERSAL" && r.akunTipe === "BEBAN_POKOK").map((r) => r.entryId))];
    const balik = idBalik.length ? await tx.finJournalEntry.findMany({ where: { id: { in: idBalik } }, select: { id: true, reversalOf: { select: { source: true, sourceId: true } } } }) : [];
    return { lr, baris, sumberAsal: new Map(balik.map((b) => [b.id, b.reversalOf?.sourceId ?? null])) };
  });
  const { lr, baris, sumberAsal } = jurnal;
  const pendapatanOrder = new Map(); const pendapatanTanpaOrder = [];
  for (const r of baris) {
    if (r.akunTipe !== "PENDAPATAN") continue;
    if (r.sumber === "PENGAKUAN_PENDAPATAN" && r.orderId) { const a = pendapatanOrder.get(r.orderId) ?? { nilai: [], nomor: r.orderNomor }; a.nilai.push(r.efek); pendapatanOrder.set(r.orderId, a); }
    else pendapatanTanpaOrder.push(r.efek);
  }
  const diakui = [...pendapatanOrder.entries()].map(([orderId, a]) => ({ orderId, orderNomor: a.nomor, pendapatan: moneyToNumber(sumMoney(a.nilai)) })).filter((o) => o.pendapatan !== 0);
  const idDiakui = new Set(diakui.map((o) => o.orderId));
  const unitsDiakui = idDiakui.size ? await prisma.unit.findMany({ where: { orderId: { in: [...idDiakui] }, status: { not: "CANCELLED" } }, select: { id: true, unitCode: true, orderId: true } }) : [];
  const unitDiakui = new Set(unitsDiakui.map((u) => u.id));
  const mulai = startOfDayWIB(fromStr);
  const bebanPokokBaris = baris.filter((r) => r.akunTipe === "BEBAN_POKOK");
  const unitJurnal = [...new Set(bebanPokokBaris.map((r) => r.unitId).filter(Boolean))];
  const kandidat = await prisma.stockMovement.findMany({ where: { unitId: { not: null }, type: { in: TIPE_OP }, createdAt: { gte: new Date(mulai.getTime() - 120 * 86_400_000) } }, select: { unitId: true }, distinct: ["unitId"] });
  const bts = await prisma.orderBiayaTanpaStok.findMany({ where: { status: "DISETUJUI", tanggalPemakaian: { gte: tglDate(fromStr), lte: tglDate(toStr) } }, select: { unitId: true } });
  const semuaUnit = [...new Set([...unitDiakui, ...unitJurnal, ...kandidat.map((k) => k.unitId), ...bts.map((b) => b.unitId)])];
  const fakta = await muatBiayaUnit(prisma, semuaUnit);
  const unitInfo = new Map((semuaUnit.length ? await prisma.unit.findMany({ where: { id: { in: semuaUnit } }, select: { id: true, unitCode: true, orderId: true, status: true, order: { select: { orderNumber: true, status: true } } } }) : []).map((u) => [u.id, u]));
  const dalam = (t) => !!t && t >= fromStr && t <= toStr;

  // ── jembatan: pergerakan di balik setiap baris jurnal PEMAKAIAN_BAHAN ber-unit ──
  const gerak = new Map(); for (const [, f] of fakta) for (const b of f.stok) gerak.set(b.id, b);
  const kelompokBernilai = new Map(); const pakaiNilaiJurnal = new Set();
  for (const r of bebanPokokBaris) {
    r.kunciKelompok = `${r.entryId}|${r.unitId ?? "-"}|${r.akunKode}`;
    const s = r.sumber === "REVERSAL" ? r.membalik?.sumber : r.sumber;
    if (s !== "PEMAKAIAN_BAHAN" || !r.unitId || kelompokBernilai.has(r.kunciKelompok)) continue;
    const src = r.sumber === "REVERSAL" ? sumberAsal.get(r.entryId) : r.sourceId;
    const dibalik = (fakta.get(r.unitId)?.stok ?? []).filter((b) => b.tipe !== "WASTE" && src && (b.id === src || b.materialIssueId === src));
    if (!dibalik.length) continue;
    const ok = dibalik.every((b) => b.status === "DIBEKUKAN");
    kelompokBernilai.set(r.kunciKelompok, ok);
    if (!ok && unitDiakui.has(r.unitId)) for (const b of dibalik) pakaiNilaiJurnal.add(b.id);
  }
  const tautan = await tautanSOAktif(prisma);
  const batasSO = [...tautan.values()].map((t) => t.soTanggal).filter(Boolean).sort().pop() ?? null;
  const klas = bebanPokokBaris.map((r) => ({ ...r, ...klasifikasiBarisJurnal(r, { unitDiakui, kelompokBernilai, batasSO }) }));

  // (2) per order berpendapatan diakui — pergerakan yang nilai jurnalnya dipakai dikeluarkan dari nilai operasional (tidak ganda)
  const nilaiOperasionalUnit = (u) => { const f = fakta.get(u); return r2([...f.stok.filter((b) => b.tipe !== "WASTE" && !pakaiNilaiJurnal.has(b.id)), ...f.biaya].filter((b) => b.status === "DIBEKUKAN").reduce((a, b) => a + Number(b.subtotal), 0)); };
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
  const bahanDiakui = r2(unitsDiakui.reduce((a, u) => a + nilaiOperasionalUnit(u.id), 0));
  const dikeluarkanKarenaJurnal = r2([...pakaiNilaiJurnal].map((id) => gerak.get(id)).filter((b) => b?.status === "DIBEKUKAN").reduce((a, b) => a + Number(b.subtotal), 0));

  // susut unit pada periode yang BELUM dijurnal di mana pun (yang sudah dijurnal tetap dihitung dari jurnalnya, di periode jurnalnya)
  const waste = []; for (const id of semuaUnit) { const u = unitInfo.get(id); if (!u || u.status === "CANCELLED") continue; for (const b of fakta.get(id).stok) if (b.tipe === "WASTE" && dalam(b.tanggalPemakaian)) waste.push(b); }
  const src = [...new Set(waste.flatMap((b) => [b.id, b.materialIssueId].filter(Boolean)))];
  const terjurnal = new Set(src.length ? (await prisma.finJournalEntry.findMany({ where: { source: "PEMAKAIAN_BAHAN", sourceId: { in: src }, status: { in: STATUS_DIHITUNG } }, select: { sourceId: true } })).map((e) => e.sourceId) : []);
  let susutBelumDijurnal = 0; let susutTanpaNilai = 0;
  for (const b of waste) { if (terjurnal.has(b.id) || (b.materialIssueId && terjurnal.has(b.materialIssueId))) continue; if (b.status === "DIBEKUKAN") susutBelumDijurnal += Number(b.subtotal); else susutTanpaNilai += 1; }

  // kelompok terpisah: biaya pada periode untuk order yang pendapatannya tidak diakui pada periode
  const belumDiakui = new Map();
  for (const id of semuaUnit) {
    const f = fakta.get(id); const u = unitInfo.get(id); if (!u || u.status === "CANCELLED" || idDiakui.has(u.orderId)) continue;
    const periode = [...f.stok.filter((b) => b.tipe !== "WASTE"), ...f.biaya].filter((b) => dalam(b.tanggalPemakaian)); if (!periode.length) continue;
    const g = belumDiakui.get(u.orderId) ?? { orderId: u.orderId, orderNomor: u.order?.orderNumber ?? null, statusOrder: u.order?.status ?? null, baris: 0, tanpaNilai: 0, nilaiDiketahui: 0 };
    g.baris += periode.length; g.tanpaNilai += periode.filter((b) => b.status !== "DIBEKUKAN").length; g.nilaiDiketahui += periode.filter((b) => b.status === "DIBEKUKAN").reduce((a, b) => a + Number(b.subtotal), 0);
    belumDiakui.set(u.orderId, g);
  }
  const daftarBelum = [...belumDiakui.values()].map((g) => ({ ...g, nilaiDiketahui: izinHarga ? r2(g.nilaiDiketahui) : null }));

  const akunBebanPokok = lr.bebanPokok.map((a) => ({ kode: a.kode ?? a.code ?? a.akunKode, nama: a.nama ?? a.name, nilai: Number(a.nilai) }));
  const mgmt = hasilManajemen({
    jurnal: { pendapatanBersih: lr.ringkasan.pendapatanBersih, bebanPokok: lr.ringkasan.bebanPokok, bebanOperasional: lr.ringkasan.bebanOperasional, labaBersih: lr.ringkasan.labaBersih, baris: klas },
    operasional: { bahanDiakui, susutBelumDijurnal: r2(susutBelumDijurnal), ...cakupan },
  });
  const sembunyi = (x) => (izinHarga ? x : null);
  const barisJembatan = klas.map((r) => ({ id: r.id, nomorJurnal: r.nomorJurnal, tanggal: r.tanggal, sumber: r.sumber, akunKode: r.akunKode, akunNama: r.akunNama, unitId: r.unitId, orderNomor: r.orderNomor, nilai: r.nilai, kelompok: r.kelompok, peran: r.peran, alasan: r.alasan, deskripsi: r.deskripsi }));
  return {
    periode: { from: fromStr, to: toStr }, diambilPada: new Date().toISOString(),
    jurnal: izinHarga ? { ringkasan: lr.ringkasan, akunBebanPokok, final: false, teks: "Angka jurnal resmi. HPP bahan jurnal belum mencerminkan pemakaian (pemakaian belum dicatat dan jurnal pemakaian tertahan selama persediaan awal belum diposting)." } : null,
    operasional: { cakupan, bahanDiakui: sembunyi(bahanDiakui), dikeluarkanKarenaNilaiJurnal: sembunyi(dikeluarkanKarenaJurnal), susutBelumDijurnal: sembunyi(r2(susutBelumDijurnal)), susutTanpaNilai, order: perOrder, pendapatanTanpaOrder: sembunyi(moneyToNumber(sumMoney(pendapatanTanpaOrder))),
      belumDiakui: { order: daftarBelum, nilaiDiketahui: sembunyi(r2(daftarBelum.reduce((a, g) => a + (g.nilaiDiketahui ?? 0), 0))), teks: "Pemakaian bahan pada periode untuk order yang pendapatannya TIDAK diakui pada periode ini (belum diserahkan, atau diakui di periode lain). Ditampilkan terpisah; tidak masuk hasil manajemen." },
      teks: "HPP operasional = Harga Berlaku Gudang pada waktu pemakaian (pengeluaran stok + biaya tanpa stok yang disetujui). Bukan jurnal. Nilai order hanya disebut lengkap bila semua unitnya lengkap." },
    manajemen: izinHarga ? { ...mgmt, barisJurnal: barisJembatan, batasSO } : { status: mgmt.status, final: false, teksStatus: mgmt.teksStatus, kontrolCocok: mgmt.kontrol.cocok },
    kelompokJurnal: KELOMPOK_JURNAL,
    pencegahanGanda: [
      "Tidak ada akun yang dikeluarkan utuh: setiap baris jurnal beban pokok diklasifikasi sendiri — hanya yang terbukti terwakili HPP operasional, milik order yang belum diakui, atau koreksi saldo lama yang dibalik; sisanya tetap dihitung.",
      "Baris jurnal pemakaian yang pergerakannya belum bernilai operasional: nilai jurnal dipakai dan nilai operasional pergerakan itu dikeluarkan (satu kali).",
      "Susut unit yang sudah dijurnal dihitung dari jurnal; susut tercatat Gudang yang belum dijurnal ditambahkan dari nilai operasional — tidak keduanya.",
      "Biaya tanpa stok: satu baris sumber = satu biaya (indeks unik database); pemakaian identik yang sudah ada ISSUE/catatan/biaya lain ditolak.",
      "Biaya order yang pendapatannya belum diakui ditampilkan terpisah, tidak ikut hasil periode.",
    ],
    saldoLama: "Selisih saldo persediaan lama (PSA/rekonsiliasi) adalah paket terpisah dan TIDAK dibebankan ke periode ini.",
  };
}
