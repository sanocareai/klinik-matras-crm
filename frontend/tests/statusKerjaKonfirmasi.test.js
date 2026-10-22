// UX STATUS KERJA JUJUR — "Buka pekerjaan" hanya membuka halaman; "Sudah dikerjakan" manual wajib konfirmasi singkat; tidak ada status "Sedang dikerjakan".
// Model murni diuji langsung; komponen dibaca sebagai teks (tanpa DOM) untuk memastikan jalur yang berbahaya tertutup.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KERJA_PERLU_KONFIRMASI, konfirmasiKerja, labelCatatKerja, sumberKerjaPendek } from "../src/features/production/orderProduksiModel.js";
import { bagianUntukAksi } from "../src/features/production/workspace/workListModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const baca = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8").split("\r\n").join("\n");

test("konfirmasi hanya untuk status yang MENYATAKAN pekerjaan sudah dilakukan (Sudah dikerjakan, Selesai); Dijadwalkan/Tertunda/Belum dijadwalkan langsung", () => {
  assert.deepEqual([...KERJA_PERLU_KONFIRMASI], ["DIKERJAKAN", "SELESAI"]);
  for (const s of ["BELUM_DIJADWALKAN", "DIJADWALKAN", "TERTUNDA", "MENUNGGU_QC", undefined]) assert.equal(konfirmasiKerja(s, "U-1"), null, String(s));
});

test("teks konfirmasi 'Sudah dikerjakan': menyatakan pekerjaan memang sudah dilakukan dan menyebut yang TIDAK dibuat (stok, Run, QC, jurnal); tombol ya eksplisit", () => {
  const k = konfirmasiKerja("DIKERJAKAN", "SKJ-1-U1");
  assert.match(k.judul, /unit SKJ-1-U1 memang sudah dilakukan\?/);
  for (const kata of ["stok", "Production Run", "QC", "jurnal", "catatan administratif"]) assert.ok(k.isi.includes(kata), kata);
  assert.match(k.isi, /Sudah dikerjakan/); assert.equal(k.ya, "Ya, sudah dikerjakan"); assert.match(k.sukses, /Dicatat manual/);
  const s = konfirmasiKerja("SELESAI", "U-2");
  assert.match(s.judul, /memang sudah selesai\?/); assert.match(s.isi, /bukan hasil QC/); assert.match(s.isi, /bukan Siap Kirim/); assert.equal(s.ya, "Ya, sudah selesai");
});

test("label tombol manual menyebut pernyataannya; tidak ada status antara 'Sedang dikerjakan' di mana pun di UI Produksi", () => {
  assert.equal(labelCatatKerja("DIKERJAKAN"), "Tandai sudah dikerjakan"); assert.equal(labelCatatKerja("SELESAI"), "Tandai selesai");
  assert.equal(labelCatatKerja("TERTUNDA"), "Catat status kerja"); assert.equal(labelCatatKerja("DIJADWALKAN"), "Catat status kerja");
  for (const f of [["features", "production", "OrderProduksiPanel.jsx"], ["features", "production", "orderProduksiModel.js"], ["features", "production", "workspace", "RingkasanUnit.jsx"], ["features", "production", "workspace", "StatusWorkList.jsx"]]) {
    assert.ok(!/Sedang dikerjakan/i.test(baca(...f)), f.join("/"));
  }
});

test("sumber status kerja = kosakata server (sama dengan Excel); jadwal biasa dan status dibatalkan tidak ditampilkan sebagai sumber", () => {
  assert.equal(sumberKerjaPendek({ key: "DIKERJAKAN", source: "PEMAKAIAN_BAHAN", sourceLabel: "Otomatis dari pemakaian bahan" }), "Otomatis dari pemakaian bahan");
  assert.equal(sumberKerjaPendek({ key: "DIKERJAKAN", source: "MANUAL", sourceLabel: "Dicatat manual" }), "Dicatat manual");
  assert.equal(sumberKerjaPendek({ key: "DIKERJAKAN", source: "APLIKASI", sourceLabel: "Dari aplikasi Produksi" }), "Dari aplikasi Produksi");
  assert.equal(sumberKerjaPendek({ key: "DIJADWALKAN", source: "JADWAL", sourceLabel: "Dari jadwal" }), null);
  assert.equal(sumberKerjaPendek({ key: "DIBATALKAN", source: "STATUS_ORDER", sourceLabel: "Mengikuti status order" }), null);
  assert.equal(sumberKerjaPendek(null), null);
});

