// Adapter BACA-SAJA Meta Marketing API lewat Composio (transport). Sumber data tetap META_MARKETING_API; Composio hanya jalur panggil yang diaudit.
// Hanya tool di TOOL_BACA yang bisa dipanggil: tool tulis (status, budget, targeting) ditolak sebelum ada permintaan jaringan.
// Pagination: `paging.next` satu-satunya tanda ada halaman berikut (cursors.after selalu ada, juga di halaman terakhir). Satu halaman gagal = seluruh tarikan gagal; tidak ada hasil parsial.
// Kunci API dan isi respons tidak pernah masuk pesan galat atau log: galat hanya membawa `kode`.
import { ACTION_PERCAKAPAN, ErrSinkron, barisDariInsights } from "./spendSyncMeta.js";
import { ZONA_WIB } from "./spend.js";

export const TRANSPORT = "COMPOSIO";
export const FLAG_SYNC_COMPOSIO = "COMPOSIO_META_SYNC_ENABLED";
export const TOOL_BACA = Object.freeze(["METAADS_GET_INSIGHTS", "METAADS_GET_OBJECT", "METAADS_GET_MULTIPLE_OBJECTS"]);
// Atribusi yang dipakai dan dicatat tiap run. `value` pada actions = angka yang dipakai SANSS sejak awal (ACTION_PERCAKAPAN); kolom 7d_click sengaja tidak dipakai.
// Tool METAADS_GET_INSIGHTS tidak punya parameter action_report_time, jadi berlaku bawaan Meta.
export const ATRIBUSI = Object.freeze({ actionType: ACTION_PERCAKAPAN, nilaiDipakai: "value", actionAttributionWindows: ["7d_click"], actionReportTime: "BAWAAN_META_TIDAK_DAPAT_DISET_LEWAT_TOOL" });
// Definisi hook rate terkunci. Angka hanya boleh dibandingkan dengan versi yang sama.
export const HOOK_RATE_DEFINISI = Object.freeze({ versi: "HOOK_V1_3S_PER_IMPRESSION_VIDEO", pembilang: "actions[video_view].value (pemutaran 3 detik)", penyebut: "impressions baris Ad video yang punya metrik pemutaran 3 detik", agregasi: "Σ pembilang ÷ Σ penyebut; bukan rata-rata persentase", bukanVideo: "dikeluarkan dari pembilang dan penyebut", sebanding: "hanya dengan versi yang sama; histori berpenyebut lain tidak dibandingkan" });
const BASE_API = "https://backend.composio.dev/api/v3.1";
const BASE = `${BASE_API}/tools/execute`;
const FIELDS_AD = ["account_id", "account_currency", "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name", "spend", "impressions", "reach", "inline_link_clicks", "actions", "video_thruplay_watched_actions", "date_start", "date_stop"];
const FIELDS_AKUN = ["account_id", "account_currency", "spend", "impressions", "inline_link_clicks", "actions", "date_start", "date_stop"];
export const BREAKDOWN = Object.freeze({ platform_posisi: ["publisher_platform", "platform_position"], demografi: ["age", "gender"] });
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const ID_RE = /^\d{5,32}$/;

