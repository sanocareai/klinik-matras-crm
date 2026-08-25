// ─── ARSITEKTUR WAKTU: UTC-FIRST, WIB HANYA DI TEPI ─────────────────────────
//
// ATURAN:
//   1. DATABASE selalu menyimpan UTC. Prisma `DateTime` → Postgres
//      `timestamp(3)` dan `new Date()` / `@default(now())` di Node SELALU
//      menghasilkan instant UTC. JANGAN pernah simpan wall-clock lokal.
//   2. API selalu mengirim/menerima instant UTC (ISO 8601, akhiran "Z").
//   3. WIB dipakai HANYA di 2 tepi:
//        a) TEPI MASUK  — query param tanggal kalender (?from=YYYY-MM-DD)
//           dari UI adalah tanggal WIB, jadi harus diterjemahkan ke batas
//           instant UTC-nya di sini (file ini).
//        b) TEPI KELUAR — render ke manusia (frontend formatDate.js, atau
//           pesan WA/email dari backend → pakai formatWIB() di bawah).
//
// KENAPA FILE INI ADA: container backend jalan di UTC (docker-compose tidak
// men-set TZ). Jadi `new Date(2026, 6, 1)` menghasilkan 1 Juli 00:00 **UTC**
// = 1 Juli 07:00 WIB — bukan awal hari yang dimaksud user. Semua batas
// periode laporan WAJIB lewat helper di file ini, JANGAN pakai
// `new Date(y, m, d)` / `setHours(0,0,0,0)` untuk logika laporan.
//
// OFFSET TETAP +07:00: Indonesia Barat tidak pernah pakai DST dan offsetnya
// tidak berubah sejak 1964, jadi offset tetap aman & bebas dependency.
// (Kalau suatu hari perlu zona lain, ganti ke Intl.DateTimeFormat.)

export const WIB_TZ = "Asia/Jakarta";
export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Awal hari WIB (00:00:00.000 WIB) sebagai instant UTC.
// "2026-07-25" → 2026-07-24T17:00:00.000Z
export function startOfDayWIB(dateStr) {
  return new Date(Date.parse(`${dateStr}T00:00:00.000Z`) - WIB_OFFSET_MS);
}

// Awal hari BERIKUTNYA — dipakai sebagai batas EKSKLUSIF (`lt`), bukan
// 23:59:59.999. Pakai batas eksklusif supaya tidak ada celah 1ms yang
// membuang order yang tercatat tepat di ujung hari.
export function endOfDayExclusiveWIB(dateStr) {
  return new Date(startOfDayWIB(dateStr).getTime() + 86_400_000);
}

// Awal bulan WIB sebagai instant UTC. `month` 1-12 (bukan 0-11 seperti Date).
export function startOfMonthWIB(year, month) {
  const mm = String(month).padStart(2, "0");
  return startOfDayWIB(`${year}-${mm}-01`);
}

// Awal bulan berikutnya — batas EKSKLUSIF untuk rentang 1 bulan.
export function endOfMonthExclusiveWIB(year, month) {
  return month === 12
    ? startOfMonthWIB(year + 1, 1)
    : startOfMonthWIB(year, month + 1);
}

// Tanggal kalender WIB "sekarang" — dipakai kalau butuh tahu bulan/tahun
// berjalan MENURUT WIB, bukan menurut jam container (UTC). Contoh bedanya:
// 1 Juli 03:00 WIB = 30 Juni 20:00 UTC → menurut container masih bulan Juni.
export function nowPartsWIB(now = new Date()) {
  const shifted = new Date(now.getTime() + WIB_OFFSET_MS);
  return {
    year:  shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1, // 1-12
    day:   shifted.getUTCDate(),
  };
}

// Render instant UTC → string jam WIB untuk dibaca manusia (pesan WA alert,
// email, stempel tanggal di Knowledge Base). Selalu sertakan "WIB" supaya
// penerima tidak menebak zona.
export function formatWIB(date = new Date(), opts = {}) {
  const teks = new Date(date).toLocaleString("id-ID", {
    timeZone: WIB_TZ,
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    ...opts,
  });
  return `${teks} WIB`;
}

