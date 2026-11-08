// Rapikan isi tab Delivery (gaya Apple): hanya CSS di dalam kerangka Apple + kelas nowrap pada kode. Data, filter, dan aksi tidak berubah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = (f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

test("CSS isi halaman: dibatasi .ap-skin main; lencana kalimat biasa, kode tidak terpecah, baris lebih lega", () => {
  const css = src("styles/sanss-apple.css"); const blok = css.slice(css.indexOf("isi halaman (tab Delivery"));
  const aturan = blok.split("\n").filter((x) => /^:root /.test(x));
  assert.ok(aturan.length >= 5);
  for (const a of aturan) assert.match(a, /^:root \.app-shell\.crm-skin\.ap-skin main /, `harus dibatasi .ap-skin main: ${a.slice(0, 70)}`);
  assert.match(blok, /main \.uppercase \{ text-transform: none; letter-spacing: 0; \}/);
  assert.match(blok, /:is\(\.rounded-chip, \.ord-chip\) \{ border-radius: 999px;/);
  assert.match(blok, /main tbody td \{ padding-block: 14px; \}/);
});

test("angka kartu di HP mengikuti lebar kartu (container query); desktop tidak diubah", () => {
  const css = src("styles/sanss-apple.css");
  assert.match(css, /\.ap-widget \{ container-type: inline-size; \}/);
  assert.match(css, /@media \(max-width: 767px\) \{\s*\.ap-widget \{ padding: 16px; \}\s*\.ap-w-angka \{ font-size: clamp\(19px, 9\.6cqi, 30px\);/);
});

test("kode order/job/unit di Semua Order, Kendala, Retur tidak terpecah di tanda hubung; isi sel tidak berubah", () => {
  assert.match(src("pages/armada/ArmadaOrders.jsx"), /<TD className="whitespace-nowrap font-semibold text-ink">\{o\.orderNumber \|\| o\.id\.slice\(0, 8\)\}<\/TD>/);
  const i = src("pages/armada/ArmadaIssues.jsx"); assert.match(i, /whitespace-nowrap font-semibold text-ink">\{jobLabelOf\(j\)\}/); assert.match(i, /whitespace-nowrap text-ink2">\{orderNumberOf\(j\) \|\| "—"\}/);
  assert.match(src("pages/armada/ArmadaReturns.jsx"), /whitespace-nowrap font-semibold text-ink">\{r\.unit\?\.unitCode\}/);
});

test("daftar baris: tanpa titik bawaan di ul flex/grid dan paragraf baris tanpa margin 1em bawaan; dibatasi .ap-skin", () => {
  const css = fs.readFileSync(new URL("../src/styles/sanss-apple.css", import.meta.url), "utf8");
  assert.match(css, /:root \.app-shell\.crm-skin\.ap-skin main :is\(li, button\) p:not\(\[class\*="mt-"\], \[class\*="mb-"\], \[class\*="my-"\]\) \{ margin-block: 0; \}/);
  assert.match(css, /main :is\(li, button\) p \+ p:not\(\[class\*="mt-"\]\) \{ margin-top: 2px; \}/);
  assert.match(css, /:is\(ul, ol\):is\(\[class\*="divide-"\], \[class\*="flex"\], \[class\*="grid"\], \[class\*="space-y"\]\) \{ list-style: none; padding-left: 0; \}/);
});
