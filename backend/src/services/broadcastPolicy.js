// Aturan main pengiriman broadcast — SENGAJA dipisah dari routes/broadcast.js
// supaya bisa diuji tanpa database, tanpa WAHA, dan tanpa menunggu jam nyata.
// Semua fungsi di sini murni: input -> output, tidak menyentuh I/O apa pun.
//
// KONTEKS RISIKO (ini yang membentuk semua angka di bawah). Nomor WA yang
// dipakai broadcast adalah SATU-SATUNYA pintu masuk ribuan lead iklan Meta
// (lihat leadAttribution.js). Kalau nomornya kena banned karena dianggap
// spam, yang hilang bukan cuma campaign-nya — tapi seluruh aliran lead dan
// belanja iklan yang sudah jalan. Jadi default di file ini sengaja
// konservatif: lebih baik campaign selesai beberapa hari lebih lama
// daripada nomornya mati.

/** Zona waktu operasional bisnis (WIB = UTC+7). */
const OFFSET_WIB_JAM = 7;

// Jam kirim. Di luar rentang ini worker DIAM — bukan cuma soal sopan santun
// (tidak ada yang mau promo jam 3 pagi), tapi juga karena pola kirim yang
// "manusiawi" jauh lebih kecil kemungkinannya ditandai spam dibanding
// pengiriman merata 24 jam yang jelas-jelas mesin.
export const JAM_MULAI_WIB = 8;
export const JAM_SELESAI_WIB = 20;

// Jeda minimum antar pesan, berapa pun kuotanya. Pengaman terakhir supaya
// kuota besar + sisa waktu sempit tidak berubah jadi ledakan pesan beruntun.
export const JEDA_MINIMUM_MS = 20_000;

/** Komponen jam/menit tanggal tertentu dalam WIB. */
export function komponenWIB(sekarang = new Date()) {
  const wib = new Date(sekarang.getTime() + OFFSET_WIB_JAM * 3_600_000);
  return {
    jam: wib.getUTCHours(),
    menit: wib.getUTCMinutes(),
    tanggal: `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, "0")}-${String(wib.getUTCDate()).padStart(2, "0")}`,
  };
}

/** Awal hari ini menurut WIB, dikembalikan sebagai Date UTC untuk query DB. */
export function awalHariWIB(sekarang = new Date()) {
  const wib = new Date(sekarang.getTime() + OFFSET_WIB_JAM * 3_600_000);
  wib.setUTCHours(0, 0, 0, 0);
  return new Date(wib.getTime() - OFFSET_WIB_JAM * 3_600_000);
}

/** Apakah saat ini masih di dalam jam kirim yang diizinkan? */
export function dalamJamKirim(sekarang = new Date()) {
  const { jam } = komponenWIB(sekarang);
  return jam >= JAM_MULAI_WIB && jam < JAM_SELESAI_WIB;
}

/** Sisa milidetik sampai jam kirim hari ini habis. 0 kalau sudah lewat. */
export function sisaWaktuKirimMs(sekarang = new Date()) {
  const { jam, menit } = komponenWIB(sekarang);
  if (jam >= JAM_SELESAI_WIB) return 0;
  const jamEfektif = Math.max(jam, JAM_MULAI_WIB);
  const menitEfektif = jam < JAM_MULAI_WIB ? 0 : menit;
  return ((JAM_SELESAI_WIB - jamEfektif) * 60 - menitEfektif) * 60_000;
}

/**
 * Jeda ideal antar pesan supaya sisa kuota HABIS PAS di ujung jam kirim,
 * bukan diborong di awal lalu diam berjam-jam.
 *
 * Contoh: kuota sisa 100, waktu kirim sisa 10 jam -> 1 pesan tiap 6 menit.
 * Pola menyebar seperti ini jauh lebih menyerupai percakapan manusia
 * dibanding 100 pesan beruntun dalam 20 menit lalu senyap.
 */
