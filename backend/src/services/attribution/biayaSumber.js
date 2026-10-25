// BIAYA IKLAN TINGKAT SUMBER — input manual (harian / total rentang) + cakupan biaya per sumber + KPI biaya sumber (CPA, ROAS) dengan aturan null yang ketat.
//
// ATURAN (semua diuji):
//  • Tingkat SUMBER (META/TIKTOK/LAINNYA); TIDAK pernah dialokasikan ke campaign/ad. Spend per Ad (meta_ad_daily_spend) tidak disentuh. Organik: biaya TIDAK TERSEDIA (bukan Rp0).
//  • HARIAN = satu tanggal WIB. TOTAL_RENTANG = nominal untuk rentang tanggal PERSIS; tidak diprorata ke hari/campaign. Total rentang hanya dipakai bila rentang laporan MEMUAT seluruh rentangnya;
//    memotongnya (subrentang/tumpang-sebagian) → hari itu RENTANG_TIDAK_COCOK → KPI null.
//  • Input ulang dengan kunci yang sama (sumber, jenis, dari, sampai, akun) MEMPERBARUI entri yang sama; nilai sama = tidak ada perubahan (idempoten, tanpa revisi). Setiap perubahan → revisi append-only (lama/baru, alasan, pengubah, waktu).
//  • Entri aktif untuk sumber yang sama tidak boleh tumpang tindih tanggalnya (kecuali akun spesifik yang berbeda): konflik → ditolak (409), tidak ada hitung ganda.
//  • Detail Ad (Windsor/API/CSV) vs manual pada hari yang sama TIDAK dijumlah. Default: detail Ad menang dan entri manual diabaikan (terlihat sebagai manualDiabaikan). Hanya bila Admin menandai
//    override_ad_detail=true (alasan wajib), total manual menggantikan detail Ad untuk rentang itu PADA LEVEL SUMBER (detail Ad tetap untuk laporan campaign).
//    Total rentang non-override yang memuat hari ber-detail Ad diabaikan seluruhnya (tidak dijumlah sebagian).
//  • Rp0 terkonfirmasi = entri bernilai 0 (butuh konfirmasiNol=true); "belum diisi" = tidak ada entri. Hari tanpa data = HILANG → KPI null.
//  • Hari ini/hari berjalan tidak boleh diinput dan membuat KPI null (HARI_BERJALAN_PARSIAL).
//  • AUDIT penyimpanan lama: tabel AdSpend (Pengaturan Sales, per BULAN kalender, ikut jurnal Finance) TIDAK diubah dan tidak diduplikasi. Ia DIBACA sebagai sumber berprioritas TERENDAH, hanya untuk bulan
//    yang termuat PENUH oleh rentang laporan (diperlakukan seperti total rentang: tidak diprorata). Nominal 0 = belum diisi (diabaikan). Bila ada entri sumber aktif pada bulan itu → AdSpend diabaikan (tidak ada hitung ganda).
import crypto from "node:crypto";

export const SUMBER_BERBIAYA = Object.freeze(["META", "TIKTOK", "LAINNYA"]);
export const JENIS_ENTRI = Object.freeze(["HARIAN", "TOTAL_RENTANG"]);
export const MAKS_HARI_ENTRI = 93;
const TGL_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOMINAL_RE = /^\d{1,13}(\.\d{1,2})?$/;
const AKUN_RE = /^\d{5,32}$/;
const DAY = 86_400_000;

export class ErrBiaya extends Error { constructor(m, status = 400, kode = "BIAYA_TIDAK_VALID", data = null) { super(m); this.statusCode = status; this.code = kode; this.data = data; } }

