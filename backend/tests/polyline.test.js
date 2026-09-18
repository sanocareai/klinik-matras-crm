// Tes decoder Encoded Polyline Algorithm Format (Google).
//
// Kenapa diuji ketat: hasil decoder ini LANGSUNG jadi garis rute yang
// digambar admin di peta Live Tracking (web & app). Salah geser 1 bit saja
// (shift/sign bit) tidak bikin error apa pun — cuma menghasilkan koordinat
// yang meleset jauh, dan kegagalannya baru kelihatan sebagai "garis rutenya
// aneh" di layar, persis gejala yang justru sedang diperbaiki. Referensi
// nilainya diambil dari CONTOH RESMI dokumentasi Google, bukan dari output
// implementasi kita sendiri (kalau pakai output sendiri, tes cuma
// mengabadikan bug yang mungkin sudah ada sejak awal).

import test from "node:test";
import assert from "node:assert/strict";
import { decodePolyline } from "../src/services/maps.js";

test("contoh resmi dokumentasi Google ter-decode persis", () => {
  // developers.google.com/maps/documentation/utilities/polylinealgorithm
  const hasil = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepEqual(hasil, [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
});

test("string kosong menghasilkan daftar kosong, bukan error", () => {
  assert.deepEqual(decodePolyline(""), []);
});

test("satu titik saja tetap ter-decode", () => {
  const satu = decodePolyline("_p~iF~ps|U");
  assert.deepEqual(satu, [[38.5, -120.2]]);
});

test("koordinat Jabodetabek (negatif lintang, positif bujur) bolak-balik konsisten", () => {
  // Encode manual titik Klinik Matras (DEPOT) + 1 titik di Jakarta Selatan,
  // lalu pastikan decode mengembalikan nilai yang sama dalam presisi 5
  // desimal (presisi format ini ~1 meter — cukup untuk garis rute).
  const encoded = encodePolyline([
    [-6.4036521, 106.7839743],
    [-6.2615, 106.781],
  ]);
  const hasil = decodePolyline(encoded);
  assert.equal(hasil.length, 2);
  assert.ok(Math.abs(hasil[0][0] - -6.40365) < 1e-5, `lat depot meleset: ${hasil[0][0]}`);
  assert.ok(Math.abs(hasil[0][1] - 106.78397) < 1e-5, `lng depot meleset: ${hasil[0][1]}`);
  assert.ok(Math.abs(hasil[1][0] - -6.2615) < 1e-5, `lat stop meleset: ${hasil[1][0]}`);
  assert.ok(Math.abs(hasil[1][1] - 106.781) < 1e-5, `lng stop meleset: ${hasil[1][1]}`);
});

// Encoder HANYA untuk tes (produksi cuma perlu decode — Google/LocationIQ
// yang meng-encode). Ditulis dari spesifikasi, bukan turunan dari decoder,
// supaya tes ini benar-benar memeriksa silang, bukan menguji dirinya sendiri.
function encodePolyline(coords) {
  let out = "";
  let prevLat = 0, prevLng = 0;
  for (const [lat, lng] of coords) {
    const e5Lat = Math.round(lat * 1e5);
    const e5Lng = Math.round(lng * 1e5);
    out += encodeNilai(e5Lat - prevLat) + encodeNilai(e5Lng - prevLng);
    prevLat = e5Lat;
    prevLng = e5Lng;
  }
  return out;
}

function encodeNilai(nilai) {
  let v = nilai < 0 ? ~(nilai << 1) : (nilai << 1);
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
}
