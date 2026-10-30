// Redesain Stok & Lokasi (Okt 2026): logika tampilan murni + kontrak pemasangan. Aturan yang dikunci: stok belum diketahui ≠ 0; tiga "nol" berbeda; harga belum ada ≠ Rp0 dan tanpa izin = tanpa kolom;
// satu status singkat per baris; saringan aktif → chip; layanan/URL/izin tidak berubah (tidak ada panggilan API baru, parameter URL sama).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { statusRingkas, teksTersedia, hargaBaris, halamanDaftar, saringanAktif, ringkasanAtas } from "../src/features/warehouse/stok/stokTampilanLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (...p) => fs.readFileSync(path.join(dir, "..", "src", ...p), "utf8").replace(/\r\n/g, "\n");

test("status singkat: belum diketahui, nol menurut pergerakan, nol terverifikasi, minus, terpesan penuh, menipis, ada stok, nonaktif — masing-masing berbeda; merah/amber hanya untuk yang perlu perhatian", () => {
  const s = (o) => statusRingkas({ aktif: true, saldo: 5, ...o });
  assert.deepEqual([s({ keadaan: "BELUM_ADA_CATATAN", saldo: null }).kode, s({ keadaan: "BELUM_ADA_CATATAN", saldo: null }).nada], ["BELUM_DIKETAHUI", "neutral"]);
  assert.equal(s({ keadaan: "NOL_TERHITUNG", saldo: 0 }).kode, "NOL_PERGERAKAN");
  assert.equal(s({ keadaan: "NOL_TERHITUNG", saldo: 0, keadaanSaldo: "NOL_TERVERIFIKASI" }).kode, "NOL_TERVERIFIKASI");
  assert.deepEqual([s({ keadaan: "MINUS", saldo: -2 }).kode, s({ keadaan: "MINUS", saldo: -2 }).nada], ["MINUS", "red"]);
  assert.equal(s({ keadaan: "TERPESAN_PENUH" }).nada, "orange"); assert.equal(s({ keadaan: "MENIPIS" }).nada, "orange");
  assert.deepEqual([s({ keadaan: "ADA" }).kode, s({ keadaan: "ADA" }).nada], ["ADA", "green"]);
  assert.equal(statusRingkas({ aktif: false, saldo: 1, keadaan: "NONAKTIF" }).kode, "NONAKTIF");
  assert.equal(new Set([s({ keadaan: "BELUM_ADA_CATATAN", saldo: null }).kode, s({ keadaan: "NOL_TERHITUNG", saldo: 0 }).kode, s({ keadaan: "NOL_TERHITUNG", saldo: 0, keadaanSaldo: "NOL_TERVERIFIKASI" }).kode]).size, 3);
  assert.equal(statusRingkas({ aktif: true, saldo: null }).kode, "BELUM_DIKETAHUI", "saldo null selalu belum diketahui, apa pun label keadaan");
});

test("Tersedia: 'belum diketahui' (bukan 0) untuk saldo null; minus ditandai; angka dari server; fallback ke saldo bila tersedia null", () => {
  assert.deepEqual([teksTersedia({ saldo: null, tersedia: null }).teks, teksTersedia({ saldo: null, tersedia: null }).angka], ["belum diketahui", null]);
  assert.equal(teksTersedia({ saldo: 0, tersedia: 0 }).teks, "0"); assert.equal(teksTersedia({ saldo: 0, tersedia: 0 }).angka, 0);
  assert.equal(teksTersedia({ saldo: -2, tersedia: -2 }).minus, true); assert.equal(teksTersedia({ saldo: 1234.5, tersedia: 1200 }).teks, "1.200");
  assert.equal(teksTersedia({ saldo: 7, tersedia: null }).angka, 7);
});

