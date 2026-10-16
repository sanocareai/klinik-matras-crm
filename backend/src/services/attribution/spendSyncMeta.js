// ATRIBUSI META ADS FASE 3 — adapter sinkronisasi spend dari Meta Marketing API. HANYA BACA (GET). TIDAK PERNAH menulis ke Meta Ads (tanpa POST/DELETE, tanpa ubah campaign/budget).
//
// Aktif HANYA bila SEMUA terpenuhi (periksaKesiapan):
//   • SPEND_SYNC_ENABLED=true (bawaan MATI),
//   • META_ADS_ACCESS_TOKEN dan META_ADS_ACCOUNT_ID ada (token system user / long-lived; nilai tidak pernah dicetak atau disimpan),
//   • izin `ads_read` TERBUKTI granted lewat GET /me/permissions (token website/dataset/CAPI TIDAK dianggap bukti),
//   • akun beriklan IDR dan berzona waktu WIB (Asia/Jakarta | Asia/Pontianak) — spend harian tidak dapat dikonversi antar-zona.
// Penarikan: level=ad, time_increment=1, rolling 7 hari (koreksi atribusi platform), paginasi, retry terbatas (429/5xx/jaringan). Data kosong TIDAK menghapus histori.
// Data masuk lewat jalankanImporSpend yang sama dengan CSV (kontrak tabel sama): idempoten, revisi audit-able, kunci advisory per akun.
import { jalankanImporSpend, ZONA_WIB } from "./spend.js";

export const FLAG_SYNC = "SPEND_SYNC_ENABLED";
export const ACTION_PERCAKAPAN = "onsite_conversion.messaging_conversation_started_7d";
const GRAPH = "https://graph.facebook.com";
const FIELDS = "account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,inline_link_clicks,actions,account_currency,date_start,date_stop";

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
export class ErrSinkron extends Error { constructor(kode, pesan) { super(pesan || kode); this.kode = kode; } }

function konfigurasi(env) {
  return {
    aktif: env[FLAG_SYNC] === "true",
    token: env.META_ADS_ACCESS_TOKEN || "",
    akun: String(env.META_ADS_ACCOUNT_ID || "").replace(/^act_/i, "").trim(),
    versi: /^v\d+\.\d+$/.test(env.META_GRAPH_VERSION || "") ? env.META_GRAPH_VERSION : "v21.0",
  };
}

