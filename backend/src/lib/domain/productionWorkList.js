// DAFTAR KERJA STATUS PRODUKSI — fungsi MURNI (tanpa DB; diuji node --test).
//
// Satu baris per ORDER; unit di dalamnya. Empat makna status yang TIDAK dicampur dan TIDAK diturunkan satu dari yang lain:
//   1. status ORDER Sales      — Order.status apa adanya (Pengambilan · Diproses · Siap Kirim · Terkirim · Dibatalkan)
//   2. posisi FISIK unit       — fakta dokumen jemput/terima/kirim (posisiUnitOf)
//   3. status KERJA Admin      — catatan manual / bukti aplikasi / jadwal (effectiveWorkStatus)
//   4. tahap PRODUKSI (Meja)   — HANYA bila unit punya pekerjaan di alur Meja; tidak ada = "Belum di alur Meja", tidak pernah ditebak dari status lain
// "Perhatian utama" = satu alasan paling mendesak per unit/order, diturunkan dari fakta yang sudah tercatat (bukan dari tebakan).
//
// Order AKTIF = masih punya unit yang belum Terkirim/Dibatalkan. Order yang seluruh unitnya selesai/dibatalkan tidak memenuhi antrean aktif (tetap tersedia di Riwayat).

import { tindakanBerikutnya } from "./productionWorkStatus.js";

export const ATTENTION = Object.freeze({ HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 });
export const UNIT_SELESAI = Object.freeze(["DELIVERED", "CANCELLED"]);
export const isUnitAktif = (status) => !UNIT_SELESAI.includes(status);