export const tglValid = (s) => TGL_RE.test(String(s)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export const tambahHari = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const selisihHari = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export const hariRentang = (dari, sampai) => { const o = []; if (dari > sampai) return o; for (let d = dari; d <= sampai; d = tambahHari(d, 1)) { o.push(d); if (o.length > 400) break; } return o; };
export const hariIniWib = (now = new Date()) => new Date(now.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
const rp = (x) => Math.round((Number(x) || 0) * 100) / 100;

/** Validasi masukan entri. Murni. → { data } | { galat, kode, status } */
export function validasiMasukan(b, { hariIni }) {
  const gagal = (galat, kode = "BIAYA_TIDAK_VALID", status = 400) => ({ galat, kode, status });
  if (!b || typeof b !== "object") return gagal("Isi permintaan tidak valid");
  const sumber = String(b.sumber ?? "").toUpperCase();
  if (!SUMBER_BERBIAYA.includes(sumber)) return gagal(`Sumber biaya harus salah satu: ${SUMBER_BERBIAYA.join(", ")}. Sumber organik tidak punya biaya iklan yang dialokasikan.`, "SUMBER_TIDAK_BERBIAYA");
  const jenis = String(b.jenis ?? "").toUpperCase();
  if (!JENIS_ENTRI.includes(jenis)) return gagal(`jenis harus ${JENIS_ENTRI.join(" atau ")}`, "JENIS_TIDAK_VALID");
  const dari = String(b.dari ?? ""); const sampai = jenis === "HARIAN" ? dari : String(b.sampai ?? "");
  if (!tglValid(dari) || !tglValid(sampai)) return gagal("Tanggal harus YYYY-MM-DD (WIB) dan valid", "TANGGAL_TIDAK_VALID");
  if (dari > sampai) return gagal("'dari' tidak boleh sesudah 'sampai'", "TANGGAL_TIDAK_VALID");
  if (sampai >= hariIni) return gagal(`Tanggal terakhir harus sebelum hari ini (${hariIni}); biaya hari berjalan belum final`, "HARI_BERJALAN", 400);
  if (selisihHari(dari, sampai) + 1 > MAKS_HARI_ENTRI) return gagal(`Rentang paling lama ${MAKS_HARI_ENTRI} hari`, "RENTANG_TERLALU_PANJANG");
  let akun = b.akun == null ? "" : String(b.akun).trim().replace(/^act_/i, "");
  if (akun !== "" && !AKUN_RE.test(akun)) return gagal("Akun harus berupa ID digit (5–32) atau kosong", "AKUN_TIDAK_VALID");
  if (b.nominal === undefined || b.nominal === null || (typeof b.nominal === "string" && b.nominal.trim() === "")) return gagal("Nominal wajib diisi (Rp0 harus dikonfirmasi eksplisit)", "NOMINAL_KOSONG");
  if (typeof b.nominal !== "string" && typeof b.nominal !== "number") return gagal("Nominal harus angka", "NOMINAL_TIDAK_VALID");
  const teks = typeof b.nominal === "number" ? (Number.isFinite(b.nominal) ? String(b.nominal) : "x") : b.nominal.trim();
  if (/^-/.test(teks)) return gagal("Nominal tidak boleh negatif", "NOMINAL_NEGATIF");
  if (/[eE]/.test(teks)) return gagal("Notasi ilmiah tidak diterima; tulis angka biasa", "NOMINAL_TIDAK_VALID");
  if (!NOMINAL_RE.test(teks)) return gagal("Nominal harus angka tanpa pemisah ribuan/koma (maks 2 desimal), mis. 1500000 atau 1500000.50", "NOMINAL_TIDAK_VALID");
  const nominal = rp(teks);
  if (nominal === 0 && b.konfirmasiNol !== true) return gagal("Rp0 harus dikonfirmasi (konfirmasiNol: true) — Rp0 berbeda dari 'belum diisi'", "NOL_BELUM_DIKONFIRMASI");
  const alasan = String(b.alasan ?? "").trim();
  if (alasan.length < 5 || alasan.length > 300) return gagal("Alasan wajib diisi (5–300 karakter): sumber angka/bukti", "ALASAN_WAJIB");
  const override = b.gantiDetailAd === true;
  if (override && sumber !== "META") return gagal("Mengganti detail Ad hanya untuk sumber META (sumber lain tidak punya detail Ad)", "OVERRIDE_TIDAK_VALID");
  return { data: { sumber, jenis, dari, sampai, akun, nominal, alasan, override, dryRun: b.dryRun === true } };
}

const tumpang = (a, b) => a.dateFrom <= b.dateTo && a.dateTo >= b.dateFrom;
const kunci = (e) => `${e.sourceId}|${e.kind}|${e.dateFrom}|${e.dateTo}|${e.accountId}`;
/** Rencana penyimpanan. Murni. semua = entri yang ada (aktif + dibatalkan) bentuk { id, sourceId, kind, dateFrom, dateTo, accountId, amount(Number), override, status }. */
export function rencanakan(i, semua) {
  const baru = { sourceId: i.sumber, kind: i.jenis, dateFrom: i.dari, dateTo: i.sampai, accountId: i.akun };
  const sama = semua.find((e) => kunci(e) === kunci(baru)) ?? null;
  const konflik = semua.filter((e) => e.status === "AKTIF" && e.id !== sama?.id && e.sourceId === i.sumber && tumpang(e, baru) && (e.accountId === i.akun || e.accountId === "" || i.akun === ""));
  if (konflik.length) return { aksi: "KONFLIK", konflik: konflik.map((e) => ({ id: e.id, jenis: e.kind, dari: e.dateFrom, sampai: e.dateTo, akun: e.accountId, nominal: e.amount })), sama };
  if (!sama) return { aksi: "BARU", sama: null };
  const tetap = rp(sama.amount) === i.nominal && sama.override === i.override && sama.status === "AKTIF";
  if (tetap) return { aksi: "TIDAK_BERUBAH", sama };
  return { aksi: sama.status === "DIBATALKAN" ? "AKTIFKAN" : "UBAH", sama };
}

/**
 * CAKUPAN biaya satu sumber pada rentang laporan. Murni.
 * entries: entri sumber itu (aktif/batal bebas; dibatalkan diabaikan). adHarian: Map(ymd → number) detail Ad level sumber (hanya META) atau null.
 * adSumber (opsional): Map(ymd → string[]) asal baris detail (META_MARKETING_API / WINDSOR_API / ADS_MANAGER_CSV) — hanya untuk menjelaskan pilihan.
 *
 * PRIORITAS per hari (satu sumber angka per hari, TIDAK PERNAH dijumlah):
 *   1. entri manual bertanda 'ganti detail Ad' (override eksplisit)      → MANUAL_OVERRIDE
 *   2. detail Ad (API > Windsor > CSV per Ad)                             → AD_DETAIL
 *   3. entri manual harian / total rentang (hanya hari TANPA detail Ad)   → MANUAL_HARIAN / MANUAL_BLOK
 *   4. tidak ada                                                          → HILANG
 * DETAIL AD PARSIAL: kelengkapan per-Ad tidak dapat dibuktikan dari data Ad saja. Bukti yang tersedia = pembanding manual: bila entri manual (tanpa override) pada hari/rentang yang
 * punya detail Ad LEBIH BESAR dari jumlah detail Ad (selisih > Rp1), detail dianggap mungkin parsial → status DETAIL_AD_SELISIH (KPI null), BUKAN LENGKAP. Jalan keluar: impor detail
 * yang kurang, batalkan entri manual yang keliru, atau tandai 'ganti detail Ad' (pilihan sadar Admin; alasan tercatat). Manual lebih KECIL dari detail → detail dipakai (hanya informasi).
 */
export function hitungCakupan({ dari, sampai, hariIni, entries, adHarian = null, adSumber = null }) {
  const kemarin = tambahHari(hariIni, -1);
  const akhirPenuh = sampai < hariIni ? sampai : kemarin;
  const hari = hariRentang(dari, akhirPenuh);
  const termasukHariBerjalan = sampai >= hariIni;
  const aktif = entries.filter((e) => e.status === "AKTIF");
  const covers = (e, d) => e.dateFrom <= d && d <= e.dateTo;
  const muat = (e) => e.kind === "TOTAL_RENTANG" && e.dateFrom >= dari && e.dateTo <= sampai;   // total rentang hanya dipakai bila dimuat PENUH oleh rentang laporan
  const adAda = (d) => !!adHarian && adHarian.has(d);
  const blokAdaDetail = new Map(); for (const e of aktif) if (e.kind === "TOTAL_RENTANG") blokAdaDetail.set(e.id, hariRentang(e.dateFrom, e.dateTo).some(adAda));
  let spend = 0; let terisi = 0; const status = { adDetail: 0, manualHarian: 0, manualBlok: 0, override: 0 }; const hilang = []; const tidakCocok = []; const manualDiabaikan = []; const blokDipakai = new Set(); const entriTerpakai = new Set();
  const detailAdHari = []; const hasilHari = {}; const asalDetail = {};
  for (const d of hari) {
    const cover = aktif.filter((e) => covers(e, d));
    const ov = cover.filter((e) => e.override);
    let st = null;
    if (ov.length) {
      if (ov.some((e) => e.kind === "TOTAL_RENTANG" && !muat(e))) st = "RENTANG_TIDAK_COCOK";
      else { st = "MANUAL_OVERRIDE"; for (const e of ov) { entriTerpakai.add(e.id); if (e.kind === "HARIAN") spend += Number(e.amount); else if (!blokDipakai.has(e.id)) { blokDipakai.add(e.id); spend += Number(e.amount); } } if (adAda(d)) detailAdHari.push(d); status.override++; }
    } else if (adAda(d)) {
      st = "AD_DETAIL"; spend += Number(adHarian.get(d)); status.adDetail++; if (cover.length) manualDiabaikan.push(d);
      for (const sr of (adSumber && adSumber.get(d)) || []) asalDetail[sr] = (asalDetail[sr] || 0) + 1;
    } else if (cover.length) {
      if (cover.some((e) => e.kind === "TOTAL_RENTANG" && !muat(e))) st = "RENTANG_TIDAK_COCOK";
      else {
        const dipakai = cover.filter((e) => e.kind === "HARIAN" || !blokAdaDetail.get(e.id));
        if (dipakai.length === 0) { st = "HILANG"; manualDiabaikan.push(d); }
        else { st = dipakai.some((e) => e.kind === "TOTAL_RENTANG") ? "MANUAL_BLOK" : "MANUAL_HARIAN"; for (const e of dipakai) { entriTerpakai.add(e.id); if (e.kind === "HARIAN") { spend += Number(e.amount); } else if (!blokDipakai.has(e.id)) { blokDipakai.add(e.id); spend += Number(e.amount); } } if (st === "MANUAL_BLOK") status.manualBlok++; else status.manualHarian++; }
      }
    } else st = "HILANG";
    hasilHari[d] = st;
    if (st === "HILANG") hilang.push(d); else if (st === "RENTANG_TIDAK_COCOK") tidakCocok.push(d); else terisi++;
  }

  // PEMBANDING detail Ad vs manual (tanpa override) — satu-satunya bukti kelengkapan detail per-Ad.
  const selisih = []; const blokDitolak = [];
  const toleransi = 1;
  for (const e of aktif.filter((x) => !x.override)) {
    const hs = hariRentang(e.dateFrom, e.dateTo).filter((d) => d >= dari && d <= akhirPenuh);
    if (e.kind === "HARIAN") {
      if (!adAda(e.dateFrom) || !hs.length) continue;
      const det = Number(adHarian.get(e.dateFrom)), man = Number(e.amount);
      selisih.push({ jenis: "HARIAN", dari: e.dateFrom, sampai: e.dateTo, detail: rp(det), manual: rp(man), entriId: e.id, manualLebihBesar: man - det > toleransi, manualLebihKecil: det - man > toleransi });
    } else if (muat(e)) {
      const semua = hariRentang(e.dateFrom, e.dateTo); const dgDetail = semua.filter(adAda);
      if (dgDetail.length === 0) continue;
      if (dgDetail.length === semua.length) {
        const det = dgDetail.reduce((a, d) => a + Number(adHarian.get(d)), 0), man = Number(e.amount);
        selisih.push({ jenis: "TOTAL_RENTANG", dari: e.dateFrom, sampai: e.dateTo, detail: rp(det), manual: rp(man), entriId: e.id, manualLebihBesar: man - det > toleransi, manualLebihKecil: det - man > toleransi });
      } else {
        blokDitolak.push({ entriId: e.id, dari: e.dateFrom, sampai: e.dateTo, nominal: rp(e.amount), hariDenganDetail: dgDetail.length, hariTotal: semua.length, alasan: "DETAIL_AD_SEBAGIAN_HARI" });
      }
    }
  }
  const selisihMasalah = selisih.filter((x) => x.manualLebihBesar);

  let statusBiaya;
  if (tidakCocok.length) statusBiaya = "RENTANG_TIDAK_COCOK";
  else if (selisihMasalah.length) statusBiaya = "DETAIL_AD_SELISIH";
  else if (hilang.length && hilang.length === hari.length) statusBiaya = "BELUM_DIISI";
  else if (hilang.length) statusBiaya = "SPEND_TIDAK_LENGKAP";
  else if (termasukHariBerjalan) statusBiaya = "HARI_BERJALAN_PARSIAL";
  else statusBiaya = "LENGKAP";

  // ALASAN PEMILIHAN: setiap angka yang masuk ke spend punya sumber + alasan yang dapat dibaca Admin.
  const asalTeks = Object.entries(asalDetail).map(([k, v]) => `${{ META_MARKETING_API: "API Meta", WINDSOR_API: "Windsor", ADS_MANAGER_CSV: "CSV Ads Manager" }[k] || k} ${v} hari`).join(", ");
  const pemilihan = [];
  if (status.override) pemilihan.push({ kode: "MANUAL_OVERRIDE", hari: status.override, alasan: "Entri manual bertanda 'ganti detail Ad' dipakai menggantikan detail Ad (pilihan sadar Admin; alasan tercatat di riwayat). Detail Ad tidak dijumlahkan." });
  if (status.adDetail) pemilihan.push({ kode: "AD_DETAIL", hari: status.adDetail, asal: asalDetail, alasan: `Detail Ad dipakai${asalTeks ? ` (${asalTeks})` : ""}: hari itu punya baris spend per Ad. Detail diutamakan atas entri manual; satu sumber angka per hari, tidak dijumlah.` });
  if (status.manualHarian) pemilihan.push({ kode: "MANUAL_HARIAN", hari: status.manualHarian, alasan: "Entri harian manual dipakai karena hari itu TIDAK punya detail Ad." });
  if (status.manualBlok) pemilihan.push({ kode: "MANUAL_BLOK", hari: status.manualBlok, alasan: "Total rentang manual dipakai (dihitung sekali, tidak diprorata) karena tidak ada hari dalam rentang itu yang punya detail Ad." });
  for (const x of selisihMasalah) pemilihan.push({ kode: "DETAIL_AD_SELISIH", dari: x.dari, sampai: x.sampai, detail: x.detail, manual: x.manual, alasan: `Manual (${x.manual}) LEBIH BESAR dari detail Ad (${x.detail}) pada ${x.dari === x.sampai ? x.dari : x.dari + "–" + x.sampai}: detail Ad kemungkinan PARSIAL, sehingga biaya sumber tidak dianggap lengkap. Impor detail yang kurang, batalkan entri manual yang keliru, atau tandai 'ganti detail Ad'.` });
  for (const x of selisih.filter((y) => y.manualLebihKecil)) pemilihan.push({ kode: "MANUAL_LEBIH_KECIL", dari: x.dari, sampai: x.sampai, detail: x.detail, manual: x.manual, alasan: `Manual (${x.manual}) lebih kecil dari detail Ad (${x.detail}) pada ${x.dari === x.sampai ? x.dari : x.dari + "–" + x.sampai}: detail Ad dipakai (informasi; periksa bila angka manual yang benar).` });
  for (const x of blokDitolak) pemilihan.push({ kode: "BLOK_DITOLAK_DETAIL_SEBAGIAN", dari: x.dari, sampai: x.sampai, nominal: x.nominal, alasan: `Total rentang ${x.dari}–${x.sampai} (${x.nominal}) TIDAK dipakai: ${x.hariDenganDetail} dari ${x.hariTotal} harinya sudah punya detail Ad (agar tidak dihitung ganda). Hari tanpa detail tetap kosong sampai diisi harian/diimpor, atau tandai total itu 'ganti detail Ad'.` });
  if (hilang.length) pemilihan.push({ kode: "HILANG", hari: hilang.length, alasan: "Tidak ada detail Ad maupun entri manual yang dapat dipakai pada hari-hari ini." });
  if (tidakCocok.length) pemilihan.push({ kode: "RENTANG_TIDAK_COCOK", hari: tidakCocok.length, alasan: "Total rentang manual tidak termuat penuh oleh periode laporan; tidak diprorata, sehingga tidak dipakai." });

  return {
    status: statusBiaya, spend: terisi > 0 ? rp(spend) : null, spendLengkap: statusBiaya === "LENGKAP", termasukHariBerjalan, hariPenuh: hari.length,
    hari: status, hariHilang: hilang, hariRentangTidakCocok: tidakCocok, manualDiabaikanHari: manualDiabaikan, overrideMenggantikanDetailHari: detailAdHari,
    asalDetailAd: asalDetail, selisihDetailManual: selisih, blokDitolak, pemilihan,
    entriTerpakai: [...entriTerpakai], aturan: "Prioritas per hari: override manual eksplisit > detail Ad (API > Windsor > CSV per Ad) > entri manual (hanya hari tanpa detail). Total rentang hanya dipakai bila dimuat penuh oleh rentang laporan. Tidak pernah dijumlah ganda; detail Ad parsial (manual > detail) tidak dianggap lengkap.",
  };
}

/** KPI biaya satu sumber dari cakupan + hasil kohort (customer unik). Murni. */
export function biayaKpiSumber({ cakupan, jenis, lead, leadSah, lunas, nilaiOrder, uangBersih, ledger, hariIni, sampai }) {
  if (jenis === "ORGANIK") return { dasar: "ATRIBUSI_LABEL_CRM", status: "TIDAK_TERSEDIA_ORGANIK", spend: null, spendLengkap: false, sementara: false, alasanSementara: [], cpl: null, cpa: null, bookedRoas: null, cashRoas: null, alasanNull: { cpl: "TIDAK_ADA_BIAYA_DIALOKASIKAN", cpa: "TIDAK_ADA_BIAYA_DIALOKASIKAN", bookedRoas: "TIDAK_ADA_BIAYA_DIALOKASIKAN", cashRoas: "TIDAK_ADA_BIAYA_DIALOKASIKAN" }, cakupan: null };
  const st = cakupan.status; const lengkap = st === "LENGKAP";
  const alasanNull = {};
  const nullAll = (a) => { for (const k of ["cpl", "cpa", "bookedRoas", "cashRoas"]) alasanNull[k] = a; };
  let cpl = null, cpa = null, bookedRoas = null, cashRoas = null;
  if (!lengkap) nullAll(st);
  else {
    const S = cakupan.spend ?? 0;
    cpl = lead > 0 ? rp(S / lead) : null; if (cpl === null) alasanNull.cpl = "BELUM_ADA_LEAD";
    cpa = lunas > 0 ? rp(S / lunas) : null; if (cpa === null) alasanNull.cpa = "BELUM_ADA_KONVERSI";
    if (S > 0) { bookedRoas = rp(nilaiOrder / S); cashRoas = rp(uangBersih / S); } else { alasanNull.bookedRoas = "SPEND_NOL"; alasanNull.cashRoas = "SPEND_NOL"; }
  }
  const alasanSementara = [];
  if (lengkap) {
    if (ledger && ledger.orderEligible > 0 && ledger.orderBerLedger < ledger.orderEligible) alasanSementara.push(`LEDGER_PARSIAL: ${ledger.orderBerLedger} dari ${ledger.orderEligible} order punya pembayaran di ledger — customer lunas adalah batas bawah`);
    if (sampai > tambahHari(hariIni, -30)) alasanSementara.push("KOHORT_BELUM_MATANG: lead dalam 30 hari terakhir masih dapat berubah menjadi lunas");
  }
  return { dasar: "ATRIBUSI_LABEL_CRM", status: st, spend: cakupan.spend, spendLengkap: lengkap, sementara: lengkap && alasanSementara.length > 0, alasanSementara, cpl, cpa, bookedRoas, cashRoas, alasanNull, penyebut: { lead, leadSah, customerLunas: lunas }, cakupan };
}

// ── persistensi (SQL mentah; tabel baru tanpa bergantung pada klien Prisma yang dihasilkan) ─────────────────────────────────────────────
const dariBaris = (r) => ({ id: r.id, sourceId: r.source_id, kind: r.kind, dateFrom: r.d1, dateTo: r.d2, accountId: r.account_id, amount: Number(r.amount), override: r.override_ad_detail, status: r.status, reason: r.reason, revision: r.revision, createdById: r.created_by_id, updatedById: r.updated_by_id, diubahPada: r.updated_at });
const SEL = `id::text id, source_id, kind, to_char(date_from,'YYYY-MM-DD') d1, to_char(date_to,'YYYY-MM-DD') d2, account_id, amount::text amount, override_ad_detail, status, reason, revision, created_by_id, updated_by_id, updated_at`;

export async function daftarEntri(db, { sumber = null, dari = null, sampai = null, termasukBatal = true } = {}) {
  const rows = await db.$queryRawUnsafe(`select ${SEL} from ad_source_spend_entries where ($1::text is null or source_id = $1) and ($2::date is null or date_to >= $2::date) and ($3::date is null or date_from <= $3::date) and ($4::boolean or status = 'AKTIF') order by source_id, date_from, date_to, account_id`, sumber, dari, sampai, termasukBatal);
  return rows.map(dariBaris);
}
export async function riwayatEntri(db, id) {
  const rows = await db.$queryRawUnsafe(`select revision, action, prev_amount::text prev_amount, new_amount::text new_amount, prev_status, new_status, prev_override, new_override, reason, changed_by_id, changed_at from ad_source_spend_revisions where entry_id = $1::uuid order by revision`, id);
  return rows.map((r) => ({ revisi: r.revision, aksi: r.action, nominalLama: r.prev_amount === null ? null : Number(r.prev_amount), nominalBaru: Number(r.new_amount), statusLama: r.prev_status, statusBaru: r.new_status, overrideLama: r.prev_override, overrideBaru: r.new_override, alasan: r.reason, olehId: r.changed_by_id, waktu: r.changed_at }));
}

/** Simpan (buat/ubah/aktifkan) satu entri. dryRun → hanya rencana. Idempoten. Satu transaksi + kunci advisory (serialisasi penulis). */
export async function simpanEntri(prisma, masukan, { aktor, now = new Date() }) {
  const v = validasiMasukan(masukan, { hariIni: hariIniWib(now) });
  if (v.galat) throw new ErrBiaya(v.galat, v.status, v.kode);
  const i = v.data;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("select pg_advisory_xact_lock(hashtext('ad_source_spend_entries'))");
    const semua = (await tx.$queryRawUnsafe(`select ${SEL} from ad_source_spend_entries where source_id = $1`, i.sumber)).map(dariBaris);
    const r = rencanakan(i, semua);
    const ringkas = { aksi: r.aksi, sumber: i.sumber, jenis: i.jenis, dari: i.dari, sampai: i.sampai, akun: i.akun || null, nominal: i.nominal, gantiDetailAd: i.override, dryRun: i.dryRun };
    if (r.aksi === "KONFLIK") throw new ErrBiaya("Entri biaya tumpang tindih dengan entri aktif lain untuk sumber yang sama — ubah/batalkan yang lama dulu (tidak boleh ada hitung ganda)", 409, "BIAYA_KONFLIK", { konflik: r.konflik });
    if (i.dryRun || r.aksi === "TIDAK_BERUBAH") return { ...ringkas, id: r.sama?.id ?? null, perubahan: r.sama && r.aksi !== "TIDAK_BERUBAH" ? { nominalLama: r.sama.amount, nominalBaru: i.nominal } : null, ditulis: false };
    const aktorId = aktor?.id ?? null;
    if (r.aksi === "BARU") {
      const id = crypto.randomUUID();
      await tx.$executeRawUnsafe(`insert into ad_source_spend_entries (id, source_id, kind, date_from, date_to, account_id, currency, amount, override_ad_detail, status, reason, revision, created_by_id, updated_by_id, created_at, updated_at) values ($1::uuid,$2,$3,$4::date,$5::date,$6,'IDR',$7::numeric,$8,'AKTIF',$9,1,$10,$10,now(),now())`, id, i.sumber, i.jenis, i.dari, i.sampai, i.akun, String(i.nominal), i.override, i.alasan, aktorId);
      await tx.$executeRawUnsafe(`insert into ad_source_spend_revisions (id, entry_id, revision, action, prev_amount, new_amount, prev_status, new_status, prev_override, new_override, reason, changed_by_id) values ($1::uuid,$2::uuid,1,'BUAT',null,$3::numeric,null,'AKTIF',null,$4,$5,$6)`, crypto.randomUUID(), id, String(i.nominal), i.override, i.alasan, aktorId);
      return { ...ringkas, id, revisi: 1, ditulis: true };
    }
    const lama = r.sama; const rev = lama.revision + 1; const aksi = r.aksi === "AKTIFKAN" ? "AKTIFKAN" : "UBAH";
    await tx.$executeRawUnsafe(`update ad_source_spend_entries set amount = $2::numeric, override_ad_detail = $3, status = 'AKTIF', reason = $4, revision = $5, updated_by_id = $6, updated_at = now() where id = $1::uuid`, lama.id, String(i.nominal), i.override, i.alasan, rev, aktorId);
    await tx.$executeRawUnsafe(`insert into ad_source_spend_revisions (id, entry_id, revision, action, prev_amount, new_amount, prev_status, new_status, prev_override, new_override, reason, changed_by_id) values ($1::uuid,$2::uuid,$3,$4,$5::numeric,$6::numeric,$7,'AKTIF',$8,$9,$10,$11)`, crypto.randomUUID(), lama.id, rev, aksi, String(lama.amount), String(i.nominal), lama.status, lama.override, i.override, i.alasan, aktorId);
    return { ...ringkas, id: lama.id, revisi: rev, perubahan: { nominalLama: lama.amount, nominalBaru: i.nominal, statusLama: lama.status }, ditulis: true };
  }, { timeout: 20_000, maxWait: 5_000 });
}

