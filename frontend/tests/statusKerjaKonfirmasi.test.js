// UX STATUS KERJA JUJUR — "Buka pekerjaan" hanya membuka halaman; "Sudah dikerjakan" manual wajib konfirmasi singkat; tidak ada status "Sedang dikerjakan".
// Model murni diuji langsung; komponen dibaca sebagai teks (tanpa DOM) untuk memastikan jalur yang berbahaya tertutup.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KERJA_PERLU_KONFIRMASI, konfirmasiKerja, labelCatatKerja, sumberKerjaPendek } from "../src/features/production/orderProduksiModel.js";
import { bagianUntukAksi } from "../src/features/production/workspace/workListModel.js";
import { aksiLangkah, teksKonfirmasi } from "../src/features/production/workspace/profilModel.js";

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
  assert.equal(labelCatatKerja("DIKERJAKAN"), "Tandai sudah dikerjakan"); assert.equal(labelCatatKerja("SELESAI"), "Catat pekerjaan selesai");
  assert.equal(labelCatatKerja("TERTUNDA"), "Catat status kerja"); assert.equal(labelCatatKerja("DIJADWALKAN"), "Catat status kerja");
  for (const f of [["features", "production", "workspace", "LangkahBerikutnya.jsx"], ["features", "production", "workspace", "profilModel.js"], ["features", "production", "orderProduksiModel.js"], ["features", "production", "workspace", "RingkasanUnit.jsx"], ["features", "production", "workspace", "StatusWorkList.jsx"]]) {
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

test("OPEN_WORK membuka status kerja di Ringkasan (profil unit); START_WORK (yang dulu langsung mencatat) tidak ada lagi", () => {
  assert.equal(bagianUntukAksi("OPEN_WORK"), "ringkasan"); assert.equal(bagianUntukAksi("START_WORK"), "ringkasan");
  // tombol OPEN_WORK hanya MEMFOKUSKAN segmen status kerja; tampil juga untuk akun hanya-lihat (membuka bukan menulis)
  assert.deepEqual(aksiLangkah({ aksi: "OPEN_WORK", label: "Buka pekerjaan" }, { izin: {} }), { jenis: "fokus", target: "pf-kerja", label: "Buka pekerjaan", sekunder: true });
  assert.equal(aksiLangkah({ aksi: "START_WORK" }, { izin: { statusKerja: true } }), null, "tombol 'Mulai pekerjaan' yang langsung mencatat sudah dihapus");
  const langkah = baca("features", "production", "workspace", "LangkahBerikutnya.jsx");
  assert.ok(langkah.includes('if (aksi.jenis === "fokus") return onFokus(aksi.target);'), "fokus tidak memanggil API tulis");
  assert.ok(baca("features", "production", "workspace", "RingkasanUnit.jsx").includes('<LangkahBerikutnya data={data} aktif={aktif} adaMeja={adaMeja} onDone={onDone} onBagian={onBagian} onFokus={fokus}'), "Ringkasan meneruskan navigasi bagian + fokus");
  assert.ok(baca("features", "production", "workspace", "StatusWorkList.jsx").includes('tindakan.aksi === "OPEN_WORK" ? "Buka pekerjaan"'), "tombol daftar berlabel 'Buka pekerjaan'");
});

test("jalur tulis status kerja manual SELALU lewat konfirmasi dan dijaga klik ganda; tombol tidak langsung menyimpan 'Sudah dikerjakan'/'Selesai'", () => {
  const langkah = baca("features", "production", "workspace", "LangkahBerikutnya.jsx"); const ring = baca("features", "production", "workspace", "RingkasanUnit.jsx");
  // tombol 'Catat pekerjaan selesai' (Berikutnya) hanya membuka konfirmasi; menyimpan hanya dari tombol Ya
  assert.equal(aksiLangkah({ aksi: "FINISH_WORK" }, { izin: { statusKerja: true }, aktif: true, km: { dikunciAplikasi: false } }).jenis, "selesai");
  assert.ok(langkah.includes("setGalat(null); setKonf({ jenis: aksi.jenis, anchor: e.currentTarget });") && langkah.includes("onYa={() => jalankan(konf.jenis)}"));
  assert.deepEqual(teksKonfirmasi("selesai", { unitCode: "U-1" }), konfirmasiKerja("SELESAI", "U-1"), "teks resmi yang sama");
  // segmen status kerja: Sudah dikerjakan/Selesai → konfirmasi (teks resmi); Tertunda → catatan wajib; lainnya langsung
  assert.ok(ring.includes(`if (KERJA_PERLU_KONFIRMASI.includes(key) || KERJA_WAJIB_CATATAN.includes(key)) { setCatatan(""); setKonf({ key, anchor: el }); return; }`));
  assert.ok(ring.includes("const teksResmi = konf ? konfirmasiKerja(konf.key, u.unitCode) : null;") && ring.includes("onYa={() => simpan(konf.key, catatan)}"));
  assert.ok(ring.includes("yaNonaktif={wajibCatatan && catatan.trim().length < 3}"), "Tertunda: Ya mati sampai catatan diisi");
  // klik ganda: satu permintaan pada satu waktu + tombol dinonaktifkan saat sibuk
  assert.ok(langkah.includes("if (kunci.current) return; kunci.current = true;") && ring.includes("if (kunci.current) return; kunci.current = true;"));
  assert.ok(langkah.includes("disabled={sibuk}") && ring.includes("sibuk={sibuk}"));
  // hanya dua tempat yang memanggil API tulis status kerja (tombol Berikutnya + segmen), keduanya membawa expectedLatestId
  assert.equal(langkah.split("postStatusKerjaManual(").length - 1 + ring.split("postStatusKerjaManual(").length - 1, 2);
  assert.ok(langkah.includes("expectedLatestId: km?.terakhirId ?? null") && ring.includes("expectedLatestId: km?.terakhirId ?? null"));
  // unit yang dikerjakan lewat aplikasi Meja: hanya-baca
  assert.ok(ring.includes('if (km?.dikunciAplikasi) return <Baris id="pf-kerja" testid="status-kerja-form" label="Status kerja" sub="Mengikuti aplikasi Meja"'));
});

test("daftar kerja menampilkan sumber status kerja secara terlihat per unit (bukan hanya tooltip)", () => {
  const list = baca("features", "production", "workspace", "StatusWorkList.jsx");
  assert.ok(list.includes('data-testid="unit-sumber-kerja"') && list.includes("sumberKerjaPendek(unit.kerja)"));
});

test("label 'selesai' tidak terkesan menyelesaikan QC/serah Gudang: 'Catat pekerjaan selesai'; konfirmasi menegaskan catatan administratif, bukan QC/Gudang/Siap Kirim", () => {
  assert.equal(labelCatatKerja("SELESAI"), "Catat pekerjaan selesai");
  const k = konfirmasiKerja("SELESAI", "U-9");
  assert.match(k.isi, /catatan administratif/); assert.match(k.isi, /bukan hasil QC/); assert.match(k.isi, /bukan serah ke Gudang/); assert.match(k.isi, /bukan Siap Kirim/);
  assert.equal(aksiLangkah({ aksi: "FINISH_WORK" }, { izin: { statusKerja: true }, aktif: true, km: {} }).label, "Catat pekerjaan selesai");
  for (const f of [["features", "production", "workspace", "LangkahBerikutnya.jsx"], ["features", "production", "workspace", "profilModel.js"], ["features", "production", "workspace", "RingkasanUnit.jsx"]]) {
    const t = baca(...f); assert.ok(!t.includes('"Tandai selesai"') && !t.includes("Tandai pekerjaan Selesai"), "label lama tidak tersisa: " + f.join("/"));
  }
});
