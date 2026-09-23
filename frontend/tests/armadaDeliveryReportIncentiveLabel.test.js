// Audit insentif driver (23 September 2026) — frontend TIDAK punya harness
// render komponen React untuk halaman ini (lihat pola sama di
// driver-mobile/src/screens/performaEstimasiLabel.test.js). Jaring regresi
// murah lewat teks sumber JSX: label "Estimasi Insentif" wajib ada, dan
// setiap penyebutan "sudah dibayar"/"akan dibayar" wajib berupa negasi
// (disclaimer), bukan klaim status pembayaran — sistem ini tidak melacak
// pembayaran sama sekali.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(__dirname, "../src/pages/armada/ArmadaDeliveryReport.jsx"),
  "utf8"
);

function pastikanTidakKlaimPembayaran(text, sumberLabel) {
  const re = /sudah dibayar|akan dibayar/gi;
  let m;
  let ditemukan = 0;
  while ((m = re.exec(text))) {
    ditemukan++;
    // Jendela cukup lebar untuk komentar JSX yang membungkus "bukan" ke
    // baris terpisah (indentasi + line break bisa >25 char), lalu spasi
    // beruntun/newline diratakan supaya jaraknya tidak menipu pengecekan.
    const sebelum = text.slice(Math.max(0, m.index - 60), m.index).replace(/\s+/g, " ");
    assert.match(
      sebelum,
      /bukan/i,
      `${sumberLabel}: frasa "${m[0]}" @${m.index} tidak didahului kata negasi "bukan" dalam 60 char — sistem ini tidak melacak pembayaran sama sekali. Konteks: ...${sebelum}[${m[0]}]`
    );
  }
  return ditemukan;
}

test("ArmadaDeliveryReport menampilkan label Estimasi Insentif, bukan klaim sudah/akan dibayar", () => {
  assert.match(src, /Estimasi Insentif Driver/, "judul harus 'Estimasi Insentif...', bukan 'Insentif...' polos");
  assert.match(src, /<TH numeric>Estimasi Insentif<\/TH>/, "header kolom tabel harus 'Estimasi Insentif'");
  assert.match(src, /bisa berubah/i, "harus ada catatan bahwa angka bisa berubah");
  const jumlah = pastikanTidakKlaimPembayaran(src, "ArmadaDeliveryReport.jsx");
  assert.ok(jumlah > 0, "disclaimer yang menyebut 'sudah/akan dibayar' (untuk menyangkalnya) harus ada di file ini");
});