export function konfigurasiComposio(env = process.env) {
  return {
    aktif: env[FLAG_SYNC_COMPOSIO] === "true", apiKey: env.COMPOSIO_API_KEY || "", connectedAccountId: env.COMPOSIO_META_CONNECTED_ACCOUNT_ID || "",
    userId: env.COMPOSIO_META_USER_ID || "", versiTool: env.COMPOSIO_META_TOOL_VERSION || "", akun: String(env.META_ADS_ACCOUNT_ID || "").replace(/^act_/i, "").trim(),
  };
}
/** Daftar nama konfigurasi yang belum ada/tidak valid. Tidak pernah mengembalikan nilai. */
export function konfigurasiKurang(c) {
  const k = [];
  if (!c.apiKey) k.push("COMPOSIO_API_KEY");
  if (!c.connectedAccountId) k.push("COMPOSIO_META_CONNECTED_ACCOUNT_ID");
  if (!c.userId) k.push("COMPOSIO_META_USER_ID");   // eksekusi tool dengan connected account wajib menyertakan user_id; tanpa ini REST membalas 400 kode 1811
  if (!c.versiTool || c.versiTool === "latest") k.push("COMPOSIO_META_TOOL_VERSION (wajib versi tetap, bukan latest)");
  if (!ID_RE.test(c.akun)) k.push("META_ADS_ACCOUNT_ID");
  return k;
}
/** Kode galat konfigurasi. user_id punya kode sendiri karena kekosongannya baru terlihat saat eksekusi tool. */
export const KODE_USER_ID_KOSONG = "COMPOSIO_META_USER_ID_KOSONG";
export const kodeKonfigurasi = (kurang) => (kurang.includes("COMPOSIO_META_USER_ID") ? KODE_USER_ID_KOSONG : "KONFIGURASI_TIDAK_LENGKAP");
// Galat Meta terbungkus teks oleh Composio: hanya kodenya yang diambil, teksnya dibuang.
// Kode numerik Meta menang atas teks: "OAuthException" hanyalah tipe yang juga dipakai rate limit (4/17) dan galat izin (10/200-299).
// Composio bisa membungkus kode sendiri di sekitar kode Meta, jadi semua kode dinilai; error_subcode diabaikan.
const KODE_TOKEN = new Set([102, 190]);
const KODE_RATE = new Set([4, 17, 32, 341, 613, 80000, 80003, 80004]);
const KODE_SEMENTARA = new Set([1, 2]);
const kodeIzin = (k) => k === 10 || (k >= 200 && k <= 299);
export function kelasGalat(teks) {
  const t = String(teks ?? "");
  const kode = [...t.matchAll(/(?<![a-z_])"?code"?\s*[:=]\s*"?(\d+)\b/gi)].map((m) => Number(m[1]));
  if (kode.some((k) => KODE_TOKEN.has(k))) return { kode: "TOKEN_KEDALUWARSA", ulang: false };
  if (kode.some(kodeIzin)) return { kode: "IZIN_META_DITOLAK", ulang: false };
  if (kode.some((k) => KODE_RATE.has(k))) return { kode: "RATE_LIMIT", ulang: true };
  if (kode.some((k) => KODE_SEMENTARA.has(k)) || /"?is_transient"?\s*[:=]\s*"?true\b/i.test(t)) return { kode: "GANGGUAN_SEMENTARA", ulang: true };
  if (kode.length) return { kode: "TOOL_GAGAL", ulang: false };
  // Tanpa kode numerik baru teks dipakai.
  if (/rate.?limit|too many/i.test(t)) return { kode: "RATE_LIMIT", ulang: true };
  if (/temporar|timeout|unavailable/i.test(t)) return { kode: "GANGGUAN_SEMENTARA", ulang: true };
  if (/expired/i.test(t)) return { kode: "TOKEN_KEDALUWARSA", ulang: false };
  if (/OAuthException/i.test(t)) return { kode: "OAUTH_GAGAL", ulang: false };
  return { kode: "TOOL_GAGAL", ulang: false };
}

export function buatKlien({ env = process.env, fetchFn = fetch, tidurFn = tidur, maksPercobaan = 4, tungguMs = 1500, timeoutMs = 60_000, maksHalaman = 200 } = {}) {
  const c = konfigurasiComposio(env);
  async function panggil(tool, args) {
    if (!TOOL_BACA.includes(tool)) throw new ErrSinkron("TOOL_TIDAK_DIIZINKAN");
    if (!c.userId) throw new ErrSinkron(KODE_USER_ID_KOSONG);
    let terakhir = "GAGAL";
    for (let i = 1; i <= maksPercobaan; i++) {
      try {
        const r = await fetchFn(`${BASE}/${tool}`, {
          method: "POST", headers: { "x-api-key": c.apiKey, "Content-Type": "application/json" }, signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({ connected_account_id: c.connectedAccountId, user_id: c.userId, version: c.versiTool, arguments: args }),
        });
        if (r.status === 401 || r.status === 403) throw new ErrSinkron("AKSES_COMPOSIO_DITOLAK");
        if (r.status === 429 || r.status >= 500) { terakhir = `HTTP_${r.status}`; }
        else if (!r.ok) throw new ErrSinkron(`HTTP_${r.status}`);
        else {
          let j; try { j = await r.json(); } catch { throw new ErrSinkron("RESPONS_TIDAK_VALID"); }
          if (j?.successful === true && j.data && typeof j.data === "object") return j.data;
          if (j?.successful !== false) throw new ErrSinkron("RESPONS_TIDAK_VALID");
          const g = kelasGalat(typeof j.error === "string" ? j.error : JSON.stringify(j.error ?? ""));
          if (!g.ulang) throw new ErrSinkron(g.kode);
          terakhir = g.kode;
        }
      } catch (e) {
        if (e instanceof ErrSinkron) throw e;
        terakhir = e?.name === "TimeoutError" ? "TIMEOUT" : "JARINGAN";
      }
      if (i < maksPercobaan) await tidurFn(tungguMs * 2 ** (i - 1));
    }
    throw new ErrSinkron(terakhir);
  }
  /** Semua halaman satu kueri insights. Cursor berulang, halaman melebihi batas, atau bentuk tak valid = galat. */
  async function semuaHalaman(args) {
    const baris = []; const dilihat = new Set(); let after;
    for (let h = 0; ; h++) {
      if (h >= maksHalaman) throw new ErrSinkron("HALAMAN_TERPOTONG");
      const d = await panggil("METAADS_GET_INSIGHTS", { ...args, limit: 200, ...(after ? { after } : {}) });
      if (!Array.isArray(d.data)) throw new ErrSinkron("RESPONS_TIDAK_VALID");
      baris.push(...d.data);
      if (!d.paging?.next) return baris;
      after = d.paging?.cursors?.after;
      if (!after) throw new ErrSinkron("HALAMAN_TERPOTONG");
      if (dilihat.has(after)) throw new ErrSinkron("CURSOR_BERULANG");
      dilihat.add(after);
    }
  }
  const objekAkun = `act_${c.akun}`;
  const kueri = (dari, sampai, level, fields, extra = {}) => ({ object_id: objekAkun, level, time_range: { since: dari, until: sampai }, time_increment: 1, fields, action_attribution_windows: ATRIBUSI.actionAttributionWindows, ...extra });
  const periksaBaris = (rows, dari, sampai) => {
    for (const x of rows) {
      if (x.account_id !== undefined && String(x.account_id) !== c.akun) throw new ErrSinkron("AKUN_SALAH");
      if (x.account_currency !== undefined && x.account_currency !== "IDR") throw new ErrSinkron("MATA_UANG_SALAH");
      if (x.date_start !== x.date_stop || !(x.date_start >= dari && x.date_start <= sampai)) throw new ErrSinkron("TANGGAL_DI_LUAR_RENTANG");
    }
    return rows;
  };
  return {
    akun: c.akun, versiTool: c.versiTool, panggil,
    /** Bukti konfigurasi tanpa nilai secret: connected account ada di project API key ini dan versi tool benar-benar tersedia. */
    async periksaProject() {
      const ambil = async (p) => { const r = await fetchFn(`${BASE_API}${p}`, { method: "GET", headers: { "x-api-key": c.apiKey }, signal: AbortSignal.timeout(timeoutMs) }); if (r.status === 401 || r.status === 403) throw new ErrSinkron("AKSES_COMPOSIO_DITOLAK"); if (!r.ok) throw new ErrSinkron(`HTTP_${r.status}`); return r.json(); };
      const ca = await ambil(`/connected_accounts?connected_account_ids=${encodeURIComponent(c.connectedAccountId)}&toolkit_slugs=metaads&account_type=ALL`);
      const item = (ca.items || []).find((x) => x.id === c.connectedAccountId);
      if (!item) throw new ErrSinkron("CONNECTED_ACCOUNT_TIDAK_ADA_DI_PROJECT");
      if (item.status !== "ACTIVE") throw new ErrSinkron("CONNECTED_ACCOUNT_TIDAK_AKTIF");
      if (item.user_id !== c.userId) throw new ErrSinkron("USER_ID_TIDAK_COCOK");
      const versi = {};
      for (const t of TOOL_BACA) { const d = await ambil(`/tools/${t}`); if (!(d.available_versions || []).includes(c.versiTool)) throw new ErrSinkron("VERSI_TOOL_TIDAK_TERSEDIA"); versi[t] = c.versiTool; }
      return { connectedAccountAktif: true, toolkit: "metaads", versiTool: versi };
    },
    async verifikasiAkun() {
      const a = await panggil("METAADS_GET_OBJECT", { object_id: objekAkun, fields: ["account_id", "currency", "timezone_name", "account_status"] });
      if (String(a.account_id) !== c.akun) throw new ErrSinkron("AKUN_SALAH");
      if (a.currency !== "IDR") throw new ErrSinkron("MATA_UANG_SALAH");
      if (!ZONA_WIB.includes(a.timezone_name)) throw new ErrSinkron("ZONA_WAKTU_SALAH");
      return { akun: c.akun, mataUang: a.currency, zonaWaktu: a.timezone_name, statusAkun: a.account_status ?? null };
    },
    insightsAd: async (dari, sampai) => periksaBaris(await semuaHalaman(kueri(dari, sampai, "ad", FIELDS_AD)), dari, sampai),
    kontrolAkun: async (dari, sampai) => periksaBaris(await semuaHalaman(kueri(dari, sampai, "account", FIELDS_AKUN)), dari, sampai),
    breakdown: async (dari, sampai, dim) => periksaBaris(await semuaHalaman(kueri(dari, sampai, "account", ["spend", "impressions", "inline_link_clicks", "reach", "date_start", "date_stop"], { breakdowns: BREAKDOWN[dim] })), dari, sampai),
    /** Hierarki resmi Ad, termasuk Ad tanpa spend di rentang mana pun. Hasil baris importer referensi; Ad tak terbaca dikembalikan terpisah, tidak ditebak. */
    async hierarkiAd(adIds) {
      const rows = []; const galat = [];
      for (let i = 0; i < adIds.length; i += 50) {
        const ids = adIds.slice(i, i + 50);
        const d = await panggil("METAADS_GET_MULTIPLE_OBJECTS", { object_ids: ids, fields: ["id", "account_id", "name", "adset_id", "campaign_id", "adset{name}", "campaign{name}"] });
        const peta = d.results ?? d.data ?? d;
        for (const id of ids) {
          const o = peta[id];
          if (!o || o.error || String(o.id) !== id || !o.adset_id || !o.campaign_id) { galat.push(id); continue; }
          if (o.account_id !== undefined && String(o.account_id) !== c.akun) throw new ErrSinkron("AKUN_SALAH");
          rows.push({ adId: id, adSetId: String(o.adset_id), campaignId: String(o.campaign_id), adName: o.name ?? null, adSetName: o.adset?.name ?? null, campaignName: o.campaign?.name ?? null });
        }
      }
      return { rows, galat };
    },
    /** Creative per Ad, maksimum 50 per panggilan. Hasil { adId: objek }; objek gagal dikembalikan terpisah. */
    async objekAd(adIds) {
      const hasil = {}; const galat = [];
      for (let i = 0; i < adIds.length; i += 50) {
        const ids = adIds.slice(i, i + 50);
        const d = await panggil("METAADS_GET_MULTIPLE_OBJECTS", { object_ids: ids, fields: ["id", "account_id", "creative{id,name,object_story_id,effective_object_story_id,video_id}"] });
        const peta = d.results ?? d.data ?? d;   // bentuk nyata tool: { results: { id: objek } }
        for (const id of ids) {
          const o = peta[id];
          if (o && !o.error && String(o.id) === id) {
            if (o.account_id !== undefined && String(o.account_id) !== c.akun) throw new ErrSinkron("AKUN_SALAH");
            hasil[id] = o;
          } else galat.push(id);
        }
      }
      return { hasil, galat };
    },
  };
}

// ── transformasi MURNI ──
const sen = (v) => { if (v === undefined || v === null || !/^\d{1,13}(\.\d{1,2})?$/.test(String(v))) return null; const [a, b = ""] = String(v).split("."); return BigInt(a) * 100n + BigInt((b + "00").slice(0, 2)); };
export const senKeRp = (s) => (s === null ? null : `${s / 100n}.${String(s % 100n).padStart(2, "0")}`);
export const rpKeSen = sen;
const intN = (v) => (v === undefined || v === null || !/^\d{1,15}$/.test(String(v)) ? null : BigInt(v));
const nilaiAksi = (lst, tipe) => { const a = (lst || []).find((x) => x.action_type === tipe); return a ? intN(a.value) : null; };

/** Baris insights → baris importer SANSS (definisi percakapan yang sama dengan adapter lama). */
export const barisImporter = (data) => barisDariInsights(data);
/** Metrik video per Ad-hari. Tidak ada aksi = null (bukan nol). video_view = pemutaran 3 detik. */
export const barisDelivery = (data) => data.map((x) => ({ tanggal: x.date_start, adId: String(x.ad_id), video3s: nilaiAksi(x.actions, "video_view"), thruplay: nilaiAksi(x.video_thruplay_watched_actions, "video_view"), impressions: intN(x.impressions) }));

/**
 * Hook rate (HOOK_RATE_DEFINISI). jenis: VIDEO | BUKAN_VIDEO | TIDAK_DIKETAHUI (dari creative). Metrik 3 detik pada creative tak dikenal = bukti video; pada creative tanpa video_id = dikeluarkan.
 * Metrik null TIDAK dianggap nol: baris video tanpa metrik keluar dari penyebut dan menurunkan coverage.
 */
export function hookRate(baris) {
  let p = 0n, q = 0n, tanpaMetrik = 0n, bukan = 0n, takTahu = 0n;
  for (const b of baris) {
    const imp = b.impressions === null || b.impressions === undefined ? 0n : BigInt(b.impressions);
    const ada = b.video3s !== null && b.video3s !== undefined;
    if (b.jenis === "BUKAN_VIDEO") bukan += imp;
    else if (ada && b.impressions !== null && b.impressions !== undefined) { p += BigInt(b.video3s); q += imp; }
    else if (b.jenis === "VIDEO") tanpaMetrik += imp;
    else takTahu += imp;
  }
  const dasarCoverage = q + tanpaMetrik + takTahu;
  const coverage = { impressionsTerhitung: Number(q), impressionsVideoTanpaMetrik: Number(tanpaMetrik), impressionsBukanVideo: Number(bukan), impressionsTidakDiketahui: Number(takTahu), persen: dasarCoverage === 0n ? null : Number((q * 10000n) / dasarCoverage) / 100 };
  if (q === 0n) return { versi: HOOK_RATE_DEFINISI.versi, nilai: null, alasan: "TANPA_IMPRESSIONS_VIDEO", pembilang: Number(p), penyebut: 0, coverage };
  return { versi: HOOK_RATE_DEFINISI.versi, nilai: Number((p * 10000n) / q) / 100, alasan: null, pembilang: Number(p), penyebut: Number(q), coverage };
}

/**
 * Status per hari. Spend dibandingkan dalam sen (BigInt): selisih 1 sen pun = belum rekonsiliasi.
 * DELIVERY_TERVERIFIKASI | NOL_TERVERIFIKASI (baris kontrol eksplisit spend 0) | PERLU_KONFIRMASI (tidak ada baris; bukan angka nol, dikonfirmasi pemanggil menjadi TIDAK_ADA_DELIVERY_TERAMATI) | BELUM_REKONSILIASI.
 */
export function rekonsiliasiHarian(hariList, barisAd, barisKontrol) {
  const perAd = new Map(); const kontrol = new Map(barisKontrol.map((k) => [k.date_start, k]));
  if (kontrol.size !== barisKontrol.length) throw new ErrSinkron("KONTROL_GANDA");
  for (const x of barisAd) {
    const m = perAd.get(x.date_start) || { spend: 0n, imp: 0n, klik: 0n, kon: 0n, n: 0, tidakValid: false };
    const s = sen(x.spend); if (s === null) m.tidakValid = true; else m.spend += s;
    m.imp += intN(x.impressions) ?? 0n; m.klik += intN(x.inline_link_clicks) ?? 0n; m.kon += nilaiAksi(x.actions, ACTION_PERCAKAPAN) ?? 0n; m.n++;
    perAd.set(x.date_start, m);
  }
  return hariList.map((tanggal) => {
    const a = perAd.get(tanggal); const k = kontrol.get(tanggal);
    const dasar = { tanggal, barisAd: a?.n ?? 0, adSpend: a ? senKeRp(a.spend) : null, kontrolSpend: null, kontrolImpressions: null, kontrolKlik: null, kontrolKonversasi: null, selisihSpend: null, selisihKonversasi: null };
    if (!a && !k) return { ...dasar, status: "PERLU_KONFIRMASI", rekonsiliasi: false };
    const ks = k ? sen(k.spend) : null;
    const out = { ...dasar, kontrolSpend: ks === null ? null : senKeRp(ks), kontrolImpressions: k ? intN(k.impressions) : null, kontrolKlik: k ? intN(k.inline_link_clicks) : null, kontrolKonversasi: k ? nilaiAksi(k.actions, ACTION_PERCAKAPAN) : null };
    if (ks === null || !a || a.tidakValid) {
      if (ks === 0n && !a) return { ...out, status: "NOL_TERVERIFIKASI", rekonsiliasi: true };
      return { ...out, status: "BELUM_REKONSILIASI", rekonsiliasi: false };
    }
    const sel = a.spend - ks;
    out.selisihSpend = senKeRp(sel < 0n ? -sel : sel);
    out.selisihKonversasi = out.kontrolKonversasi === null ? null : Number(a.kon - out.kontrolKonversasi);   // informasi: aksi platform tidak menjadi gerbang
    const cocok = sel === 0n && a.imp === (out.kontrolImpressions ?? 0n) && a.klik === (out.kontrolKlik ?? 0n);
    return { ...out, status: !cocok ? "BELUM_REKONSILIASI" : ks === 0n ? "NOL_TERVERIFIKASI" : "DELIVERY_TERVERIFIKASI", rekonsiliasi: cocok };
  });
}