export async function batalkanEntri(prisma, { id, alasan, aktor }) {
  const a = String(alasan ?? "").trim(); if (a.length < 5 || a.length > 300) throw new ErrBiaya("Alasan pembatalan wajib diisi (5–300 karakter)", 400, "ALASAN_WAJIB");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) throw new ErrBiaya("Entri tidak ditemukan", 404, "TIDAK_ADA");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("select pg_advisory_xact_lock(hashtext('ad_source_spend_entries'))");
    const [row] = (await tx.$queryRawUnsafe(`select ${SEL} from ad_source_spend_entries where id = $1::uuid`, id)).map(dariBaris);
    if (!row) throw new ErrBiaya("Entri tidak ditemukan", 404, "TIDAK_ADA");
    if (row.status === "DIBATALKAN") return { id, status: "DIBATALKAN", ditulis: false };
    const rev = row.revision + 1;
    await tx.$executeRawUnsafe(`update ad_source_spend_entries set status = 'DIBATALKAN', reason = $2, revision = $3, updated_by_id = $4, updated_at = now() where id = $1::uuid`, id, a, rev, aktor?.id ?? null);
    await tx.$executeRawUnsafe(`insert into ad_source_spend_revisions (id, entry_id, revision, action, prev_amount, new_amount, prev_status, new_status, prev_override, new_override, reason, changed_by_id) values ($1::uuid,$2::uuid,$3,'BATAL',$4::numeric,$4::numeric,'AKTIF','DIBATALKAN',$5,$5,$6,$7)`, crypto.randomUUID(), id, rev, String(row.amount), row.override, a, aktor?.id ?? null);
    return { id, status: "DIBATALKAN", revisi: rev, ditulis: true };
  }, { timeout: 20_000, maxWait: 5_000 });
}