/** GET dengan retry terbatas. Token dikirim lewat header Authorization (bukan query) agar tidak masuk URL/log. */
export async function ambilGet(url, token, { fetchFn = fetch, maksPercobaan = 3, tungguMs = 800, tidurFn = tidur } = {}) {
  let terakhir = null;
  for (let i = 1; i <= maksPercobaan; i++) {
    try {
      const r = await fetchFn(url, { method: "GET", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      if (r.ok) return await r.json();
      terakhir = `HTTP_${r.status}`;
      if (!(r.status === 429 || r.status >= 500)) throw new ErrSinkron(terakhir, `Meta API ${r.status}`);
    } catch (e) {
      if (e instanceof ErrSinkron) throw e;
      terakhir = e?.name === "TimeoutError" ? "TIMEOUT" : "JARINGAN";
    }
    if (i < maksPercobaan) await tidurFn(tungguMs * i);
  }
  throw new ErrSinkron(terakhir || "GAGAL", `Meta API gagal setelah ${maksPercobaan} percobaan (${terakhir})`);
}

/** Bukti kesiapan. Tidak pernah mengembalikan token. */
export async function periksaKesiapan({ env = process.env, fetchFn = fetch, tidurFn } = {}) {
  const c = konfigurasi(env);
  const alasan = [];
  if (!c.aktif) alasan.push(`${FLAG_SYNC} tidak 'true'`);
  if (!c.token) alasan.push("META_ADS_ACCESS_TOKEN tidak ada");
  if (!/^\d{5,32}$/.test(c.akun)) alasan.push("META_ADS_ACCOUNT_ID tidak valid/ada");
  const hasil = { siap: false, alasan, izinAdsRead: null, zonaWaktu: null, mataUang: null, akun: /^\d{5,32}$/.test(c.akun) ? c.akun : null };
  if (alasan.length) return hasil;
  try {
    const izin = await ambilGet(`${GRAPH}/${c.versi}/me/permissions`, c.token, { fetchFn, tidurFn });
    const g = (izin.data || []).find((x) => x.permission === "ads_read");
    hasil.izinAdsRead = !!g && g.status === "granted";
    if (!hasil.izinAdsRead) alasan.push("izin ads_read TIDAK terbukti granted (token ini bukan token Marketing API read-only)");
    const a = await ambilGet(`${GRAPH}/${c.versi}/act_${c.akun}?fields=timezone_name,currency,account_status`, c.token, { fetchFn, tidurFn });
    hasil.zonaWaktu = a.timezone_name ?? null; hasil.mataUang = a.currency ?? null;
    if (!ZONA_WIB.includes(a.timezone_name)) alasan.push(`zona waktu akun '${String(a.timezone_name).slice(0, 40)}' bukan WIB`);
    if (a.currency !== "IDR") alasan.push(`mata uang akun '${String(a.currency).slice(0, 8)}' bukan IDR`);
  } catch (e) {
    alasan.push(`verifikasi API gagal (${e.kode || "ERROR"})`);
  }
  hasil.siap = alasan.length === 0;
  return hasil;
}

/** Baris insights Meta → baris mentah untuk validasi spend (nama kolom internal). */
export function barisDariInsights(data) {
  return (data || []).map((x, i) => {
    const konv = (x.actions || []).find((a) => a.action_type === ACTION_PERCAKAPAN);
    return {
      baris: i + 1, tanggal: x.date_start, accountId: x.account_id, campaignId: x.campaign_id, adSetId: x.adset_id, adId: x.ad_id,
      campaignName: x.campaign_name, adSetName: x.adset_name, adName: x.ad_name, currency: x.account_currency, spend: x.spend,
      impressions: x.impressions, reach: x.reach, linkClicks: x.inline_link_clicks,
      platformConversations: konv ? String(konv.value) : "", platformResultType: konv ? ACTION_PERCAKAPAN : null,
    };
  });
}

/** Tarik semua halaman insights level=ad untuk [dari, sampai] (YYYY-MM-DD, tanggal akun = WIB). */
export async function tarikInsights({ akun, token, versi = "v21.0", dari, sampai, fetchFn = fetch, tidurFn, maksHalaman = 200 }) {
  const rentang = encodeURIComponent(JSON.stringify({ since: dari, until: sampai }));
  let url = `${GRAPH}/${versi}/act_${akun}/insights?level=ad&time_increment=1&fields=${FIELDS}&time_range=${rentang}&limit=500`;
  const semua = [];
  for (let h = 0; url && h < maksHalaman; h++) {
    const j = await ambilGet(url, token, { fetchFn, tidurFn });
    semua.push(...(j.data || []));
    url = j.paging?.next || null;
  }
  return semua;
}

const hariWib = (d) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);

/**
 * Satu siklus sinkronisasi (rolling `hari` hari sampai hari ini WIB). Mengembalikan ringkasan; TIDAK melempar untuk kondisi normal (tidak siap / data kosong).
 * Tidak berjalan paralel: kunci advisory transaksi per akun di jalankanImporSpend (yang kedua ditolak SEDANG_DIIMPOR).
 */
export async function sinkronkanSpendMeta(db, { env = process.env, fetchFn = fetch, tidurFn, hari = 7, now = new Date(), dryRun = false } = {}) {
  const kes = await periksaKesiapan({ env, fetchFn, tidurFn });
  if (!kes.siap) return { status: "TIDAK_SIAP", kesiapan: kes };
  const c = konfigurasi(env);
  try {
    const sampai = hariWib(now);
    const dari = hariWib(new Date(now.getTime() - (Math.min(Math.max(hari, 1), 31) - 1) * 86_400_000));
    const data = await tarikInsights({ akun: c.akun, token: c.token, versi: c.versi, dari, sampai, fetchFn, tidurFn });
    if (data.length === 0) return { status: "KOSONG", rentang: { dari, sampai }, catatan: "API tidak mengembalikan baris; tidak ada yang diubah atau dihapus" };
    const rows = barisDariInsights(data);
    const hasil = await jalankanImporSpend(db, { rows, source: "META_MARKETING_API", accountId: c.akun, zonaWaktuAkun: kes.zonaWaktu, dryRun, namaBerkas: `meta-insights-${dari}-${sampai}`, sekarang: now });
    return { status: dryRun ? "DRY_RUN" : "SELESAI", rentang: { dari, sampai }, ringkasan: hasil.ringkasan, rekonsiliasi: hasil.rekonsiliasi, importId: hasil.importId ?? null };
  } catch (e) {
    // dua sinkronisasi untuk akun yang sama tidak berjalan paralel: kunci advisory transaksi di jalankanImporSpend menolak yang kedua
    if (e?.code === "SEDANG_DIIMPOR") return { status: "SEDANG_BERJALAN", kesiapan: kes };
    throw e;
  }
}
