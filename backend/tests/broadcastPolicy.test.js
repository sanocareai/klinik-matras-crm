// Tes aturan pengiriman broadcast.
//
// Yang diuji di sini adalah PENGAMAN, bukan fitur: batas harian, jam kirim,
// dan pengenalan permintaan berhenti. Kalau salah satu jebol, akibatnya
// bukan "fitur kurang enak" — tapi nomor WhatsApp yang jadi satu-satunya
// pintu masuk seluruh lead iklan bisa kena banned.

import test from "node:test";
import assert from "node:assert/strict";
import {
  komponenWIB, awalHariWIB, dalamJamKirim, sisaWaktuKirimMs,
  jedaAntarPesanMs, acakJeda, susunPesan, apakahMintaBerhenti,
  JAM_MULAI_WIB, JAM_SELESAI_WIB, JEDA_MINIMUM_MS, SAPAAN_CADANGAN,
  TAG_OPT_OUT,
} from "../src/services/broadcastPolicy.js";
import { susunFilterTarget, belumDibalas } from "../src/routes/broadcast.js";

// Pembantu: bikin Date dari jam WIB tertentu (WIB = UTC+7).
function jamWIB(jam, menit = 0) {
  return new Date(Date.UTC(2026, 7, 14, jam - 7, menit, 0));
}

// --- Jam kirim -----------------------------------------------------------

test("jam kirim: siang hari diizinkan", () => {
  assert.equal(dalamJamKirim(jamWIB(9)), true);
  assert.equal(dalamJamKirim(jamWIB(14)), true);
  assert.equal(dalamJamKirim(jamWIB(19, 59)), true);
});

test("jam kirim: dini hari & malam DITOLAK (bukan cuma tidak sopan — pola 24 jam itu sidik jari bot)", () => {
  assert.equal(dalamJamKirim(jamWIB(3)), false);
  assert.equal(dalamJamKirim(jamWIB(7, 59)), false);
  assert.equal(dalamJamKirim(jamWIB(20)), false, "jam 20:00 tepat sudah di luar (batas eksklusif)");
  assert.equal(dalamJamKirim(jamWIB(23)), false);
});

test("komponenWIB menerjemahkan UTC ke WIB dengan benar", () => {
  // 2026-08-13 20:00 UTC = 2026-08-14 03:00 WIB (hari BERGANTI)
  const k = komponenWIB(new Date(Date.UTC(2026, 7, 13, 20, 0, 0)));
  assert.equal(k.jam, 3);
  assert.equal(k.tanggal, "2026-08-14");
});

test("awalHariWIB: tengah malam WIB, bukan tengah malam UTC", () => {
  // Jam 03:00 WIB tanggal 14 -> awal harinya 14 Agt 00:00 WIB = 13 Agt 17:00 UTC
  const awal = awalHariWIB(new Date(Date.UTC(2026, 7, 13, 20, 0, 0)));
  assert.equal(awal.toISOString(), "2026-08-13T17:00:00.000Z");
});

test("sisaWaktuKirimMs: dihitung sampai jam tutup", () => {
  assert.equal(sisaWaktuKirimMs(jamWIB(10, 30)), 9.5 * 3_600_000);
  assert.equal(sisaWaktuKirimMs(jamWIB(21)), 0, "sudah lewat jam kirim");
  // Sebelum jam buka: dihitung satu jendela penuh, bukan negatif
  assert.equal(sisaWaktuKirimMs(jamWIB(5)), (JAM_SELESAI_WIB - JAM_MULAI_WIB) * 3_600_000);
});

// --- Penyebaran kiriman --------------------------------------------------

test("jeda antar pesan menyebarkan kuota sampai jam tutup, bukan diborong di awal", () => {
  // 100 pesan tersisa, 10 jam tersisa -> 1 pesan tiap 6 menit
  assert.equal(jedaAntarPesanMs(100, 10 * 3_600_000), 360_000);
});

test("jeda tidak pernah lebih cepat dari batas minimum, walau kuota besar", () => {
  // 10.000 pesan dalam 1 jam secara matematis = 0,36 detik/pesan — harus ditahan
  assert.equal(jedaAntarPesanMs(10_000, 3_600_000), JEDA_MINIMUM_MS);
});

test("kuota habis / waktu habis -> tidak ada kiriman berikutnya", () => {
  assert.equal(jedaAntarPesanMs(0, 3_600_000), Infinity);
  assert.equal(jedaAntarPesanMs(50, 0), Infinity);
});