/** Filter cepat daftar kerja (urutan = urutan chip). `needsLevel`: butuh perhatian minimal. */
export const WORK_FILTERS = Object.freeze([
  { key: "SEMUA", label: "Semua aktif" },
  { key: "PERLU_TINDAKAN", label: "Perlu tindakan" },
  { key: "BELUM_DITERIMA", label: "Belum diterima workshop" },
  { key: "BELUM_DIJADWALKAN", label: "Belum dijadwalkan" },
  { key: "DIKERJAKAN", label: "Dikerjakan" },
  { key: "TERTAHAN", label: "Tertunda / menunggu" },
  { key: "LEWAT_TARGET", label: "Lewat target" },
]);
export const WORK_FILTER_KEYS = Object.freeze(WORK_FILTERS.map((f) => f.key));
export const WORK_SORTS = Object.freeze([
  { key: "PERHATIAN", label: "Paling perlu tindakan" },
  { key: "TARGET", label: "Target terdekat" },
  { key: "TERBARU", label: "Order terbaru" },
  { key: "PELANGGAN", label: "Pelanggan A–Z" },
]);
export const WORK_SORT_KEYS = Object.freeze(WORK_SORTS.map((s) => s.key));

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const tanggalWib = (v) => { const t = new Date(v).getTime(); if (Number.isNaN(t)) return null; const d = new Date(t + 7 * 3600_000); return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

/** Apakah target sudah lewat (WIB) dan pekerjaan belum selesai. */
export function lewatTarget(targetAt, { now = new Date(), kerjaKey = null, unitStatus = null } = {}) {
  if (!targetAt || kerjaKey === "SELESAI" || !isUnitAktif(unitStatus)) return false;
  const t = new Date(targetAt).getTime(); if (Number.isNaN(t)) return false;
  const hariIni = Math.floor((now.getTime() + 7 * 3600_000) / 86_400_000); const hariTarget = Math.floor((t + 7 * 3600_000) / 86_400_000);
  return hariTarget < hariIni;
}

/**
 * Perhatian utama satu unit. Input = baris unit yang sudah diperkaya (productionOrderList.perkayaBarisUnit).
 * @returns {null | { kode:string, level:number, teks:string }}
 */
export function perhatianUnit(row, { now = new Date() } = {}) {
  if (!row || !isUnitAktif(row.status)) return null;
  const a = row.adopsi || {}; const kerja = a.kerja?.key; const posisi = a.posisi?.key; const orderStatus = row.order?.status;
  const hasil = (kode, level, teks) => ({ kode, level, teks });
  if (row.priorityDisplay?.key === "COMPLAINT") return hasil("KOMPLAIN", ATTENTION.HIGH, "Ada komplain terbuka untuk unit ini");
  // Sudah dijemput tetapi belum tercatat diterima: MENDESAK hanya bila ada tombol yang bisa menyelesaikannya (pekerjaan di alur Meja menunggu kedatangan). Tanpa itu hanya catatan ringan —
  // jangan menutupi alasan yang lebih penting dan jangan membuat hampir semua order tampak "mendesak".
  const belumDiterima = posisi === "SUDAH_DIJEMPUT";
  if (belumDiterima && row.alurMeja?.status === "PENDING_ARRIVAL") return hasil("BELUM_DITERIMA", ATTENTION.HIGH, "Menunggu diterima di workshop (alur Meja)");
  if (kerja === "TERTUNDA") return hasil("TERTUNDA", ATTENTION.HIGH, a.kerja?.manual?.note ? `Pekerjaan tertunda — ${a.kerja.manual.note}` : "Pekerjaan tertunda");
  if (lewatTarget(a.targetSelesai?.at, { now, kerjaKey: kerja, unitStatus: row.status })) return hasil("LEWAT_TARGET", ATTENTION.HIGH, `Lewat target ${tanggalWib(a.targetSelesai.at)}`);
  if (kerja === "MENUNGGU_QC") return hasil("MENUNGGU_QC", ATTENTION.MEDIUM, "Menunggu keputusan QC");
  if (kerja === "SELESAI" && ["RECEIVED", "IN_PRODUCTION"].includes(row.status)) return hasil("TANDAI_SIAP_KIRIM", ATTENTION.MEDIUM, "Pekerjaan selesai — tandai Siap Kirim");
  if (["PENDING", "PICKUP"].includes(orderStatus) && ["RECEIVED", "IN_PRODUCTION"].includes(row.status)) {
    return hasil("ORDER_MASIH_PENGAMBILAN", ATTENTION.MEDIUM, "Status order Sales masih Pengambilan padahal unit sudah dijemput");
  }
  if (!a.targetSelesai && ["RECEIVED", "IN_PRODUCTION"].includes(row.status) && kerja !== "SELESAI") return hasil("BELUM_ADA_TARGET", ATTENTION.MEDIUM, "Belum ada target selesai");
  if (belumDiterima) return hasil("BELUM_DITERIMA", ATTENTION.LOW, "Belum tercatat diterima di workshop");
  if (kerja === "BELUM_DIJADWALKAN" && ["RECEIVED", "IN_PRODUCTION"].includes(row.status)) return hasil("BELUM_DIJADWALKAN", ATTENTION.LOW, "Belum dijadwalkan");
  return null;
}

const KERJA_URUT = ["TERTUNDA", "MENUNGGU_QC", "DIKERJAKAN_ULANG", "DIKERJAKAN", "DIJADWALKAN", "BELUM_DIJADWALKAN", "SELESAI", "DIBATALKAN"];
const ringkasHitung = (labels) => { const m = new Map(); for (const l of labels) m.set(l, (m.get(l) || 0) + 1); return [...m].map(([label, jumlah]) => ({ label, jumlah })); };

/**
 * Rollup satu ORDER dari unit-unitnya (baris yang sudah diperkaya + `perhatian`). Tidak memalsukan: order campuran ditampilkan sebagai rincian ("2 di workshop · 1 menunggu diterima").
 */
export function ringkasOrder(unitRows, { now = new Date() } = {}) {
  const semua = unitRows || [];
  const aktif = semua.filter((u) => isUnitAktif(u.status));
  const dipakai = aktif.length ? aktif : semua;
  const dgnPerhatian = aktif.map((u) => ({ u, p: u.perhatian ?? perhatianUnit(u, { now }) })).filter((x) => x.p);
  dgnPerhatian.sort((x, y) => y.p.level - x.p.level);
  const utama = dgnPerhatian[0] ?? null;
  const targets = dipakai.map((u) => u.adopsi?.targetSelesai?.at).filter(Boolean).map((t) => new Date(t).getTime()).filter((t) => !Number.isNaN(t));
  const pics = [...new Set(dipakai.map((u) => u.adopsi?.pic?.nama).filter(Boolean))];
  const kerjaKeys = dipakai.map((u) => u.adopsi?.kerja?.key).filter(Boolean);
  const kerjaUtama = [...new Set(kerjaKeys)].sort((a, b) => KERJA_URUT.indexOf(a) - KERJA_URUT.indexOf(b))[0] ?? null;
  return {
    jumlahUnit: semua.length, jumlahAktif: aktif.length,
    posisi: ringkasHitung(dipakai.map((u) => u.adopsi?.posisi?.label).filter(Boolean)),
    kerja: ringkasHitung(dipakai.map((u) => u.adopsi?.kerja?.label).filter(Boolean)), kerjaUtama,
    targetTerdekat: targets.length ? new Date(Math.min(...targets)).toISOString() : null,
    pic: pics,
    perhatian: utama ? { ...utama.p, unitId: utama.u.id, unitCode: utama.u.unitCode } : null,
    perhatianLevel: utama?.p.level ?? ATTENTION.NONE,
    unitUtamaId: (utama?.u ?? dipakai[0])?.id ?? null,
    tindakan: (utama?.u ?? dipakai[0])?.adopsi?.tindakan ?? null,
  };
}

/** Apakah order (ringkasan + unit) lolos filter cepat. */
export function lolosFilter(filterKey, order, { now = new Date() } = {}) {
  const A = (u) => u.adopsi ?? u; // baris diperkaya (adopsi) ATAU unit datar hasil bentukUnit
  const aktif = (order.units || []).filter((u) => isUnitAktif(u.status));
  switch (filterKey) {
    case "PERLU_TINDAKAN": return order.ringkas.perhatianLevel >= ATTENTION.MEDIUM;
    case "BELUM_DITERIMA": return aktif.some((u) => A(u).posisi?.key === "SUDAH_DIJEMPUT");
    case "BELUM_DIJADWALKAN": return aktif.some((u) => A(u).kerja?.key === "BELUM_DIJADWALKAN");
    case "DIKERJAKAN": return aktif.some((u) => ["DIKERJAKAN", "DIKERJAKAN_ULANG"].includes(A(u).kerja?.key));
    case "TERTAHAN": return aktif.some((u) => ["TERTUNDA", "MENUNGGU_QC"].includes(A(u).kerja?.key));
    case "LEWAT_TARGET": return aktif.some((u) => lewatTarget(A(u).targetSelesai?.at, { now, kerjaKey: A(u).kerja?.key, unitStatus: u.status }));
    default: return true;
  }
}

const sortTarget = (a, b) => (a.ringkas.targetTerdekat ? new Date(a.ringkas.targetTerdekat).getTime() : Infinity) - (b.ringkas.targetTerdekat ? new Date(b.ringkas.targetTerdekat).getTime() : Infinity);
/** Urutan daftar order. Stabil: seri diputuskan target terdekat lalu order terbaru. */
export function urutkanOrder(orders, sortKey = "PERHATIAN") {
  const terbaru = (a, b) => new Date(b.dibuatAt).getTime() - new Date(a.dibuatAt).getTime();
  const salin = [...orders];
  switch (sortKey) {
    case "TARGET": return salin.sort((a, b) => sortTarget(a, b) || terbaru(a, b));
    case "TERBARU": return salin.sort(terbaru);
    case "PELANGGAN": return salin.sort((a, b) => String(a.pelanggan?.nama ?? "").localeCompare(String(b.pelanggan?.nama ?? ""), "id") || terbaru(a, b));
    default: return salin.sort((a, b) => b.ringkas.perhatianLevel - a.ringkas.perhatianLevel || sortTarget(a, b) || terbaru(a, b));
  }
}

/** Hitungan chip filter (di atas himpunan order aktif yang sudah dicari). */
export function hitungFilter(orders, { now = new Date() } = {}) {
  return Object.fromEntries(WORK_FILTER_KEYS.map((k) => [k, orders.filter((o) => lolosFilter(k, o, { now })).length]));
}

/**
 * Tindakan berikutnya yang BISA dikerjakan Admin dari ruang kerja ini. Aksi "Konfirmasi unit diterima di workshop" hanya punya tombol bila pekerjaan di alur Meja menunggu kedatangan (Terima Unit);
 * selain itu itu BUKAN tindakan Admin di sini → diganti tindakan berikutnya berdasarkan status kerja (tanpa menyimpulkan posisi), dan "belum tercatat diterima" tetap tampil sebagai catatan di perhatian.
 */
export function tindakanTersedia(adopsi, { unitStatus, alurMeja = null } = {}) {
  const t = adopsi?.tindakan;
  if (!t || t.aksi !== "CONFIRM_ARRIVAL" || alurMeja?.status === "PENDING_ARRIVAL") return t ?? null;
  return tindakanBerikutnya({ unitStatus, posisi: { key: "DI_WORKSHOP_TANPA_BUKTI" }, kerja: adopsi.kerja, adaTarget: !!adopsi.targetSelesai, rencanaBahanAda: !!adopsi.rencanaBahanAda, aktualAda: !!adopsi.aktualBahanAda });
}