/** Detail Ad level SUMBER META per hari (satu sumber per hari+akun+Ad menurut prioritas, sama dengan laporan campaign). READ ONLY. → { harian: Map(ymd→number), sumber: Map(ymd→string[]) } */
export async function muatAdHarianMetaDetail(db, { dari, sampai }) {
  const rows = await db.$queryRaw`
    WITH terpilih AS (
      SELECT DISTINCT ON (date_wib, account_id, ad_id) date_wib, spend, source FROM meta_ad_daily_spend
       WHERE date_wib >= ${new Date(`${dari}T00:00:00Z`)} AND date_wib <= ${new Date(`${sampai}T00:00:00Z`)}
       ORDER BY date_wib, account_id, ad_id, CASE source WHEN 'META_MARKETING_API' THEN 1 WHEN 'WINDSOR_API' THEN 2 ELSE 3 END)
    SELECT to_char(date_wib, 'YYYY-MM-DD') AS d, sum(spend)::text AS s, array_agg(DISTINCT source) AS src FROM terpilih GROUP BY date_wib`;
  return { harian: new Map(rows.map((r) => [r.d, Number(r.s)])), sumber: new Map(rows.map((r) => [r.d, r.src])) };
}
export async function muatAdHarianMeta(db, { dari, sampai }) { return (await muatAdHarianMetaDetail(db, { dari, sampai })).harian; }