// Jam kerja WIB (dipakai job SLA/backlog — services/slaAlertJob.js) — start/end
// dalam jam 24-jam WIB, end EKSKLUSIF (mis. start=8, end=17 → 08:00-16:59 WIB
// dianggap jam kerja, 17:00 ke atas sudah "luar jam kerja").
export function isWorkingHoursWIB(date = new Date(), { start = 8, end = 17 } = {}) {
  const shifted = new Date(date.getTime() + WIB_OFFSET_MS);
  const hour = shifted.getUTCHours();
  return hour >= start && hour < end;
}

// ─── WAKTU RESPONS "JUJUR" TERHADAP JAM OPERASIONAL (25 Agustus 2026) ───────
//
// Dipakai KHUSUS untuk metrik LAPORAN (Rata-rata Respons, tren, kolom per
// sales) — BUKAN untuk ambang SLA breach/takeover/eskalasi supervisor, yang
// TETAP wall-clock 60 menit apa adanya (lihat catatan "SLA balas pertama"
// di CLAUDE.md §18c: "SENGAJA sama dengan sla_breach... jangan diganti
// sepihak"). Dua kebutuhan yang beda: SLA breach = "apakah melanggar ambang
// operasional yang SAMA di seluruh sistem", laporan ini = "seberapa cepat
// tim SEBENARNYA merespons kalau lagi kerja".
//
// MASALAH yang diperbaiki: rata-rata mentah (createdAt selisih apa adanya)
// digelembungkan oleh pesan yang masuk MALAM lalu baru dibalas paginya —
// jeda semalaman itu bukan sales lambat, tapi memang di luar jam kerja
// (owner melaporkan rata-rata 14 jam 30 menit yang jelas tidak masuk akal
// untuk tim yang aktif membalas siang hari).
//
// PENDEKATAN: BUKAN filter kaku "cuma hitung kalau dua-duanya di jam
// 09-21" (itu JUSTRU salah ke arah lain — balasan jam 22:00 utk pesan
// 21:30 akan ke-nolkan/salah hitung, padahal itu balasan cepat & nyata,
// dan owner mengonfirmasi sales/leader kadang memang balas di luar jam
// operasional). Sebagai gantinya: buang HANYA jendela tutup (21:00→09:00
// WIB) yang BENAR-BENAR terlewati UTUH di antara pesan & balasan — kalau
// balasannya sendiri terjadi DI DALAM jendela tutup itu (jam berapa pun),
// jendela itu TIDAK dibuang sama sekali, dan selisih wall-clock asli
// dipakai apa adanya. Simetris untuk pagi (balas jam 07:00 utk pesan jam
// 06:45 → tidak ada jendela utuh yang terlewati, dihitung apa adanya).
export function effectiveResponseMinutes(fromUtc, toUtc, { start = 9, end = 21 } = {}) {
  const from = new Date(fromUtc);
  const to = new Date(toUtc);
  if (!(to > from)) return 0;

  let totalMinutes = (to.getTime() - from.getTime()) / 60_000;
  const closedHours = 24 - (end - start); // 09-21 → 12 jam tutup semalam

  // Jendela tutup PERTAMA yang mungkin relevan: jam `end`:00 WIB di hari
  // pesan masuk (direpresentasikan via trik shift+getUTC* yang sama dengan
  // isWorkingHoursWIB di atas — BUKAN tanggal UTC asli).
  const fromShifted = new Date(from.getTime() + WIB_OFFSET_MS);
  let closeShifted = new Date(Date.UTC(
    fromShifted.getUTCFullYear(), fromShifted.getUTCMonth(), fromShifted.getUTCDate(), end, 0, 0
  ));

  // Iterasi tiap hari — berhenti begitu jendela tutup itu sendiri sudah
  // >= waktu balasan (tidak ada lagi jendela yang bisa "utuh terlewati").
  for (let guard = 0; guard < 366; guard++) {
    const closeUtc = new Date(closeShifted.getTime() - WIB_OFFSET_MS);
    if (closeUtc >= to) break;
    const openNextUtc = new Date(closeUtc.getTime() + closedHours * 3_600_000);
    // Jendela UTUH terlewati hanya kalau balasan terjadi SETELAH jam buka
    // berikutnya (openNextUtc <= to). Kalau balasan justru jatuh DI DALAM
    // jendela ini (to < openNextUtc), jangan buang apa pun — biarkan
    // wall-clock asli yang bicara (lihat catatan simetri di atas).
    //
    // Yang dibuang HANYA irisan jendela dengan (from, to) — BUKAN
    // closedHours mentah. Kalau pesan sendiri baru masuk SETELAH jendela
    // ini mulai (mis. pesan jam 23:00, jendela mulai 21:00), sebagian
    // jendela (21:00-23:00) terjadi SEBELUM pesan ada — jangan ikut
    // dibuang, atau elapsed time yang belum pernah terjadi ikut terpotong
    // (bug nyata: kasus "pesan 23:00 → balasan 09:05" sempat menghasilkan
    // 0 menit alih-alih ~5 menit sebelum irisan ini diperbaiki).
    if (openNextUtc <= to) {
      const overlapStart = closeUtc > from ? closeUtc : from;
      totalMinutes -= (openNextUtc.getTime() - overlapStart.getTime()) / 60_000;
    }
    closeShifted = new Date(closeShifted.getTime() + 24 * 3_600_000);
  }

  return Math.max(0, totalMinutes);
}

