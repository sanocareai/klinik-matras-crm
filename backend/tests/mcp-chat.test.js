// Tes metrik percakapan MCP (backend/src/mcp/toolsChat.js) — FUNGSI MURNI,
// tanpa DB, pola sama seperti authorize.test.js. Dijalankan dengan `npm test`.
//
// Kenapa ini penting: angka-angka inilah yang dipakai menilai kualitas
// pelanggan DAN menilai kerja sales. Salah hitung "giliran balas" atau
// "ghosting" berarti orang bisa dinilai keliru — jadi definisinya dikunci tes.

import test from "node:test";
import assert from "node:assert/strict";

import {
  hitungMetrikPercakapan,
  skorEngagement,
  hitungPelanggaran,
  SLA_BALAS_PERTAMA_MENIT,
} from "../src/mcp/toolsChat.js";
// Pendeteksi aturan produk yang dipakai ulang oleh audit — dites di sini juga
// untuk memastikan kontraknya tidak berubah diam-diam di sisi replyAssistant.
import { violations } from "../src/services/replyAssistant/validator.js";

const T0 = new Date("2026-08-01T00:00:00.000Z");
const pesan = (direction, menit) => ({ direction, createdAt: new Date(T0.getTime() + menit * 60_000) });

// ── Giliran balas (kedalaman dialog 2 arah) ─────────────────────────────────
test("giliranBalas menghitung PERGANTIAN arah, bukan jumlah pesan", () => {
  // Customer nyerocos 5 pesan, tidak pernah dibalas → 0 giliran.
  const sepihak = hitungMetrikPercakapan([
    pesan("INBOUND", 0), pesan("INBOUND", 1), pesan("INBOUND", 2),
    pesan("INBOUND", 3), pesan("INBOUND", 4),
  ]);
  assert.equal(sepihak.giliranBalas, 0, "monolog customer bukan dialog");
  assert.equal(sepihak.pesanMasuk, 5);
  assert.equal(sepihak.tidakPernahDibalas, true);

  // Bolak-balik I,O,I,O = 3 pergantian arah.
  const dialog = hitungMetrikPercakapan([
    pesan("INBOUND", 0), pesan("OUTBOUND", 5), pesan("INBOUND", 10), pesan("OUTBOUND", 15),
  ]);
  assert.equal(dialog.giliranBalas, 3);
});

// ── SLA balas pertama ───────────────────────────────────────────────────────
test("balasPertamaMenit dihitung dari INBOUND pertama ke OUTBOUND setelahnya", () => {
  const cepat = hitungMetrikPercakapan([pesan("INBOUND", 0), pesan("OUTBOUND", 20)]);
  assert.equal(cepat.balasPertamaMenit, 20);
  assert.equal(cepat.slaBalasPertamaTerlampaui, false, "20 menit masih di bawah SLA 60");

  const lambat = hitungMetrikPercakapan([pesan("INBOUND", 0), pesan("OUTBOUND", 120)]);
  assert.equal(lambat.balasPertamaMenit, 120);
  assert.equal(lambat.slaBalasPertamaTerlampaui, true);

  // Ambang bisa disetel; default-nya 60 (sama dengan aturan takeover CRM).
  assert.equal(SLA_BALAS_PERTAMA_MENIT, 60);
  const longgar = hitungMetrikPercakapan([pesan("INBOUND", 0), pesan("OUTBOUND", 120)], { slaMenit: 180 });
  assert.equal(longgar.slaBalasPertamaTerlampaui, false);
});

test("OUTBOUND yang mendahului pesan customer TIDAK dihitung sebagai balasan", () => {
  // Broadcast/sapaan duluan, baru customer menjawab — balas pertama harus
  // dihitung dari INBOUND pertama, bukan dari outbound pembuka.
  const m = hitungMetrikPercakapan([
    pesan("OUTBOUND", 0), pesan("INBOUND", 60), pesan("OUTBOUND", 90),
  ]);
  assert.equal(m.balasPertamaMenit, 30, "60→90 = 30 menit, bukan dihitung dari outbound pembuka");
});

// ── Ghosting vs ditinggal sales ─────────────────────────────────────────────
test("ghosting = CS sudah menjawab tapi customer tidak pernah merespons", () => {
  const m = hitungMetrikPercakapan([pesan("INBOUND", 0), pesan("OUTBOUND", 10)]);
  assert.equal(m.ghosting, true);
  assert.equal(m.pernahBalasSetelahDijawab, false);
  assert.equal(m.ditinggalSetelahBalasPertama, false);
});

