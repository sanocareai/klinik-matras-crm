// Regresi D-XXX (22 Sep 2026) — "kolom Keterangan kolaps ke ~24px" bug.
//
// Root cause diverifikasi lewat pengukuran DOM nyata (getBoundingClientRect
// + getComputedStyle di Puppeteer, bukan cuma scrollWidth/clientWidth):
// Tailwind `line-clamp-2` memaksa `display: -webkit-box` pada elemen yang
// dipasangi. Begitu computed display sebuah `<td>` BUKAN LAGI `table-cell`,
// algoritma `table-layout: fixed` Chrome tidak lagi menganggapnya kolom
// yang sah — kolom itu KOLAPS ke lebar padding saja (24px), membuat kolom
// SEBELAHNYA terlihat "bertumpuk" di atasnya (padahal sebenarnya cuma
// kolom flex yang kolaps, kolom lain tetap di posisi tetapnya).
//
// Fix: `line-clamp-2` HARUS dipasang di elemen PEMBUNGKUS DI DALAM <td>
// (mis. <span>), TIDAK PERNAH langsung di className <td> itu sendiri. Test
// ini memindai source table.jsx untuk mengunci pola yang benar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TABLE_JSX = path.join(__dirname, "..", "src", "components", "ui", "table.jsx");

function bacaSumber() {
  return fs.readFileSync(TABLE_JSX, "utf-8");
}

test("TD clamp2: line-clamp-2 dipasang di <span> pembungkus, TIDAK di className <td> — mencegah display:table-cell rusak", () => {
  const src = bacaSumber();

  // Pola RUSAK yang harus TIDAK PERNAH muncul lagi: "line-clamp" ikut masuk
  // ke daftar class <td> (lewat cn(...) yang jadi className elemen <td>).
  // Cari definisi fungsi TD, ambil badan sampai penutup fungsi berikutnya,
  // lalu cek bagian className (sebelum children di-render) tidak menyebut
  // line-clamp.
  const mulai = src.indexOf("export function TD(");
  assert.ok(mulai !== -1, "Fungsi TD tidak ditemukan di table.jsx — apakah komponennya dipindah/diganti nama? Perbarui test ini kalau memang disengaja.");
  const akhir = src.indexOf("\nexport function", mulai + 1);
  const badanTD = src.slice(mulai, akhir === -1 ? undefined : akhir);

  const bagianClassName = badanTD.slice(0, badanTD.indexOf("title={judul}"));
  assert.ok(
    !bagianClassName.includes("line-clamp"),
    "className <td> (sebelum {children}) tidak boleh menyebut line-clamp — itu memaksa display:-webkit-box pada <td>, merusak table-layout:fixed (lihat komentar di atas test ini). Pindahkan ke <span> pembungkus di dalam <td>."
  );

  // Pola BENAR yang harus ada: children DIBUNGKUS <span line-clamp-2> saat clamp2 aktif.
  assert.ok(
    /clamp2\s*\?\s*<span className="line-clamp-2[^>]*>\{children\}<\/span>/.test(badanTD),
    "Pola yang diharapkan (children dibungkus <span className=\"line-clamp-2...\">) tidak ditemukan — pastikan clamp2 masih membungkus {children} di dalam <td>, bukan menghilangkan fitur 2-baris-nya."
  );
});