// ── Biaya bulanan Pengaturan Sales (AdSpend) — penyimpanan LAMA, grain bulan kalender, ikut jurnal Finance. DIBACA saja (prioritas terendah), tidak ada duplikasi/penulisan. ─────
const PETA_ADSPEND = Object.freeze({ META_ADS: "META", TIKTOK_ADS: "TIKTOK", GOOGLE_ADS: "LAINNYA" });
const akhirBulan = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad2 = (n) => String(n).padStart(2, "0");

/** READ ONLY. Baris AdSpend (sumber iklan) untuk bulan yang bersinggungan dengan rentang. */
export async function muatAdSpendBulanan(db, { dari, sampai }) {
  const k1 = Number(dari.slice(0, 4)) * 12 + Number(dari.slice(5, 7)), k2 = Number(sampai.slice(0, 4)) * 12 + Number(sampai.slice(5, 7));
  const rows = await db.$queryRaw`SELECT source::text AS source, year, month, amount FROM "AdSpend" WHERE (year * 12 + month) BETWEEN ${k1} AND ${k2}`;
  return rows.filter((r) => PETA_ADSPEND[r.source]).map((r) => ({ source: r.source, sumberId: PETA_ADSPEND[r.source], tahun: Number(r.year), bulan: Number(r.month), amount: Number(r.amount) }));
}