test("harga baris: tanpa data (tanpa izin) = null → kolom tidak ada; bahan tanpa harga = 'Belum ada harga berlaku' (bukan Rp0); ada harga = per satuan stok", () => {
  assert.equal(hargaBaris(null, "a"), null);
  const peta = { harga: { a: { harga: 36000, satuan: "KG", teksLabelBukti: "Belum didukung bukti", labelBukti: "BELUM_DIDUKUNG_BUKTI", terjadwal: null } } };
  const ada = hargaBaris(peta, "a"); assert.deepEqual([ada.ada, ada.harga, ada.satuan], [true, 36000, "kg"]);
  const tanpa = hargaBaris(peta, "b"); assert.equal(tanpa.ada, false); assert.equal(tanpa.teks, "Belum ada harga berlaku"); assert.doesNotMatch(tanpa.teks, /Rp\s?0/);
});

test("halaman daftar: 25 per halaman, rentang jujur, halaman dijepit ke rentang sah, daftar kosong aman", () => {
  const rows = Array.from({ length: 55 }, (_, i) => ({ materialId: String(i) }));
  const a = halamanDaftar(rows, 1, 25); assert.deepEqual([a.baris.length, a.dari, a.sampai, a.jumlahHalaman, a.total], [25, 1, 25, 3, 55]);
  const c = halamanDaftar(rows, 3, 25); assert.deepEqual([c.baris.length, c.dari, c.sampai], [5, 51, 55]);
  assert.equal(halamanDaftar(rows, 99, 25).halaman, 3); assert.equal(halamanDaftar(rows, -4, 25).halaman, 1); assert.equal(halamanDaftar(rows, "abc", 25).halaman, 1);
  const k = halamanDaftar([], 1, 25); assert.deepEqual([k.baris.length, k.dari, k.sampai, k.jumlahHalaman], [0, 0, 0, 1]);
});

test("saringan aktif → chip dengan kunci URL yang sama dengan sebelumnya; kelompok dan kata kunci tidak jadi chip", () => {
  const label = { keadaan: (k) => `K:${k}`, harga: (k) => `H:${k}`, lain: (k) => `L:${k}`, jenis: (k) => `J:${k}` };
  assert.deepEqual(saringanAktif({}, label), []);
  const c = saringanAktif({ keadaan: "MINUS", harga: "BELUM", lain: "VENDOR_KOSONG", satuan: "KG", jenis: "RAW_MATERIAL", nonaktif: true }, label);
  assert.deepEqual(c.map((x) => x.kunci), ["keadaan", "harga", "lain", "satuan", "jenis", "nonaktif"]);
  assert.equal(c.find((x) => x.kunci === "satuan").teks, "Satuan KG"); assert.ok(c.every((x) => /^Hapus saringan/.test(x.aria)));
});

test("ringkasan atas: angka dari ringkasan server + hitungan opsi; harga hanya bila berizin", () => {
  const r = { aktif: 55, ada: 50, nonaktif: 1, minus: 1, belumAdaCatatan: 2 };
  assert.deepEqual(ringkasanAtas(r, { harga: { BELUM: 14 } }, true), { aktif: 55, adaStok: 50, nonaktif: 1, minus: 1, belumDiketahui: 2, hargaBelum: 14 });
  assert.equal(ringkasanAtas(r, { harga: { BELUM: 14 } }, false).hargaBelum, null); assert.equal(ringkasanAtas(null, null, true), null);
});