// CATATAN untuk $queryRaw (lihat analytics.js): kolom Prisma `DateTime` di
// Postgres adalah `timestamp without time zone` yang ISINYA UTC. Supaya
// date_trunc() mengelompokkan menurut kalender WIB (bukan UTC), kolomnya
// harus digeser DULU dengan dua langkah — tandai sebagai UTC, lalu konversi:
//
//   date_trunc('month', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')
//
// Tanpa ini, order jam 00:00-07:00 WIB tanggal 1 akan masuk bucket BULAN
// SEBELUMNYA (karena di UTC masih tanggal terakhir bulan lalu).

// ─── TANGGAL KALENDER SAJA (kolom Prisma @db.Date) ──────────────────────────
//
// Untuk kolom `@db.Date` (pickupConfirmedDate/deliveryConfirmedDate di Order),
// Postgres menyimpan TANGGAL saja tanpa jam/zona. Prisma tetap menuntut objek
// Date, lalu memakai bagian tanggal versi **UTC** dari objek itu.
//
// ⚠️ JANGAN pakai startOfDayWIB() di sini. startOfDayWIB("2026-08-21")
// menghasilkan 2026-08-20T17:00:00Z — bagian tanggal UTC-nya 20 Agustus, jadi
// tanggal yang tersimpan MUNDUR SEHARI dari yang diketik sales. Untuk kolom
// date-only yang benar justru UTC midnight polos.
//
// Melempar Error ber-statusCode 400 (bukan mengembalikan Invalid Date) supaya
// route memberi pesan yang bisa ditindaklanjuti sales. BUG NYATA
// (21 Agustus 2026): sebelum ini ada, `new Date(<teks bebas>)` menghasilkan
// Invalid Date yang lolos sampai Prisma, dan sales cuma melihat dump
// `prisma.order.create()` mentah di layar HP. Aplikasi versi lama masih
// mengirim teks bebas seperti "21 agustus 2026" ke field ini.
export function parseTanggalKalender(input, namaField = "Tanggal") {
  if (input === undefined || input === null || input === "") return null;

  // Terima "YYYY-MM-DD" ATAU ISO penuh ("...T00:00:00.000Z") — klien lama
  // mengirim hasil .toISOString() utuh saat mengedit order yang sudah ada.
  const teks = String(input).trim();
  const cocok = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(teks);
  if (!cocok) {
    throw Object.assign(
      new Error(
        `${namaField} harus format YYYY-MM-DD (contoh: 2026-08-21). ` +
        `Kalau tanggalnya belum pasti, kosongkan saja dan tulis di kolom Estimasi.`
      ),
      { statusCode: 400 }
    );
  }

  const [, th, bl, hr] = cocok;
  const d = new Date(`${th}-${bl}-${hr}T00:00:00.000Z`);
  // Menangkap tanggal yang formatnya benar tapi isinya mustahil (2026-02-31,
  // 2026-13-01) — Date "menggulung" ke bulan berikutnya tanpa error.
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() + 1 !== Number(bl) || d.getUTCDate() !== Number(hr)) {
    throw Object.assign(
      new Error(`${namaField} tidak valid: tanggal ${teks} tidak ada di kalender.`),
      { statusCode: 400 }
    );
  }
  return d;
}
