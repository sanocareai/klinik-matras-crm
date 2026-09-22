// Regresi shared table layout (D-193, halaman daftar Finance lebar layar): hideBelow → class Tailwind,
// table-layout fixed/auto, width style, title otomatis untuk TD truncate. Lihat src/components/ui/table.jsx.
import test from "node:test";
import assert from "node:assert/strict";
import { hideBelowClass, tableLayoutClass, widthStyle, autoTitle, HIDE_BELOW_BREAKPOINTS } from "../src/lib/tableLayout.js";

test("hideBelowClass: preset bernama → breakpoint px yang benar (1024–1365 boleh sembunyi, wajib tampil dari 1366)", () => {
  assert.equal(hideBelowClass("tablet"), "hidden min-[1024px]:table-cell");
  assert.equal(hideBelowClass("wide"), "hidden min-[1366px]:table-cell");
  assert.equal(hideBelowClass("lg"), "hidden min-[1024px]:table-cell");
  assert.equal(HIDE_BELOW_BREAKPOINTS.wide, 1366);
});

test("hideBelowClass: angka px yang TERDAFTAR (literal, bisa di-scan Tailwind) & string angka diterima; falsy/0 tidak menyembunyikan apa pun", () => {
  assert.equal(hideBelowClass(1024), "hidden min-[1024px]:table-cell");
  assert.equal(hideBelowClass("1536"), "hidden min-[1536px]:table-cell");
  assert.equal(hideBelowClass(undefined), "");
  assert.equal(hideBelowClass(null), "");
  assert.equal(hideBelowClass(false), "");
  assert.equal(hideBelowClass(""), "");
});

test("hideBelowClass: px SEMBARANG yang tidak terdaftar di HIDE_BELOW_CLASS fallback ke '' (bukan class yang tidak pernah di-generate Tailwind) — gagal aman, bukan menyembunyikan kolom selamanya", () => {
  const asli = console.warn; const dipanggil = []; console.warn = (...a) => dipanggil.push(a);
  try {
    assert.equal(hideBelowClass(1200), "", "1200 bukan salah satu breakpoint literal yang terdaftar");
    assert.equal(hideBelowClass("bukan-preset"), "");
    assert.equal(hideBelowClass(Number.NaN), "", "NaN falsy → guard awal, dianggap 'tidak diberi' (bukan 'diberi tapi salah'), tidak memperingatkan");
    assert.equal(dipanggil.length, 2, "1200 dan 'bukan-preset' memperingatkan; NaN tidak (tertangkap guard 'tidak diberi')");
  } finally { console.warn = asli; }
});

test("hideBelowClass: SETIAP breakpoint di HIDE_BELOW_BREAKPOINTS menghasilkan class yang literal ada di sumber (tidak diinterpolasi runtime)", () => {
  for (const [nama, px] of Object.entries(HIDE_BELOW_BREAKPOINTS)) {
    assert.equal(hideBelowClass(nama), `hidden min-[${px}px]:table-cell`, `preset "${nama}"`);
  }
});

test("tableLayoutClass: fixed → table-fixed, default → table-auto", () => {
  assert.equal(tableLayoutClass(true), "table-fixed");
  assert.equal(tableLayoutClass(false), "table-auto");
  assert.equal(tableLayoutClass(undefined), "table-auto");
});

test("widthStyle: angka → px, string CSS dipakai apa adanya, kosong → undefined (tidak menimpa style lain)", () => {
  assert.deepEqual(widthStyle(120), { width: "120px" });
  assert.deepEqual(widthStyle("8rem"), { width: "8rem" });
  assert.deepEqual(widthStyle("12%"), { width: "12%" });
  assert.equal(widthStyle(undefined), undefined);
  assert.equal(widthStyle(null), undefined);
  assert.equal(widthStyle(""), undefined);
  assert.equal(widthStyle(0), undefined, "lebar 0 dianggap 'tidak diberi', bukan kolom selebar 0px");
});

test("autoTitle: title eksplisit menang; truncate+string children → title = children; elemen JSX kompleks TIDAK ditebak", () => {
  assert.equal(autoTitle({ title: "Judul manual", truncate: true, children: "Isi" }), "Judul manual");
  assert.equal(autoTitle({ truncate: true, children: "EXP-19092026-001 — Pembayaran sewa mobil bulan September" }),
    "EXP-19092026-001 — Pembayaran sewa mobil bulan September");
  assert.equal(autoTitle({ truncate: false, children: "Isi" }), undefined, "tanpa truncate, tidak ada title otomatis");
  assert.equal(autoTitle({ truncate: true, children: 12345 }), undefined, "children bukan string tidak ditebak jadi title");
  assert.equal(autoTitle({ truncate: true, children: { type: "span" } }), undefined, "elemen JSX tidak ditebak jadi title");
});