export function jedaAntarPesanMs(kuotaSisa, sisaWaktuMs) {
  if (kuotaSisa <= 0) return Infinity;
  if (sisaWaktuMs <= 0) return Infinity;
  return Math.max(JEDA_MINIMUM_MS, Math.floor(sisaWaktuMs / kuotaSisa));
}

/**
 * Acak jeda ±30% supaya spasi antar pesan tidak konstan sempurna.
 * Interval yang persis sama tiap kali adalah sidik jari paling gampang
 * dikenali sebagai bot.
 */
export function acakJeda(jedaMs, acak = Math.random) {
  if (!Number.isFinite(jedaMs)) return jedaMs;
  const faktor = 0.7 + acak() * 0.6; // 0,7x - 1,3x
  return Math.max(JEDA_MINIMUM_MS, Math.floor(jedaMs * faktor));
}

// ─── Opt-out ───────────────────────────────────────────────────────────────
//
// Tag yang dipasang ke Customer.tags kalau dia minta berhenti. Dipakai DUA
// arah: dikecualikan saat menyusun target, DAN dicek lagi tepat sebelum
// kirim (orang bisa minta berhenti setelah targetnya terlanjur dibuat).
export const TAG_OPT_OUT = "Stop Broadcast";

// Tag UNIVERSAL yang dipasang ke SETIAP penerima broadcast, apa pun
// kampanyenya — terpisah dari BroadcastCampaign.tagOnSend yang bebas
// diketik admin per kampanye.
//
// Kenapa perlu dua-duanya: tag per-kampanye ("Reactivation Merdeka") dipakai
// mengukur hasil kampanye TERTENTU, sedangkan tag universal ini yang dipakai
// chip "Broadcast" di Inbox. Kalau Inbox bergantung pada tag bebas-ketik,
// filternya rusak begitu admin mengganti nama tag atau lupa mengisinya.
export const TAG_BROADCAST = "Broadcast";

const KATA_OPT_OUT = [
  "stop", "berhenti", "unsubscribe", "unsub",
  "jangan kirim", "jangan dikirim", "hapus nomor", "hapus nomer",
  "jgn kirim", "no spam", "gausah kirim", "ga usah kirim",
];

/**
 * Apakah pesan ini permintaan berhenti dikirimi broadcast?
 *
 * SENGAJA CONDONG KE "IYA". Salah menandai orang sebagai opt-out cuma
 * berakibat dia tidak dapat promo (murah). Sebaliknya, GAGAL menangkap
 * permintaan berhenti berujung customer kesal, blokir, dan laporan spam —
 * dan laporan spam itulah yang mematikan nomor.
 *
 * Tapi tetap dibatasi ke pesan PENDEK: "stop" di dalam kalimat panjang
 * seperti "tolong stop produksinya dulu ya pak, saya mau ubah ukuran"
 * jelas bukan permintaan berhenti broadcast.
 */
export function apakahMintaBerhenti(teks) {
  const bersih = String(teks || "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!bersih) return false;
  if (bersih.length > 40) return false;
  return KATA_OPT_OUT.some((kata) => bersih === kata || bersih.startsWith(kata + " ") || bersih.endsWith(" " + kata) || bersih.includes(" " + kata + " "));
}

// Dipakai kalau Customer.name kosong. Di data produksi banyak customer
// tanpa nama (kontak baru yang belum sempat dirapikan sales) — tanpa
// cadangan ini "Halo {{nama}}," berubah jadi "Halo ," yang langsung
// terbaca sebagai blast mesin.
export const SAPAAN_CADANGAN = "Kak";

/** Ganti placeholder {{nama}} dengan nama pelanggan. */
export function susunPesan(template, nama) {
  const sapaan = String(nama || "").trim() || SAPAAN_CADANGAN;
  return String(template || "").replace(/\{\{\s*nama\s*\}\}/gi, sapaan);
}