test("acakJeda memberi variasi tapi tetap menghormati batas minimum", () => {
  // Dibandingkan dengan toleransi 1 ms: 0,7 + 0,6 di floating point =
  // 1,2999... sehingga Math.floor menghasilkan 779.999, bukan 780.000.
  // Selisih 1 milidetik pada jeda belasan menit tidak ada artinya —
  // yang penting rentangnya benar, bukan angka persisnya.
  assert.ok(Math.abs(acakJeda(600_000, () => 0) - 420_000) <= 1, "faktor terendah 0,7x");
  assert.ok(Math.abs(acakJeda(600_000, () => 1) - 780_000) <= 1, "faktor tertinggi 1,3x");
  // Jeda kecil + faktor terendah tetap tidak boleh menembus lantai
  assert.equal(acakJeda(JEDA_MINIMUM_MS, () => 0), JEDA_MINIMUM_MS);
  assert.equal(acakJeda(Infinity, () => 0.5), Infinity);
});

// --- Opt-out -------------------------------------------------------------

test("permintaan berhenti dikenali dalam berbagai bentuk", () => {
  for (const teks of ["STOP", "stop", "Berhenti", "BERHENTI!", "unsubscribe",
                      "jangan kirim lagi", "hapus nomor saya", "stop ya"]) {
    assert.equal(apakahMintaBerhenti(teks), true, `harusnya terdeteksi: ${teks}`);
  }
});

test("kata 'stop' di dalam kalimat panjang BUKAN permintaan berhenti", () => {
  // Ini pesan bisnis nyata — kalau salah tandai, customer kehilangan
  // promo yang mungkin dia mau.
  assert.equal(
    apakahMintaBerhenti("tolong stop dulu produksinya ya pak, saya mau ubah ukuran kasurnya"),
    false,
  );
  assert.equal(apakahMintaBerhenti("kasur saya amblas, tolong diperbaiki"), false);
});

test("pesan kosong/null tidak melempar error", () => {
  assert.equal(apakahMintaBerhenti(""), false);
  assert.equal(apakahMintaBerhenti(null), false);
  assert.equal(apakahMintaBerhenti(undefined), false);
});

// --- Penyusunan pesan ----------------------------------------------------

test("{{nama}} diganti nama pelanggan", () => {
  assert.equal(susunPesan("Halo {{nama}}, ada promo!", "Budi"), "Halo Budi, ada promo!");
  assert.equal(susunPesan("Halo {{ nama }}!", "Siti"), "Halo Siti!");
  assert.equal(susunPesan("Halo {{NAMA}}!", "Siti"), "Halo Siti!");
});

test("nama kosong pakai sapaan cadangan, JANGAN sampai jadi 'Halo ,'", () => {
  // Banyak customer di produksi tidak punya nama — tanpa ini pesannya
  // langsung terbaca sebagai blast mesin.
  assert.equal(susunPesan("Halo {{nama}}, apa kabar?", null), `Halo ${SAPAAN_CADANGAN}, apa kabar?`);
  assert.equal(susunPesan("Halo {{nama}}!", "   "), `Halo ${SAPAAN_CADANGAN}!`);
});

// --- Penyusunan filter target --------------------------------------------

test("filter target SELALU mengecualikan yang minta berhenti", () => {
  const where = susunFilterTarget({});
  assert.deepEqual(where.NOT, { tags: { has: TAG_OPT_OUT } });
  assert.deepEqual(where.phone, { not: null });
});

test("saringan 'tidak aktif sejak N hari' dibungkus AND, bukan properti lepas", () => {
  const where = susunFilterTarget({ tidakAktifSejakHari: 30 });
  assert.equal(Array.isArray(where.AND), true);
  assert.ok(where.AND.some((k) => k.conversations?.none?.messages),
    "saringan 'tidak aktif sejak N hari' hilang");
  assert.equal(where.conversations, undefined,
    "jangan di-assign langsung — gampang tertimpa saringan percakapan lain");
});

test("tanpa saringan percakapan, tidak ada klausa AND yang menggantung", () => {
  const where = susunFilterTarget({ stage: "NEW" });
  assert.equal(where.AND, undefined);
  assert.equal(where.pipelineStage, "NEW");
});

test("'belum dibalas' memakai arah pesan terakhir, BUKAN status percakapan", () => {
  // Kenapa ini penting: di produksi Conversation.status praktis tidak pernah
  // diurus (2.453 OPEN : 30 RESOLVED, diperiksa 14 Agt 2026). Kalau saringan
  // memakai status, 436 dari 439 kontak ikut terbuang dan fitur ini terlihat
  // rusak. Arah pesan terakhir ditulis otomatis oleh alur pesan, jadi selalu
  // mencerminkan keadaan sebenarnya.
  assert.equal(belumDibalas({ arahPesanTerakhir: "INBOUND" }), true,
    "customer menulis terakhir = kita masih berutang balasan");
  assert.equal(belumDibalas({ arahPesanTerakhir: "OUTBOUND" }), false,
    "kita yang menulis terakhir = urusan sudah ditutup dari sisi kita");
  assert.equal(belumDibalas({ arahPesanTerakhir: null }), false,
    "belum ada pesan sama sekali bukan berarti berutang balasan");
});