/**
 * MURNI. Ubah baris AdSpend jadi entri 'semu' TOTAL_RENTANG (satu bulan penuh) agar memakai aturan cakupan yang SAMA (tidak diprorata; bulan yang terpotong rentang laporan → RENTANG_TIDAK_COCOK).
 * Tidak dipakai bila: nominal <= 0 (0 di Pengaturan = 'belum diisi', bukan Rp0 terkonfirmasi) atau sudah ada entri sumber aktif pada hari-hari bulan itu di rentang (entri sumber menang → tidak ada hitung ganda).
 */
export function entriBulananSemu(rows, { dari, sampai, entriNyata }) {
  const semu = [], diabaikan = [];
  for (const r of rows) {
    const awal = `${r.tahun}-${pad2(r.bulan)}-01`, akhir = `${r.tahun}-${pad2(r.bulan)}-${pad2(akhirBulan(r.tahun, r.bulan))}`;
    const info = { id: `adspend:${r.sumberId}:${r.tahun}-${pad2(r.bulan)}`, sumber: r.sumberId, tahun: r.tahun, bulan: r.bulan, nominal: r.amount, dari: awal, sampai: akhir };
    if (!(r.amount > 0)) { diabaikan.push({ ...info, alasan: "NOMINAL_NOL_DIANGGAP_BELUM_DIISI" }); continue; }
    const a = awal > dari ? awal : dari, b = akhir < sampai ? akhir : sampai;
    if (entriNyata.some((e) => e.sourceId === r.sumberId && e.status === "AKTIF" && e.dateFrom <= b && e.dateTo >= a)) { diabaikan.push({ ...info, alasan: "ADA_ENTRI_SUMBER_PADA_BULAN_INI" }); continue; }
    semu.push({ id: info.id, sourceId: r.sumberId, kind: "TOTAL_RENTANG", dateFrom: awal, dateTo: akhir, accountId: "", amount: r.amount, override: false, status: "AKTIF", asal: "PENGATURAN_BULANAN" });
  }
  return { semu, diabaikan };
}

