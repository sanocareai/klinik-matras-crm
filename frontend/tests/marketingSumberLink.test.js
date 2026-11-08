// Sub-tab Sumber & Link di Marketing: URL, tautan keterangan, dan batas isinya.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bacaUrlLaporan, tulisUrlLaporan, TAMPIL_SUMBER_LINK } from "../src/features/laporan/periodeLaporan.js";
import { tautanDariDetail } from "../src/features/laporan/marketingLogic.js";

const TABS = ["Ringkasan", "Sales", "Marketing"];
const baca = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("URL sub-tab bertahan dan nilai asing diabaikan", () => {
  assert.equal(bacaUrlLaporan("?tab=Marketing&tampil=sumber-link", TABS).tampil, TAMPIL_SUMBER_LINK);
  assert.equal(bacaUrlLaporan("?tab=Marketing&tampil=asal", TABS).tampil, null);
  assert.equal(bacaUrlLaporan("?tab=Sales&tampil=sumber-link", TABS).tampil, null);
  assert.equal(bacaUrlLaporan("?tab=Marketing&sumber=META&tampil=sumber-link", TABS).tampil, null);
});

test("hanya kunci sub-tab yang ditulis saat tidak membuka satu sumber", () => {
  const tulis = (marketing) => tulisUrlLaporan(new URLSearchParams(), { tab: "Marketing", range: { from: null, to: null }, marketing }).get("tampil");
  assert.equal(tulis({ tampil: TAMPIL_SUMBER_LINK }), TAMPIL_SUMBER_LINK);
  assert.equal(tulis({ tampil: null }), null);
  assert.equal(tulis({ tampil: TAMPIL_SUMBER_LINK, sumber: "META" }), null);
});

test("link publik menjadi tautan, keterangan lain tidak", () => {
  assert.equal(tautanDariDetail("Meta CTWA - instagram - instagram.com/p/De93PAQAW1A"), "https://instagram.com/p/De93PAQAW1A");
  assert.equal(tautanDariDetail("fb.me/77pJdJNsy"), "https://fb.me/77pJdJNsy");
  assert.equal(tautanDariDetail("Meta CTWA - whatsapp - wa.me/wamo/status/preview/1/2"), null);
  assert.equal(tautanDariDetail("Kemungkinan TikTok, belum terbukti (hanya cocok klik)"), null);
  assert.equal(tautanDariDetail(null), null);
});

test("tampilan Sumber & Link tidak memuat biaya lama bulanan", () => {
  const r = baca("../src/features/laporan/components/marketing/RincianKreatif.jsx");
  assert.match(r, /if \(hanyaRincian\) return undefined;/);
  assert.match(r, /!hanyaRincian && perfRows\.length > 0/);
  assert.match(baca("../src/features/laporan/components/MarketingTab.jsx"), /rangeParams=\{rangeParams\} hanyaRincian/);
});
