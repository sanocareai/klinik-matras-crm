// Tes parseTanggalKalender() — kolom Prisma @db.Date (pickupConfirmedDate /
// deliveryConfirmedDate di Order). Dijalankan dengan `npm test`.
//
// KENAPA TES INI ADA (bug nyata 21 Agustus 2026, dua tahap):
//
//   Tahap 1 — "YYYY-MM-DD" polos dikirim apa adanya ke Prisma. Prisma menolak
//   ("premature end of input. Expected ISO-8601 DateTime"), error itu tidak
//   ketangkap try/catch mana pun, jadi unhandledRejection, dan Node 15+
//   MEMATIKAN SELURUH PROSES untuk itu. Satu sales salah simpan order =
//   backend mati untuk 7 sales + webhook WhatsApp sampai Docker restart.
//
//   Tahap 2 — setelah `new Date(...)` ditambahkan, aplikasi mobile versi LAMA
//   (yang field tanggalnya masih teks bebas) mengirim "21 agustus 2026".
//   `new Date("21 agustus 2026")` = Invalid Date, lolos sampai Prisma, dan
//   sales cuma melihat dump `prisma.order.create()` mentah di layar HP.
//
// Jadi yang dikunci di sini: (a) format benar → Date yang tepat, (b) format
// salah → Error 400 berbahasa manusia, BUKAN Invalid Date yang diteruskan.

import test from "node:test";
import assert from "node:assert/strict";

import { parseTanggalKalender, startOfDayWIB } from "../src/utils/wib.js";

test("YYYY-MM-DD menghasilkan Date dengan tanggal yang SAMA persis", () => {
  const d = parseTanggalKalender("2026-08-21", "Tanggal Pick Up Pasti");
  assert.equal(d.toISOString().slice(0, 10), "2026-08-21");
});

// Jaring untuk kesalahan yang sangat mudah dilakukan: memakai startOfDayWIB()
// (helper yang benar untuk RENTANG LAPORAN) pada kolom date-only. Untuk
// @db.Date, Prisma memakai bagian tanggal UTC — dan startOfDayWIB menggeser
// ke 17:00 hari SEBELUMNYA, jadi tanggalnya mundur sehari tanpa error apa pun.
test("TIDAK memakai startOfDayWIB — @db.Date butuh UTC midnight, bukan batas WIB", () => {
  const benar = parseTanggalKalender("2026-08-21");
  const salah = startOfDayWIB("2026-08-21");

  assert.equal(benar.toISOString().slice(0, 10), "2026-08-21");
  assert.equal(salah.toISOString().slice(0, 10), "2026-08-20", "startOfDayWIB memang mundur sehari di UTC");
  assert.notEqual(benar.getTime(), salah.getTime());
});

test("ISO penuh diterima — klien lama mengirim hasil toISOString() saat edit order", () => {
  const d = parseTanggalKalender("2026-08-21T00:00:00.000Z");
  assert.equal(d.toISOString().slice(0, 10), "2026-08-21");
});

test("kosong/null/undefined jadi null — artinya 'kosongkan field ini', bukan error", () => {
  for (const kosong of ["", null, undefined]) {
    assert.equal(parseTanggalKalender(kosong), null);
  }
});

test("teks bebas dari aplikasi versi lama ditolak 400, TIDAK diteruskan sbg Invalid Date", () => {
  for (const teks of ["21 agustus 2026", "Invalid Date", "21/08/2026", "besok"]) {
    assert.throws(
      () => parseTanggalKalender(teks, "Tanggal Pick Up Pasti"),
      (err) => {
        assert.equal(err.statusCode, 400, "harus 400 (salah input user), bukan 500");
        assert.match(err.message, /Tanggal Pick Up Pasti/, "pesan menyebut nama field yang salah");
        assert.match(err.message, /YYYY-MM-DD/, "pesan memberi tahu format yang benar");
        return true;
      },
      `"${teks}" seharusnya ditolak`
    );
  }
});

// Date "menggulung" tanggal mustahil ke bulan berikutnya tanpa melempar error
// (new Date("2026-02-31") = 3 Maret). Tanpa cek ini, sales yang salah ketik
// diam-diam mendapat tanggal yang BUKAN yang dia ketik.
test("tanggal berformat benar tapi mustahil ditolak, bukan digulung diam-diam", () => {
  for (const teks of ["2026-02-31", "2026-13-01", "2026-00-10"]) {
    assert.throws(
      () => parseTanggalKalender(teks),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /tidak ada di kalender/);
        return true;
      },
      `"${teks}" seharusnya ditolak`
    );
  }
});

test("tahun kabisat asli tetap diterima", () => {
  assert.equal(parseTanggalKalender("2028-02-29").toISOString().slice(0, 10), "2028-02-29");
});