test("pemasangan halaman: layanan dan parameter URL TIDAK berubah; daftar langsung terlihat; filter lanjutan di panel; chip; tanpa API baru", () => {
  const p = baca("pages", "warehouse", "WarehouseInventory.jsx");
  assert.match(p, /const KUNCI = \["kelompok", "jenis", "q", "keadaan", "nonaktif", "semua", "harga", "lain", "satuan"\]/);
  for (const a of ["api.getStokLokasi()", "api.getStock()", "api.getRingkasanDaftarHargaBerlaku()"]) assert.ok(p.includes(a), a);
  const panggilan = [...p.matchAll(/api\.([A-Za-z]+)\(/g)].map((m) => m[1]); assert.deepEqual([...new Set(panggilan)].sort(), ["getRingkasanDaftarHargaBerlaku", "getStock", "getStokLokasi"], "tidak ada layanan baru");
  assert.ok(!/daftarTampil\(/.test(p), "daftar tidak lagi menunggu pemilihan kelompok");
  for (const k of ["<PanelSaringan", "<DaftarBahan", "<KelompokBahanNav", 'data-testid="chip-saringan"', 'data-testid="cari-bahan"', "halamanDaftar(", "saringStok("]) assert.ok(p.includes(k), k);
  assert.ok(!/\b(harga|hargaF)\b[^;\n]*=\s*0\b/.test(p.replace(/^\s*\/\/.*$/gm, "")), "tanpa fallback harga ke 0");
});

test("kontrol: tombol ≥44px di HP, tombol Filter keyboard (aria-expanded/Esc), baris daftar = tombol sungguhan, chip bisa dihapus", () => {
  const f = baca("features", "warehouse", "stok", "PanelSaringan.jsx");
  for (const k of ["aria-expanded={buka}", "aria-controls={id}", 'e.key === "Escape"', "tombol.current?.focus()", "max-sm:fixed", "max-sm:rounded-t-3xl", "h-11", 'data-testid="selesai-saringan"', 'data-testid="atur-ulang-saringan"']) assert.ok(f.includes(k), k);
  const d = baca("features", "warehouse", "stok", "DaftarBahan.jsx");
  for (const k of ['type="button"', "aria-label={`Buka detail ${r.nama}`}", "max-sm:min-h-11", 'data-testid="baris-stok"', "teksTersedia(", "statusRingkas(", "hargaBaris(", 'aria-label="Halaman sebelumnya"', "h-11 w-11"]) assert.ok(d.includes(k), k);
  assert.ok(!/<table|<TableWrap/i.test(d), "tidak ada tabel lebar yang memaksa gulir horizontal");
  const n = baca("features", "warehouse", "stok", "KelompokBahanNav.jsx"); assert.match(n, /aria-pressed/); assert.match(n, /overflow-x-auto/); assert.match(n, /sm:flex-wrap/);
});

test("drawer: nama/stok/harga jadi fokus; Koreksi saldo dan Ubah harga dipertahankan; lembar bawah di HP; tidak menyentuh CSS global", () => {
  const d = baca("features", "warehouse", "components", "ItemDetailDrawer.jsx");
  for (const k of ['data-testid="drawer-nama"', 'data-testid="header-harga"', "<KoreksiSaldoPanel", "<HargaBerlakuPanel", "max-sm:h-[92dvh]", "max-sm:rounded-t-3xl", "max-sm:slide-in-from-bottom", "max-sm:h-11 max-sm:w-11", "tampilHargaDaftar(hargaPeta, materialId)"]) assert.ok(d.includes(k), k);
  assert.match(d, /Belum diketahui|teksAngkaStok\(item\.available, keadaan,/);
  const kp = baca("features", "warehouse", "stok", "KoreksiSaldoPanel.jsx"); assert.match(kp, /d\.izin\.bolehMengajukan &&/); assert.match(kp, /disabled=\{!!aktif\}/);
  const hp = baca("features", "warehouse", "stok", "HargaBerlakuPanel.jsx"); assert.match(hp, /d\.bolehUbah && <Button/);
  const pe = (name) => baca("features", "warehouse", "stok", name); assert.ok(pe("IkonBahan.jsx").includes("IKON_KELOMPOK[kode]") && /fotoUrl/.test(pe("IkonBahan.jsx")), "foto bila ada (thumbnail server), ikon kelompok sebagai cadangan");
});

test("ringkasHasil menghitung SELURUH hasil saringan (bukan 25 baris halaman) dan membedakan minus / belum diketahui / nol terverifikasi / nol menurut pergerakan", async () => {
  const { ringkasHasil, halamanDaftar } = await import("../src/features/warehouse/stok/stokTampilanLogic.js");
  const baris = (i, o) => ({ materialId: `m${i}`, aktif: true, saldo: 5, keadaan: "ADA", ...o });
  const rows = [
    ...Array.from({ length: 40 }, (_, i) => baris(i)),
    baris(40, { keadaan: "MINUS", saldo: -1 }), baris(41, { keadaan: "BELUM_ADA_CATATAN", saldo: null }), baris(42, { keadaan: "BELUM_ADA_CATATAN", saldo: null }),
    baris(43, { keadaan: "NOL_TERHITUNG", saldo: 0, keadaanSaldo: "NOL_TERVERIFIKASI" }), baris(44, { keadaan: "NOL_TERHITUNG", saldo: 0 }),
  ];
  const peta = { harga: { m0: { harga: 100, satuan: "KG" }, m1: { harga: null, satuan: "KG", terjadwal: { harga: 5 } } } };
  const h = ringkasHasil(rows, peta);
  assert.deepEqual([h.total, h.minus, h.belumDiketahui, h.nolTerverifikasi, h.nolPergerakan], [45, 1, 2, 1, 1]);
  assert.equal(h.hargaBelum, 44, "hanya m0 yang punya harga berlaku; harga terjadwal / kosong dihitung belum ada (bukan Rp0)");
  assert.equal(ringkasHasil(rows, null).hargaBelum, null, "tanpa izin harga: tidak ada hitungan harga");
  // baris-baris langka berada di halaman ke-2 (indeks ≥ 25): tetap terhitung karena rincian memakai seluruh daftar
  assert.equal(halamanDaftar(rows, 1, 25).baris.some((r) => r.keadaan === "MINUS"), false);
  assert.equal(h.minus, 1);
  assert.deepEqual([h.total, halamanDaftar(rows, 2, 25).total], [45, 45], "jumlah total sama di setiap halaman");
});

test("kontras teks sekunder: kelas milik layar (bukan token global); terang dan gelap memenuhi AA; dipakai pada kode, satuan, judul kolom, placeholder, harga belum diisi", () => {
  const css = baca("features", "warehouse", "stok", "kontras.css");
  assert.match(css, /\.stok-t2 \{ color: rgba\(29, 29, 31, 0\.74\)/); assert.match(css, /\[data-theme="dark"\] \.stok-t2/); assert.match(css, /\.stok-ph::placeholder/);
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const campur = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));
  const rasio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const T = [29, 29, 31], P = [245, 245, 247];
  assert.ok(rasio(campur(T, 0.74, [255, 255, 255]), [255, 255, 255]) >= 4.5, "terang: teks sekunder di atas putih");
  assert.ok(rasio(campur(T, 0.74, [245, 245, 247]), [245, 245, 247]) >= 4.5, "terang: di atas inset");
  assert.ok(rasio(campur(T, 0.64, [255, 255, 255]), [255, 255, 255]) >= 4.5, "terang: placeholder");
  assert.ok(rasio(campur(P, 0.74, [28, 28, 30]), [28, 28, 30]) >= 4.5 && rasio(campur(P, 0.74, [44, 44, 46]), [44, 44, 46]) >= 4.5, "gelap: teks sekunder di atas surface dan inset");
  assert.ok(rasio(campur(P, 0.66, [28, 28, 30]), [28, 28, 30]) >= 4.5, "gelap: placeholder");
  assert.ok(rasio(campur(T, 0.4, [255, 255, 255]), [255, 255, 255]) < 4.5, "token tersier lama memang di bawah AA (alasan perubahan)");
  const d = baca("features", "warehouse", "stok", "DaftarBahan.jsx");
  for (const k of ['data-testid="kode-bahan"', 'data-testid="kepala-kolom"']) assert.ok(new RegExp(`stok-t2[^\n]*${k}|${k}[^\n]*stok-t2|stok-t2[^\n]*\n[^\n]*${k}`).test(d) || d.split("\n").some((l) => l.includes(k) && l.includes("stok-t2")), k);
  assert.ok(!/text-ink3/.test(d) && !/text-ink3/.test(baca("pages", "warehouse", "WarehouseInventory.jsx")), "tidak ada teks sekunder pucat tersisa di daftar dan halaman");
  assert.match(baca("pages", "warehouse", "WarehouseInventory.jsx"), /stok-ph/); assert.match(baca("features", "warehouse", "stok", "HargaBerlakuPanel.jsx"), /italic[^"]*stok-t2|stok-t2[^"]*italic|belum-ada-harga/);
});