test("ditinggalSetelahBalasPertama = customer membalas lagi lalu didiamkan sales", () => {
  // Pola "sales cuma balas di awal lalu hilang" (CLAUDE.md §7C).
  const m = hitungMetrikPercakapan([
    pesan("INBOUND", 0), pesan("OUTBOUND", 5), pesan("INBOUND", 10),
  ]);
  assert.equal(m.ditinggalSetelahBalasPertama, true);
  assert.equal(m.ghosting, false, "yang diam sales, bukan customer");
  assert.equal(m.pernahBalasSetelahDijawab, true);
});

test("percakapan yang sehat tidak ditandai ghosting maupun ditinggal", () => {
  const m = hitungMetrikPercakapan([
    pesan("INBOUND", 0), pesan("OUTBOUND", 5), pesan("INBOUND", 10), pesan("OUTBOUND", 15),
  ]);
  assert.equal(m.ghosting, false);
  assert.equal(m.ditinggalSetelahBalasPertama, false);
});

// ── Urutan input tidak boleh mempengaruhi hasil ─────────────────────────────
test("metrik sama walau pesan diberikan dalam urutan acak", () => {
  const urut = [pesan("INBOUND", 0), pesan("OUTBOUND", 5), pesan("INBOUND", 10), pesan("OUTBOUND", 15)];
  const acak = [urut[2], urut[0], urut[3], urut[1]];
  assert.deepEqual(hitungMetrikPercakapan(acak), hitungMetrikPercakapan(urut));
});

test("percakapan kosong tidak melempar error", () => {
  const m = hitungMetrikPercakapan([]);
  assert.equal(m.totalPesan, 0);
  assert.equal(m.balasPertamaMenit, null);
  assert.equal(m.tidakPernahDibalas, false, "tanpa pesan masuk, bukan berarti diabaikan");
  assert.equal(m.ghosting, false);
});

// ── Skor engagement ─────────────────────────────────────────────────────────
test("dialog dalam & responsif skornya TINGGI, monolog tak dibalas RENDAH", () => {
  const bagus = skorEngagement(hitungMetrikPercakapan([
    pesan("INBOUND", 0), pesan("OUTBOUND", 5), pesan("INBOUND", 10),
    pesan("OUTBOUND", 15), pesan("INBOUND", 20), pesan("OUTBOUND", 25),
  ]));
  assert.equal(bagus.kategori, "TINGGI");
  assert.ok(bagus.skor >= 65);

  const buruk = skorEngagement(hitungMetrikPercakapan([pesan("INBOUND", 0), pesan("INBOUND", 5)]));
  assert.equal(buruk.kategori, "RENDAH");
  assert.ok(buruk.alasan.some((a) => /belum pernah dibalas/i.test(a)));
});

test("skor selalu di rentang 0-100 dan selalu punya alasan yang bisa dijelaskan", () => {
  const kasus = [
    [],
    [pesan("INBOUND", 0)],
    [pesan("INBOUND", 0), pesan("OUTBOUND", 1)],
    Array.from({ length: 40 }, (_, i) => pesan(i % 2 ? "OUTBOUND" : "INBOUND", i)),
  ];
  for (const k of kasus) {
    const s = skorEngagement(hitungMetrikPercakapan(k));
    assert.ok(s.skor >= 0 && s.skor <= 100, `skor di luar rentang: ${s.skor}`);
    assert.ok(["TINGGI", "SEDANG", "RENDAH"].includes(s.kategori));
    assert.ok(Array.isArray(s.alasan));
  }
});

// ── Pendeteksi pelanggaran aturan produk (dipakai ulang dari replyAssistant) ─
test("violations() menangkap pelanggaran aturan produk di teks balasan sales", () => {
  assert.deepEqual(violations("Halo kak, ada yang bisa dibantu?"), [], "kalimat netral tidak boleh kena");
  assert.ok(violations("Harganya Rp5.000.000 ya kak").includes("price"));
  assert.ok(violations("Ada diskon 20% khusus hari ini").includes("discount"));
  assert.ok(violations("Kami kasih gratis ongkir").includes("freebie"));
  assert.ok(violations("Dikirim 3 hari kerja ya kak").includes("delivery"));
  assert.ok(violations("Garansi 20 tahun kak").includes("warranty"));
  assert.ok(violations("Kasur ini menyembuhkan saraf kejepit").includes("medical"));
  assert.ok(violations("Dijamin cocok buat bapak").includes("certainty"));
});

test("hitungPelanggaran meringkas daftar kategori jadi hitungan", () => {
  assert.deepEqual(hitungPelanggaran(["price", "price", "delivery"]), { price: 2, delivery: 1 });
  assert.deepEqual(hitungPelanggaran([]), {});
});
