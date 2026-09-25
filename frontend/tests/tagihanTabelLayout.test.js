// B3.3.1 — tabel Tagihan Supplier: lebar kolom eksplisit, Nomor tidak boleh tumpang-tindih dengan Ref Supplier.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tierTagihan, kolomTagihan, lebarKolom, adaKolom, teksKedua, LEBAR_NOMOR, KETERANGAN_MIN, AMBANG_TIER_TAGIHAN,
} from "../src/features/finance/tierTagihan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");
const AKSI = 148;

test("Lebar Nomor cukup untuk nomor tagihan monospace 12px + padding (tidak lagi 124px)", () => {
  // BILL-01092026-001 = 17 karakter × ±7,2px (monospace 12px) + padding kiri-kanan 24px
  const perlu = 17 * 7.2 + 24;
  assert.ok(LEBAR_NOMOR >= perlu, `${LEBAR_NOMOR} < ${perlu}`);
  for (const t of ["full", "reduced", "minimal"]) assert.equal(kolomTagihan(t, AKSI)[0][1], LEBAR_NOMOR);
});

test("Tier dari lebar container", () => {
  assert.equal(tierTagihan(1700), "full");
  assert.equal(tierTagihan(AMBANG_TIER_TAGIHAN.full), "full");
  assert.equal(tierTagihan(AMBANG_TIER_TAGIHAN.full - 1), "reduced");
  assert.equal(tierTagihan(1010), "reduced");
  assert.equal(tierTagihan(AMBANG_TIER_TAGIHAN.reduced - 1), "minimal");
  assert.equal(tierTagihan(767), "card");
});

test("Di setiap tier lebar tetap muat dan Keterangan (kolom fleksibel) dapat sisa ruang minimal", () => {
  for (const t of ["full", "reduced", "minimal"]) {
    const tetap = lebarKolom(t, AKSI).filter(Boolean).reduce((a, b) => a + b, 0);
    const lebarMin = AMBANG_TIER_TAGIHAN[t];
    assert.ok(lebarMin - tetap >= KETERANGAN_MIN, `${t}: sisa ${lebarMin - tetap} < ${KETERANGAN_MIN}`);
    assert.equal(lebarKolom(t, AKSI).filter((w) => w === null).length, 1, `${t}: tepat satu kolom fleksibel`);
  }
});

test("Ref Supplier hanya sebagai kolom di tier full; di tier sempit pindah ke teks kedua (tidak hilang)", () => {
  assert.ok(adaKolom("full", "ref"));
  assert.ok(!adaKolom("reduced", "ref") && !adaKolom("minimal", "ref"));
  const b = { supplierRef: "SCP-2609/01", supplier: { name: "PT SINAR" }, jenisTagihan: { label: "Bahan Baku / Stok" }, goodsReceipt: { receiptNumber: "GR-1" } };
  assert.equal(teksKedua(b, "full"), "Bahan Baku / Stok · penerimaan GR-1");
  assert.equal(teksKedua(b, "reduced"), "Ref SCP-2609/01 · Bahan Baku / Stok · penerimaan GR-1");
  assert.equal(teksKedua(b, "minimal"), "PT SINAR · Ref SCP-2609/01 · Bahan Baku / Stok · penerimaan GR-1");
});

test("Kolom di <colgroup> sama dengan kolom yang dirender (urutan & jumlah) di tiap tier", () => {
  for (const t of ["full", "reduced", "minimal"]) {
    const kunci = kolomTagihan(t, AKSI).map(([k]) => k);
    assert.equal(new Set(kunci).size, kunci.length);
    assert.equal(kunci[0], "nomor");
    assert.equal(kunci.at(-1), "aksi");
    assert.ok(kunci.indexOf("nomor") < kunci.indexOf("keterangan"));
    if (kunci.includes("ref")) assert.equal(kunci.indexOf("ref"), kunci.indexOf("nomor") + 1);
  }
});

test("Halaman memakai colgroup + sel berbatas potong dengan title; tanpa TABLE_VIEW_CLASS lama", () => {
  const s = baca("pages/finance/FinanceSuppliers.jsx");
  assert.match(s, /<ColGroup widths=\{lebarKolom\(tier, AKSI_COL_WIDTH\)\}/);
  assert.match(s, /useContainerTier\(tierTagihan\)/);
  assert.match(s, /block min-w-0 truncate overflow-hidden whitespace-nowrap" title=\{b\.billNumber\}/);
  assert.match(s, /block min-w-0 truncate overflow-hidden whitespace-nowrap" title=\{p\.paymentNumber\}/);
  assert.doesNotMatch(s, /TABLE_VIEW_CLASS|CARD_VIEW_CLASS/);
  assert.doesNotMatch(s, /<TH sticky width=\{124\}>/);
});

test("Kolom sticky tetap menyinkronkan latar & hover (CSS tidak diubah)", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles", "tokens.css"), "utf8");
  assert.match(css, /tr:hover \.tbl-sticky-td \{ background: var\(--bg-hover\); \}/);
  assert.match(css, /\.tbl-sticky-td \{ position: sticky; left: 0;[^}]*background: var\(--bg-surface\)/);
});
