// Tes aturan revisi scope (PRD §7.4, D-008).
//
// Yang diuji di sini logika MURNI yang tidak butuh database: kapan sebuah
// revisi wajib memblokir unit. Aturannya datang dari ROUTING.md §5 dan mudah
// salah dibaca — memblokir terlalu longgar menghentikan produksi tanpa ada
// yang perlu ditanyakan ke customer; terlalu ketat membuat kasur dikerjakan
// dengan harga yang belum disetujui siapa pun.
//
// Bagian yang menyentuh database (delta → OrderItem, perpindahan layanan,
// penolakan memutuskan ulang) diverifikasi lewat tes otorisasi + pemeriksaan
// langsung setelah deploy, karena butuh data nyata.

import test from "node:test";
import assert from "node:assert/strict";

import { harusMemblokir } from "../src/services/scopeRevision.js";
import { ROLE_PERMISSIONS, PERMISSIONS as P } from "../src/constants/permissions.js";

// --- kapan revisi memblokir ------------------------------------------------
test("perubahan harga SELALU memblokir, ke atas maupun ke bawah", () => {
  assert.equal(harusMemblokir({ deltaAmount: 500000 }), true);
  // Delta negatif juga: temuan bisa membuat pekerjaan lebih ringan, dan
  // customer tetap harus tahu harganya berubah.
  assert.equal(harusMemblokir({ deltaAmount: -250000 }), true);
});

test("pindah LINI memblokir walau harganya sama", () => {
  // ROUTING.md §5: fondasi ternyata tidak layak diperkuat → pindah dari
  // SERVICE ke UPGRADE. Pekerjaannya beda total; customer harus setuju
  // walau angkanya kebetulan tidak berubah.
  assert.equal(harusMemblokir({
    deltaAmount: 0, fromServiceLine: "SERVICE", toServiceLine: "UPGRADE",
  }), true);
});

test("ganti modul di dalam lini yang sama tanpa perubahan harga TIDAK memblokir", () => {
  // Cukup dicatat. Memblokir di sini cuma menghentikan produksi tanpa ada
  // pertanyaan yang perlu dijawab customer.
  assert.equal(harusMemblokir({
    deltaAmount: 0, fromServiceLine: "SERVICE", toServiceLine: "SERVICE",
  }), false);
  // Layanan tidak berubah sama sekali, cuma catatan temuan.
  assert.equal(harusMemblokir({ deltaAmount: 0 }), false);
});

test("lini yang belum diketahui tidak dianggap perubahan lini", () => {
  // serviceLine unit NULL sampai Uji Fondasi selesai (D-008). Membandingkan
  // null dengan sebuah lini TIDAK boleh dihitung sebagai "pindah lini" —
  // kalau iya, setiap revisi pertama pada unit akan memblokir tanpa alasan.
  assert.equal(harusMemblokir({ deltaAmount: 0, fromServiceLine: null, toServiceLine: "UPGRADE" }), false);
  assert.equal(harusMemblokir({ deltaAmount: 0, fromServiceLine: "SERVICE", toServiceLine: null }), false);
});

// --- pemisahan hak akses ---------------------------------------------------
// Ini invarian keamanan, bukan sekadar konfigurasi: kalau satu role memegang
// kedua permission, orang yang sama bisa mengarang delta harga sekaligus
// menyetujuinya, dan seluruh gunanya alur ini hilang.
test("tidak ada satu role pun yang bisa mengajukan SEKALIGUS memutuskan", () => {
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const bisaAjukan = perms.includes(P.SCOPE_REVISION_PROPOSE);
    const bisaPutuskan = perms.includes(P.SCOPE_REVISION_DECIDE);
    assert.ok(
      !(bisaAjukan && bisaPutuskan),
      `Role ${role} memegang PROPOSE dan DECIDE sekaligus — pemisahan tugasnya bocor`
    );
  }
});

test("produksi & QC mengajukan, sales & admin memutuskan", () => {
  assert.ok(ROLE_PERMISSIONS.PRODUCTION_LEAD.includes(P.SCOPE_REVISION_PROPOSE));
  assert.ok(ROLE_PERMISSIONS.QC_LEAD.includes(P.SCOPE_REVISION_PROPOSE));
  assert.ok(ROLE_PERMISSIONS.SALES.includes(P.SCOPE_REVISION_DECIDE));
  assert.ok(ROLE_PERMISSIONS.ADMIN.includes(P.SCOPE_REVISION_DECIDE));

  // Pekerja produksi biasa TIDAK boleh mengajukan revisi harga — dia
  // mengerjakan tahap, bukan menegosiasikan nilai order.
  assert.ok(!ROLE_PERMISSIONS.PRODUCTION_WORKER.includes(P.SCOPE_REVISION_PROPOSE));
  assert.ok(!ROLE_PERMISSIONS.PRODUCTION_WORKER.includes(P.SCOPE_REVISION_DECIDE));
});
