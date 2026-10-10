// FASE 1 — LAPORAN KOHORT (BACA-SAJA): parameter, transaksi read-only, dan bentuk respons untuk endpoint admin.
// Tidak ada ID customer/order/pembayaran, nama, nomor, atau isi chat di respons — hanya agregat. Tidak ada field campaign/ad.
import { hitungKohort } from "./cohortLoader.js";
import { METRICS, TANGGAL, LEAD_EXCLUSION, STATUS } from "./cohortDefinitions.js";
import { bulanWIB } from "./cohort.js";

export const MAKS_BULAN = 24;
const RE_BULAN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export class ParameterError extends Error {
  constructor(message) { super(message); this.statusCode = 400; this.code = "PARAMETER_TIDAK_VALID"; }
}

const geserBulan = (ym, n) => {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const selisihBulan = (a, b) => {
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  return (yb * 12 + mb) - (ya * 12 + ma);
};
/** Hari terakhir bulan (YYYY-MM-DD) — batas atas muat customer. */
const hariTerakhir = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/**
 * Parameter: `dari` dan `sampai` = bulan WIB (YYYY-MM), inklusif. Default: `sampai` = bulan berjalan WIB, `dari` = 3 bulan sebelumnya.
 * Rentang paling lama MAKS_BULAN bulan. `sampai` tidak boleh di masa depan WIB.
 */
export function parseRentang(query = {}, now = new Date()) {
  const sekarang = bulanWIB(now);
  const sampai = query.sampai == null || query.sampai === "" ? sekarang : String(query.sampai);
  if (!RE_BULAN.test(sampai)) throw new ParameterError("Parameter 'sampai' harus berformat YYYY-MM (bulan WIB)");
  const dari = query.dari == null || query.dari === "" ? geserBulan(sampai, -3) : String(query.dari);
  if (!RE_BULAN.test(dari)) throw new ParameterError("Parameter 'dari' harus berformat YYYY-MM (bulan WIB)");
  if (dari > sampai) throw new ParameterError("'dari' tidak boleh sesudah 'sampai'");
  if (sampai > sekarang) throw new ParameterError("'sampai' tidak boleh di masa depan");
  if (selisihBulan(dari, sampai) + 1 > MAKS_BULAN) throw new ParameterError(`Rentang paling lama ${MAKS_BULAN} bulan`);
  return { dari, sampai, bulanBerjalan: sekarang };
}

const dalamRentang = (obj, { dari, sampai }) => Object.fromEntries(Object.entries(obj).filter(([m]) => m >= dari && m <= sampai));

// Jumlahkan daun numerik secara rekursif. Kunci yang bukan aditif (distinct per bulan) atau berupa peta bulan dilewati.
const LEWATI_JUMLAH = new Set(["customerUnik", "orderDibayar", "menurutBulanOrder", "menurutBulanPembayaran", "menurutBulanLunasMenurutCrm", "menurutBulanLunasTerbuktiLedger"]);
function jumlahkan(rows) {
  const out = {};
  const tambah = (dst, src) => {
    for (const [k, v] of Object.entries(src)) {
      if (LEWATI_JUMLAH.has(k)) continue;
      if (typeof v === "number") dst[k] = (dst[k] || 0) + v;
      else if (v && typeof v === "object" && !Array.isArray(v)) tambah((dst[k] ||= {}), v);
    }
  };
  for (const r of rows) tambah(out, r);
  return out;
}

const persen = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
/** Tambahkan persen cakupan ke setiap blok `cakupanLedger` (rekursif dangkal pada baris). */
function denganPersen(row) {
  if (row.cakupanLedger) row.cakupanLedger.persenOrderBerLedger = persen(row.cakupanLedger.orderBerLedger, row.cakupanLedger.orderEligible);
  return row;
}

/**
 * Susun respons dari hasil `buildCohort`. Murni (dites tanpa DB). `hasil.meta` berasal dari loader.
 */
export function susunLaporan(hasil, rentang, { dihitungPada = new Date() } = {}) {
  const perBulanLead = dalamRentang(hasil.perBulanLead, rentang);
  const perBulanOrder = dalamRentang(hasil.perBulanOrder, rentang);
  const perBulanPembayaran = dalamRentang(hasil.perBulanPembayaran, rentang);
  // Jumlahkan DULU dari angka mentah, baru tambahkan persen (rasio tidak boleh ikut dijumlahkan).
  const jumlahLead = jumlahkan(Object.values(perBulanLead));
  const jumlahOrder = jumlahkan(Object.values(perBulanOrder));
  const jumlahPembayaran = jumlahkan(Object.values(perBulanPembayaran));
  for (const r of [...Object.values(perBulanLead), ...Object.values(perBulanOrder), jumlahLead, jumlahOrder]) denganPersen(r);

  const peringatan = [];
  const w = (kode, pesan, data) => peringatan.push({ kode, pesan, ...(data ? { data } : {}) });

  const tanpaLedger = Object.entries(perBulanOrder).filter(([, b]) => b.cakupanLedger.orderTanpaLedger > 0)
    .map(([m, b]) => ({ bulanOrder: m, orderEligible: b.cakupanLedger.orderEligible, orderBerLedger: b.cakupanLedger.orderBerLedger, orderTanpaLedger: b.cakupanLedger.orderTanpaLedger }));
  if (tanpaLedger.length) {
    w("LEDGER_TIDAK_LENGKAP", "Sebagian order tidak punya pembayaran di ledger. `uangLedger` BUKAN total pemasukan untuk bulan-bulan ini; baca bersama `cakupanLedger`.", { perBulanOrder: tanpaLedger });
  }
  const konflik = jumlahOrder.buktiPelunasan || {};
  const nKonflik = (konflik.konflikLunasTersimpanLedgerTidakCukup || 0) + (konflik.konflikBelumLunasTersimpanLedgerCukup || 0);
  if (nKonflik > 0) {
    w("KONFLIK_STATUS_LUNAS_LEDGER",
      `${nKonflik} order status tersimpan dan ledger valid saling bertentangan (${konflik.konflikLunasTersimpanLedgerTidakCukup || 0} berstatus LUNAS tetapi ledger valid belum menutup tagihan, kekurangan Rp${konflik.kekuranganRupiahKonflik || 0}; ${konflik.konflikBelumLunasTersimpanLedgerCukup || 0} sebaliknya). ` +
      "Order konflik tetap masuk lunasMenurutCrm, TIDAK masuk lunasTerbuktiLedger, dan BUKAN DP selaras; kekurangan ledger dilaporkan terpisah (kekuranganRupiahKonflik). Penyebabnya tidak dapat disimpulkan dari data (pembayaran di luar sistem atau status keliru) dan tidak dikoreksi otomatis: anomali untuk Finance.",
      { konflikLunasTersimpanLedgerTidakCukup: konflik.konflikLunasTersimpanLedgerTidakCukup || 0, konflikBelumLunasTersimpanLedgerCukup: konflik.konflikBelumLunasTersimpanLedgerCukup || 0, kekuranganRupiahKonflik: konflik.kekuranganRupiahKonflik || 0 });
  }
  const lunasTanpaLedger = konflik.lunasTanpaLedger || 0;
  if (lunasTanpaLedger > 0) w("LUNAS_TANPA_LEDGER", `${lunasTanpaLedger} order LUNAS menurut CRM tanpa pembayaran di ledger (status manual/historis): masuk lunasMenurutCrm, belum terbukti ledger. Nilainya tidak masuk uangLedger.`, { jumlah: lunasTanpaLedger });
  const crmTotal = hasil.total?.lunasMenurutCrm || {};
  if ((crmTotal.tanggalTidakPasti || 0) > 0) {
    w("TANGGAL_LUNAS_TIDAK_PASTI", `${crmTotal.tanggalTidakPasti} order LUNAS menurut CRM (seluruh riwayat) bertanggal lunas hasil backfill 31 Agt 2026; tidak dimasukkan ke tren tanggal lunas mana pun.`, { jumlah: crmTotal.tanggalTidakPasti });
  }
  const dikunci = jumlahOrder.lunasMenurutCrm?.tanggalDikunciOwner || 0;
  if (dikunci > 0) w("TANGGAL_DIKUNCI_OWNER", `${dikunci} order LUNAS menurut CRM bertanggal dikunci pengecualian Owner: itu membuktikan tanggal yang dikunci, bukan uang diterima.`, { jumlah: dikunci });
  const tanpaTgl = jumlahLead.pernahDitandaiProspek?.tanpaTanggal || 0;
  if (tanpaTgl > 0) w("PROSPEK_TANPA_TANGGAL", `${tanpaTgl} lead berada di stage prospek-atau-lanjut tanpa riwayat transisi (tanggal ditandai tidak diketahui).`, { jumlah: tanpaTgl });
  const hanyaPending = jumlahLead.customerHanyaOrderPending || 0;
  if (hanyaPending > 0) w("SELISIH_DASHBOARD_PENDING", `${hanyaPending} customer hanya punya order PENDING: dihitung 'customer dengan order' oleh Dashboard, tidak oleh laporan ini.`, { jumlah: hanyaPending });
  const sebelumLead = jumlahOrder.orderSebelumLead || 0;
  if (sebelumLead > 0) w("ORDER_SEBELUM_LEAD", `${sebelumLead} order bertanggal sebelum customer-nya dibuat (anomali data); tidak dihitung sebagai 'lead lama'.`, { jumlah: sebelumLead });
  if (rentang.sampai >= rentang.bulanBerjalan) w("BULAN_BERJALAN", "Bulan berjalan belum selesai; angka bulan lead terbaru masih bertambah (kohort belum matang). Belum ada kebijakan jendela kematangan.");
  if (!hasil.rekonsiliasi.ok) w("REKONSILIASI_GAGAL", "Ada pemeriksaan rekonsiliasi internal yang gagal; jangan pakai angka ini sebelum ditinjau.", { gagal: hasil.rekonsiliasi.cek.filter((c) => !c.ok).map((c) => c.id) });

  return {
    versi: 1,
    dihitungPada: new Date(dihitungPada).toISOString(),
    zonaWaktu: "Asia/Jakarta (UTC+7); semua hari dan bulan = WIB",
    periode: { dari: rentang.dari, sampai: rentang.sampai, bulanBerjalan: rentang.bulanBerjalan },
    gerbangVerifikasi: hasil.meta?.gate || null,
    tanggal: TANGGAL,
    pengecualianLead: LEAD_EXCLUSION,
    definisi: METRICS.map(({ id, label, status, definisi, tanggal, catatan }) => ({ id, label, status, definisi, tanggal, catatan })),
    perBulanLead,
    perBulanOrder,
    perBulanPembayaran,
    jumlahPeriode: { perBulanLead: jumlahLead, perBulanOrder: jumlahOrder, perBulanPembayaran: jumlahPembayaran },
    riwayatPenuh: { total: hasil.total, luarKohort: hasil.luarKohort, bagianOrder: hasil.bagianOrder },
    rekonsiliasi: hasil.rekonsiliasi,
    peringatan,
    batasan: [
      "Atribusi campaign/ad set/ad belum tersedia (status BELUM_ADA_DATA); laporan ini tidak mengisi atau menebaknya.",
      "Tanggal lead = Customer.createdAt (waktu pesan pertama diproses), bukan waktu klik iklan dan bukan pesan inbound pertama.",
      "Tanggal pembayaran = Payment.createdAt (waktu dicatat/diverifikasi), bukan tanggal pada klaim lunas.",
      "perBulanLead memuat hasil sepanjang umur lead sampai saat dihitung (lintas bulan); perBulanOrder dan perBulanPembayaran memuat SEMUA lead (baru dan lama).",
      "Dua jenis lunas, tidak pernah ditukar: lunasMenurutCrm (status tersimpan; yang dilihat tampilan operasional) dan lunasTerbuktiLedger (ledger valid menutup seluruh tagihan).",
      "Booked value (nilaiOrder, nilai order lunas) dan uang diterima (uangLedger) adalah angka berbeda dan tidak dijumlahkan; uangLedger hanya mencakup order ber-ledger (lihat cakupanLedger).",
      "Tanggal dikunci pengecualian Owner hanya membuktikan tanggal, bukan uang.",
    ],
    statusMetrik: Object.fromEntries(METRICS.map((m) => [m.id, m.status])),
    kamusStatus: STATUS,
  };
}

/** Muat dari DB dalam transaksi READ ONLY (dipaksa Postgres) dengan statement_timeout, lalu susun laporan. */
export async function hitungLaporanKohort(db, rentang, { now = new Date(), timeoutMs = 25_000 } = {}) {
  const leadTo = hariTerakhir(rentang.sampai);
  const hasil = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(Number(timeoutMs)))}`);
    return hitungKohort(tx, { leadTo });
  }, { timeout: timeoutMs + 5_000, maxWait: 5_000 });
  return susunLaporan(hasil, rentang, { dihitungPada: now });
}