/** Cakupan biaya semua sumber berbiaya pada rentang. READ ONLY. */
export async function muatBiayaSumber(db, { dari, sampai, hariIni }) {
  const entries = await daftarEntri(db, { dari, sampai, termasukBatal: false });
  const { harian: adHarian, sumber: adSumber } = await muatAdHarianMetaDetail(db, { dari, sampai });
  const bulanan = await muatAdSpendBulanan(db, { dari, sampai });
  const { semu, diabaikan } = entriBulananSemu(bulanan, { dari, sampai, entriNyata: entries });
  const out = new Map();
  for (const s of SUMBER_BERBIAYA) {
    const nyata = entries.filter((e) => e.sourceId === s);
    const cakupan = hitungCakupan({ dari, sampai, hariIni, entries: [...nyata, ...semu.filter((e) => e.sourceId === s)], adHarian: s === "META" ? adHarian : null, adSumber: s === "META" ? adSumber : null });
    const dipakai = new Set(cakupan.entriTerpakai);
    const pengaturan = [
      ...semu.filter((e) => e.sourceId === s).map((e) => ({ id: e.id, tahun: Number(e.dateFrom.slice(0, 4)), bulan: Number(e.dateFrom.slice(5, 7)), nominal: e.amount, dipakai: dipakai.has(e.id), alasan: dipakai.has(e.id) ? null : (cakupan.hariRentangTidakCocok.some((d) => d >= e.dateFrom && d <= e.dateTo) ? "BULAN_TIDAK_PENUH_DALAM_RENTANG" : "DETAIL_AD_MENANG") })),
      ...diabaikan.filter((e) => e.sumber === s).map((e) => ({ id: e.id, tahun: e.tahun, bulan: e.bulan, nominal: e.nominal, dipakai: false, alasan: e.alasan })),
    ].sort((a, b) => (a.tahun - b.tahun) || (a.bulan - b.bulan));
    out.set(s, { cakupan: { ...cakupan, entriTerpakai: cakupan.entriTerpakai.filter((id) => !String(id).startsWith("adspend:")), biayaBulananPengaturan: pengaturan }, entries: nyata });
  }
  return out;
}
