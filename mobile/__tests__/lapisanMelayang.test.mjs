// Bug 7 Okt 2026: Inbox > profil pelanggan > order > "Rincian" tampak tidak berfungsi karena layar baru terbuka DI BELAKANG panel profil.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { daftarkanPenutupLapisan, tutupLapisanMelayang } from "../src/lib/lapisanMelayang.js";

test("semua panel terdaftar ditutup; panel yang sudah dicabut tidak dipanggil lagi", () => {
  const log = [];
  const cabutA = daftarkanPenutupLapisan(() => log.push("A"));
  const cabutB = daftarkanPenutupLapisan(() => log.push("B"));
  tutupLapisanMelayang();
  assert.deepEqual(log.sort(), ["A", "B"]);
  cabutA(); log.length = 0;
  tutupLapisanMelayang();
  assert.deepEqual(log, ["B"]);
  cabutB();
});

test("satu penutup yang error tidak menghalangi penutup lain (navigasi tetap jalan)", () => {
  const log = [];
  const c1 = daftarkanPenutupLapisan(() => { throw new Error("sheet sudah tertutup"); });
  const c2 = daftarkanPenutupLapisan(() => log.push("ok"));
  assert.doesNotThrow(() => tutupLapisanMelayang());
  assert.deepEqual(log, ["ok"]);
  c1(); c2();
});

test("tanpa panel terdaftar: tidak error", () => assert.doesNotThrow(() => tutupLapisanMelayang()));

test("PEMASANGAN: navigasi lintas-layar menutup panel dulu; CustomerSheet mendaftarkan penutupnya", () => {
  const baca = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const nav = baca("../src/lib/navigationRef.js");
  for (const fn of ["navigateToChat", "navigateToOrderTimeline"]) {
    const badan = nav.slice(nav.indexOf(`export function ${fn}`));
    const sampai = badan.indexOf("navigationRef.navigate(");
    assert.ok(sampai > 0 && badan.slice(0, sampai).includes("tutupLapisanMelayang()"), `${fn} harus menutup panel SEBELUM navigate`);
  }
  assert.match(baca("../src/components/CustomerSheet.js"), /daftarkanPenutupLapisan\(\(\) => sheetRef\.current\?\.dismiss\(\)\)/);
});
