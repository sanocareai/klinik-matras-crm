// Tes penjaga JID grup placeholder. Dijalankan dengan `npm test`.
//
// KENAPA TES INI ADA (bug nyata 21 Agustus 2026):
// scripts/fix-group-conversations.js membuat `unknown-<cuid>@g.us` untuk
// percakapan grup lama yang JID aslinya tidak bisa diketahui lagi. Salah satu
// grup itu ("GRUP SALES", pesan terakhir 7 Juli, tanpa sessionId) ditandai
// sebagai grup penerima ringkasan order — padahal grup yang HIDUP adalah
// "SANO SALES" (120363406463516936@g.us, CS-1, aktif tiap hari).
//
// Akibatnya tombol "Kirim ke Grup WA" SELALU gagal, dan gagalnya lambat:
// engine GOWS menunggu "failed to get group members: info query timed out"
// ~75 detik per sesi, dicoba CS-1 lalu CS-2. Klien mobile menyerah di 30
// detik dan sales cuma melihat "fetch failed: Fetch request has been
// canceled" — nol petunjuk soal salah pilih grup.
//
// Yang dikunci di sini: JID placeholder dikenali, dan JID grup ASLI tidak
// ikut terblokir (regresi itu akan mematikan SELURUH fitur pesan grup —
// bahaya yang sama sudah dicatat CLAUDE.md §5 soal isLidLikePhone).

import test from "node:test";
import assert from "node:assert/strict";

import { isPlaceholderGroupJid, isLidLikePhone } from "../src/services/wahaClient.js";

test("JID placeholder dari script migrasi dikenali", () => {
  assert.equal(isPlaceholderGroupJid("unknown-cmra33jje001kqn6t24hrym0s@g.us"), true);
  assert.equal(isPlaceholderGroupJid("unknown-cmra37gsf0024qn6t3d7xmup3@g.us"), true);
});

// Regresi paling berbahaya: kalau predikat ini kelewat lebar, semua grup
// nyata ikut diblok dan fitur pesan grup mati total.
test("JID grup ASLI TIDAK ikut terblokir", () => {
  for (const jid of [
    "120363406463516936@g.us", // SANO SALES — grup order yang benar
    "120363425357739617@g.us", // SANO DRIVETHRU
    "120363424436547676@g.us", // SANO TIM PRODUKSI
  ]) {
    assert.equal(isPlaceholderGroupJid(jid), false, `${jid} harus lolos`);
  }
});

test("nomor individual & nilai kosong tidak dianggap placeholder", () => {
  for (const v of ["628123456789@c.us", "628123456789", "", null, undefined]) {
    assert.equal(isPlaceholderGroupJid(v), false);
  }
});

// Dua penjaga ini hidup berdampingan di buildChatId(); pastikan tidak ada
// yang menelan kasus milik yang lain.
test("penjaga placeholder dan penjaga LID tidak saling tumpang tindih", () => {
  const placeholder = "unknown-cmra33jje001kqn6t24hrym0s@g.us";
  assert.equal(isPlaceholderGroupJid(placeholder), true);
  assert.equal(isLidLikePhone(placeholder), false, "placeholder bukan urusan penjaga LID");

  const lid = "21556474458313@lid";
  assert.equal(isLidLikePhone(lid), true);
  assert.equal(isPlaceholderGroupJid(lid), false, "LID bukan urusan penjaga placeholder");
});