test("OPEN_WORK membuka bagian Pekerjaan; START_WORK (yang dulu langsung mencatat) tidak ada lagi", () => {
  assert.equal(bagianUntukAksi("OPEN_WORK"), "pekerjaan"); assert.equal(bagianUntukAksi("START_WORK"), "ringkasan");
  const panel = baca("features", "production", "OrderProduksiPanel.jsx");
  assert.ok(!panel.includes('case "START_WORK"'), "tombol 'Mulai pekerjaan' yang langsung mencatat sudah dihapus");
  const buka = panel.slice(panel.indexOf('case "OPEN_WORK"'), panel.indexOf('case "FINISH_WORK"'));
  assert.ok(buka.includes('onBagian("pekerjaan")') && buka.includes('ke("sec-status")'), "membuka bagian Pekerjaan (atau menggulir ke Status & target)");
  assert.ok(!/catat\(|postStatusKerjaManual/.test(buka), "membuka halaman tidak memanggil API tulis");
  assert.ok(baca("features", "production", "workspace", "RingkasanUnit.jsx").includes("onBukaUnit360={() => {}} onBagian={onBagian}"), "Ringkasan meneruskan navigasi bagian");
  assert.ok(baca("features", "production", "workspace", "StatusWorkList.jsx").includes('tindakan.aksi === "OPEN_WORK" ? "Buka pekerjaan"'), "tombol daftar berlabel 'Buka pekerjaan'");
});

test("jalur tulis status kerja manual SELALU lewat konfirmasi dan dijaga klik ganda; tombol tidak langsung menyimpan 'Sudah dikerjakan'/'Selesai'", () => {
  const panel = baca("features", "production", "OrderProduksiPanel.jsx");
  // tombol 'Tandai selesai' (tindakan utama) hanya membuka konfirmasi
  assert.ok(panel.includes('{ label: "Tandai selesai", onClick: () => setKonfKerja("SELESAI") }'));
  assert.ok(panel.includes("onYa={() => catat(konfKerja)}"), "catat() hanya dipanggil dari tombol 'Ya' konfirmasi");
  // bagian Pekerjaan: pilihan Sudah dikerjakan/Selesai → konfirmasi; lainnya langsung
  assert.ok(panel.includes("onClick={() => (perluKonf ? setKonf(true) : simpanKerja())}"));
  assert.ok(panel.includes("onYa={simpanKerja}"));
  assert.ok(panel.includes("const perluKonf = KERJA_PERLU_KONFIRMASI.includes(kerja);"));
  // klik ganda: satu permintaan pada satu waktu + tombol dinonaktifkan saat sibuk
  assert.ok(panel.includes("if (catatRef.current) return; catatRef.current = true;"));
  assert.ok(panel.includes("if (simpanRef.current) return; simpanRef.current = true;"));
  assert.ok(panel.includes('disabled={sibuk}') && panel.includes("disabled={!!sibuk || konf ||"));
  // HP: konfirmasi digulirkan ke tengah layar agar tidak tertutup banner/toolbar bawah
  assert.ok(panel.includes("el.scrollIntoView({ block: \"center\"") && panel.includes("scroll-mb-24"));
  // hanya dua tempat yang memanggil API tulis status kerja
  assert.equal((panel.match(/postStatusKerjaManual\(/g) || []).length, 2);
  // pernyataan eksplisit di bagian Pekerjaan
  assert.ok(panel.includes("Pilih “Sudah dikerjakan” hanya bila pekerjaannya memang sudah dilakukan (boleh tanpa bahan baru)"));
  // tindakan OPEN_WORK terlihat juga oleh akun hanya-lihat (membuka bukan menulis)
  assert.ok(!/case "OPEN_WORK": tombol = izin\./.test(panel));
});

test("daftar kerja menampilkan sumber status kerja secara terlihat per unit (bukan hanya tooltip)", () => {
  const list = baca("features", "production", "workspace", "StatusWorkList.jsx");
  assert.ok(list.includes('data-testid="unit-sumber-kerja"') && list.includes("sumberKerjaPendek(unit.kerja)"));
});
