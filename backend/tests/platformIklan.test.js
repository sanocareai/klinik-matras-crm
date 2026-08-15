// Tes penurunan platform iklan (Facebook / Instagram / WhatsApp) dari
// Customer.leadSourceDetail.
//
// Semua contoh di bawah DISALIN dari data produksi 14 Agt 2026, bukan
// karangan — bentuk string ini ditulis oleh leadAttribution.js dan bisa
// berubah kalau format detailnya diubah. Kalau tes ini gagal setelah
// mengubah format detail, itu memang peringatan yang benar: laporan
// "Rincian per Iklan" akan ikut salah kelompok.

import test from "node:test";
import assert from "node:assert/strict";
import { platformDariDetail, PLATFORM } from "../src/services/platformIklan.js";

test("kata platform eksplisit dari Meta dikenali", () => {
  assert.equal(platformDariDetail("Meta CTWA - facebook - fb.me/77pJdJNsy"), PLATFORM.FACEBOOK);
  assert.equal(platformDariDetail("Meta CTWA - instagram - instagram.com/p/DXWbO-EAOeT"), PLATFORM.INSTAGRAM);
  assert.equal(platformDariDetail("Meta CTWA - whatsapp - wa.me/wamo/status/preview/628/526"), PLATFORM.WHATSAPP);
});

test("tanpa kata platform, disimpulkan dari domain kreatifnya", () => {
  assert.equal(platformDariDetail("Meta CTWA - fb.me/77pJdJNsy"), PLATFORM.FACEBOOK);
  assert.equal(platformDariDetail("Meta CTWA - instagram.com/p/DXWbO-EAOeT"), PLATFORM.INSTAGRAM);
});

test("tag dari website (ig-paid / fb-paid) ikut dikenali", () => {
  assert.equal(platformDariDetail("Website - ig-paid-52681422227284"), PLATFORM.INSTAGRAM);
  assert.equal(platformDariDetail("Website - fb-paid-52681422227284"), PLATFORM.FACEBOOK);
});

test("lead lama retroaktif TETAP tidak diketahui — jangan ditebak", () => {
  // Ini inti prinsipnya: platform untuk 938 lead retroaktif memang TIDAK
  // PERNAH tersimpan (CTWA baru ditangkap 13 Agt 2026). Menebaknya jadi
  // Facebook atau Instagram akan membuat laporan belanja iklan salah
  // tanpa ada tanda apa pun bahwa itu tebakan.
  assert.equal(
    platformDariDetail("Meta Ads (retroaktif: template chat iklan), campaign tidak diketahui"),
    PLATFORM.UNKNOWN,
  );
  assert.equal(platformDariDetail("Website - google-cpc"), PLATFORM.UNKNOWN);
  assert.equal(platformDariDetail(null), PLATFORM.UNKNOWN);
  assert.equal(platformDariDetail(""), PLATFORM.UNKNOWN);
});

test("app=facebook tapi kreatif postingan Instagram -> INSTAGRAM (pilihan sadar)", () => {
  // Bentuk ini ADA di data nyata. Lihat catatan panjang di
  // services/platformIklan.js kenapa kreatif yang dimenangkan, bukan
  // tempat tayang.
  assert.equal(
    platformDariDetail("Meta CTWA - facebook - instagram.com/p/DXWbO-EAOeT"),
    PLATFORM.INSTAGRAM,
  );
});

test("besar-kecil huruf tidak berpengaruh", () => {
  assert.equal(platformDariDetail("META CTWA - FACEBOOK - FB.ME/xxx"), PLATFORM.FACEBOOK);
});
