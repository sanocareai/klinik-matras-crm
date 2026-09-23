// Audit insentif driver (23 September 2026) — driver-mobile TIDAK punya
// harness render komponen (nol @testing-library/react-native di repo ini,
// dicek sebelum menulis file ini). Test ini SENGAJA bukan pengganti test
// render sungguhan — cuma jaring regresi murah: memastikan label
// "Estimasi Insentif" (wajib, bukan "sudah/akan dibayar") benar-benar ada
// di JSX yang dikirim ke device, bukan cuma ditulis lalu terhapus lagi
// tanpa sadar di refactor berikutnya. Kalau nanti ada harness render
// sungguhan, test ini sebaiknya diganti, bukan ditambah di sebelahnya.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Setiap kemunculan "sudah dibayar"/"akan dibayar" HARUS didahului kata
// negasi ("bukan"/"BUKAN") dalam jarak dekat — baik itu di teks JSX
// (disclaimer, pola "bukan status sudah/akan dibayar") maupun di komentar
// kode (pola lain, mis. `BUKAN status "sudah dibayar"`). Kalau tidak
// didahului negasi, itu klaim POSITIF status pembayaran yang dilarang.
function pastikanTidakKlaimPembayaran(src, sumberLabel) {
  const re = /sudah dibayar|akan dibayar/gi;
  let m;
  let ditemukan = 0;
  while ((m = re.exec(src))) {
    ditemukan++;
    const sebelum = src.slice(Math.max(0, m.index - 25), m.index);
    assert.match(
      sebelum,
      /bukan/i,
      `${sumberLabel}: frasa "${m[0]}" @${m.index} tidak didahului kata negasi "bukan" dalam 25 char — sistem ini tidak melacak pembayaran sama sekali, dilarang mengklaim status pembayaran. Konteks: ...${sebelum}[${m[0]}]`
    );
  }
  return ditemukan;
}

test("PerformaScreen (driver) menampilkan label Estimasi Insentif, bukan klaim sudah/akan dibayar", () => {
  const src = readFileSync(join(__dirname, "PerformaScreen.js"), "utf8");
  assert.match(src, />Estimasi Insentif</, "label 'Estimasi Insentif' harus ada sebagai teks JSX, bukan cuma komentar");
  assert.match(src, /bisa berubah/i, "harus ada catatan bahwa angka bisa berubah");
  const jumlah = pastikanTidakKlaimPembayaran(src, "PerformaScreen.js");
  assert.ok(jumlah > 0, "disclaimer yang menyebut 'sudah/akan dibayar' (untuk menyangkalnya) harus ada di file ini");
});

test("AdminHomeScreen (tab Performa) menampilkan label Estimasi Insentif, bukan klaim sudah/akan dibayar", () => {
  const src = readFileSync(join(__dirname, "AdminHomeScreen.js"), "utf8");
  // File ini besar (banyak fitur admin lain, termasuk verifikasi
  // pembayaran cash yang WAJAR menyebut "sudah dibayar" di konteks
  // LAIN) — persempit ke isi function PerformaView saja supaya tidak
  // salah tangkap frasa dari bagian tampilan lain yang tidak terkait.
  const mulai = src.indexOf("function PerformaView(");
  const akhir = src.indexOf("\nfunction makeStyles(", mulai);
  assert.ok(mulai !== -1 && akhir !== -1, "function PerformaView tidak ditemukan — cek nama fungsi berubah?");
  const performaSrc = src.slice(mulai, akhir);
  assert.match(performaSrc, /Estimasi Insentif/, "label 'Estimasi Insentif' harus ada di tampilan admin");
  assert.match(performaSrc, /bisa berubah/i, "harus ada catatan bahwa angka bisa berubah");
  const jumlah = pastikanTidakKlaimPembayaran(performaSrc, "AdminHomeScreen.js > PerformaView");
  assert.ok(jumlah > 0, "disclaimer yang menyebut 'sudah/akan dibayar' (untuk menyangkalnya) harus ada di tab Performa");
});
