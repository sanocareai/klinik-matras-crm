// Satu kreatif tidak boleh terpecah hanya karena aplikasi tidak terbaca.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detailCtwaKanonik } from "../src/services/leadAttribution.js";

test("bentuk tanpa aplikasi menyatu dengan bentuk lengkap", () => {
  assert.equal(detailCtwaKanonik("Meta CTWA - instagram.com/p/DXWbO-EAOeT"), "Meta CTWA - instagram - instagram.com/p/DXWbO-EAOeT");
  assert.equal(detailCtwaKanonik("Meta CTWA - fb.me/77pJdJNsy"), "Meta CTWA - facebook - fb.me/77pJdJNsy");
  assert.equal(detailCtwaKanonik("Meta CTWA - wa.me/wamo/status/preview/1/2"), "Meta CTWA - whatsapp - wa.me/wamo/status/preview/1/2");
});

test("keterangan lain tidak berubah", () => {
  for (const d of ["Meta CTWA - instagram - instagram.com/p/X", "Meta CTWA - facebook - instagram.com/p/X", "Meta CTWA - instagram", "Meta CTWA", "Website - ig-social", "Kemungkinan TikTok, belum terbukti (hanya cocok klik)", "Meta CTWA - contoh.com/x", null]) {
    assert.equal(detailCtwaKanonik(d), d);
  }
});

test("laporan rincian memakai bentuk kanonik", () => {
  const src = readFileSync(new URL("../src/routes/analytics.js", import.meta.url), "utf8");
  assert.match(src, /const detail = detailCtwaKanonik\(b\.detail\);/);
  assert.match(src, /import \{[^}]*detailCtwaKanonik[^}]*\} from "\.\.\/services\/leadAttribution\.js"/);
});
