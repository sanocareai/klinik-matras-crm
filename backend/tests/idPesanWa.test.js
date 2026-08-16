// Tes ekstraksi ID pesan WhatsApp dari externalId WAHA.
//
// Semua contoh di bawah DISALIN dari data production 16 Agt 2026 (grup
// SANO SALES), bukan karangan. Fungsi ini dipakai untuk MELEWATI pesan
// yang dianggap gema — kalau salah urai, pesan sungguhan bisa ikut
// terbuang. Karena itu bentuk yang tidak dikenali WAJIB mengembalikan
// null (jatuh ke perilaku aman "simpan saja"), bukan tebakan.

import test from "node:test";
import assert from "node:assert/strict";
import { idPesanInti } from "../src/utils/idPesanWa.js";

test("pasangan kirim/gema yang SAMA menghasilkan ID inti yang sama", () => {
  // Inilah inti bug #3: dua string berbeda, satu pesan yang sama.
  const dikirimCrm = "true_120363406463516936@g.us_3EB0D2E1B2462CE7F000D1_6285187283900@c.us";
  const gemaWebhook = "false_120363406463516936@g.us_3EB0D2E1B2462CE7F000D1_222681874051121@lid";

  assert.equal(idPesanInti(dikirimCrm), "3EB0D2E1B2462CE7F000D1");
  assert.equal(idPesanInti(gemaWebhook), "3EB0D2E1B2462CE7F000D1");
  assert.equal(idPesanInti(dikirimCrm), idPesanInti(gemaWebhook),
    "kalau dua ini tidak sama, dedup gema tidak akan pernah bekerja");
});

test("bentuk tanpa bagian pengirim (chat pribadi) tetap terurai", () => {
  assert.equal(
    idPesanInti("true_6281510852000@c.us_3EB0DDF210871E657FC7EB"),
    "3EB0DDF210871E657FC7EB",
  );
});

test("pesan masuk biasa dari grup terurai benar", () => {
  assert.equal(
    idPesanInti("false_120363424436547676@g.us_3ABD6D12C1B6841614A9_174569130319876@lid"),
    "3ABD6D12C1B6841614A9",
  );
});

test("bentuk yang tidak dikenali -> null, JANGAN menebak", () => {
  // Hasil fungsi ini dipakai untuk melewati penyimpanan pesan. Menebak
  // dari string aneh berisiko membuang pesan sungguhan.
  assert.equal(idPesanInti("cuma-satu-bagian"), null);
  assert.equal(idPesanInti("dua_bagian"), null);
  assert.equal(idPesanInti(""), null);
  assert.equal(idPesanInti(null), null);
  assert.equal(idPesanInti(undefined), null);
});

test("ID pesan berbeda TIDAK dianggap sama", () => {
  const a = "false_120363406463516936@g.us_AAAAAAAAAAAA_111@lid";
  const b = "false_120363406463516936@g.us_BBBBBBBBBBBB_111@lid";
  assert.notEqual(idPesanInti(a), idPesanInti(b));
});
