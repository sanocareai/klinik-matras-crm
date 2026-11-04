// Pengecualian terkendali "Tetap catat meskipun stok tidak cukup" + skema SATUAN PAKAI (LIST WIBING: stok ROLL, pakai METER, 1 ROLL = 90 METER).
// Model murni + pengawatan UI (statis). Bukti perilaku server ada di backend/tests/integration/pemakaianHistorisStokMinus.integration.test.js (DB uji sungguhan).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aturanBaris, barisAktualDariKatalog, bolehKonfirmasiAktual, hppBaris, keadaanSaldo, qtyStokDariIsian, satuanIsianBaris, teksKonversiBaris, terlaluKecilBaris } from "../src/features/production/bahan/bahanModel.js";
import { PESAN, barisDampak, bolehKonfirmasi, infoPengecualian, sidikIsian, tubuhPembetulan, validasiPembetulan, validasiPengecualian } from "../src/features/production/bahan/pembetulanModel.js";

const src = (p) => readFileSync(new URL(`../src/features/production/${p}`, import.meta.url), "utf8");
const ATURAN = { satuanStok: "ROLL", satuanPakai: "METER", faktor: 90, teks: "1 ROLL = 90 METER", sumber: "KEPUTUSAN_OWNER_2026_11_04" };
const LIST = { materialId: "m1", kode: "LIST-WIBING-COKLAT", nama: "LIST WIBING COKLAT", satuan: "ROLL", tersedia: -106.5, saldoDiketahui: true, harga: { harga: 94350 }, satuanPakai: ATURAN };

test("satuan pakai: katalog membawa aturan; baris awal METER; 20 METER = 0,2222 ROLL; ROLL langsung tanpa konversi; bahan tanpa aturan tidak berubah", () => {
  const b = barisAktualDariKatalog({ ...LIST, kelompok: { kode: "LAINNYA", label: "Lainnya" } });
  assert.equal(satuanIsianBaris(b), "METER"); assert.equal(aturanBaris(b).faktor, 90);
  assert.equal(qtyStokDariIsian({ ...b, qty: "20" }, "20"), 0.2222); assert.equal(qtyStokDariIsian(b, "3,4"), 0.0378);
  assert.match(teksKonversiBaris(b, "20"), /20 METER ÷ 90 = 0,2222 ROLL/);
  const roll = { ...b, satuanInput: "ROLL" }; assert.equal(qtyStokDariIsian(roll, "2"), 2); assert.equal(teksKonversiBaris(roll, "2"), null);
  const biasa = { materialId: "k", satuan: "METER", tersedia: 10, saldoDiketahui: true, harga: { harga: 100 } }; assert.equal(aturanBaris(biasa), null); assert.equal(qtyStokDariIsian(biasa, "3"), 3); assert.equal(satuanIsianBaris(biasa), "METER");
  assert.equal(terlaluKecilBaris(b, "0,001"), true); assert.equal(terlaluKecilBaris(b, "0,009"), false);
});

test("satuan pakai: saldo (ROLL) dibandingkan dengan jumlah STOK, bukan meter; HPP = jumlah stok × harga per ROLL; harga per METER hanya penjelasan", () => {
  const b = { ...barisAktualDariKatalog({ ...LIST, tersedia: 10, kelompok: null }), qty: "90" }; // 90 METER = 1 ROLL
  const ks = keadaanSaldo(b, "90"); assert.equal(ks.status, "cukup"); assert.match(ks.sisaTeks, /9 ROLL/);
  assert.equal(keadaanSaldo({ ...b, qty: "900" }, "900").status, "cukup"); assert.equal(keadaanSaldo({ ...b, qty: "901" }, "901").status, "kurang");
  const h = hppBaris(b, "45"); assert.equal(h.subtotal, 47175, "45 METER = 0,5 ROLL × Rp94.350"); assert.equal(h.harga, 94350); assert.equal(Math.round(h.hargaPakai.harga * 100) / 100, 1048.33); assert.equal(h.hargaPakai.satuan, "METER");
  assert.equal(bolehKonfirmasiAktual([{ ...b, qty: "0,001" }]).ok, false, "terlalu kecil ditolak di layar (server juga menolak)");
});

test("pengecualian: pratinjau 'tidak bisa dikecualikan' tetap memblokir; konfirmasi butuh pratinjau berlaku + alasan ≥10 + centang konfirmasi", () => {
  const dasar = { boleh: true, sudahTercatat: { perluKonfirmasi: false }, pengecualianStok: { perlu: true, bisa: true, diminta: true, berlaku: true } };
  assert.equal(bolehKonfirmasi(dasar, "s", "s", { pengecualianOk: false }), false, "pengecualian berlaku tanpa alasan/konfirmasi tidak bisa dikonfirmasi");
  assert.equal(bolehKonfirmasi(dasar, "s", "s", { pengecualianOk: true }), true);
  assert.equal(bolehKonfirmasi({ ...dasar, boleh: false }, "s", "s", { pengecualianOk: true }), false, "ada penghalang = tidak bisa");
  assert.equal(bolehKonfirmasi(dasar, "s", "t", { pengecualianOk: true }), false, "isian berubah sejak pratinjau");
  assert.equal(bolehKonfirmasi({ boleh: true, sudahTercatat: { perluKonfirmasi: false } }, "s", "s"), true, "tanpa pengecualian: perilaku lama");
  assert.equal(validasiPengecualian({ alasan: "habis", konfirmasi: true }).ok, false); assert.equal(validasiPengecualian({ alasan: "Pemakaian lama belum tercatat", konfirmasi: false }).ok, false);
  assert.equal(validasiPengecualian({ alasan: "  Pemakaian lama belum tercatat ", konfirmasi: true }).alasan, "Pemakaian lama belum tercatat"); assert.equal(validasiPengecualian({ alasan: "x".repeat(301), konfirmasi: true }).ok, false);
});

test("pengecualian: sidik pratinjau memuat flag + satuan (mengubahnya membuang pratinjau); tubuh permintaan hanya membawa pengecualian bila diminta, plus satuan", () => {
  const a = sidikIsian({ cara: "TAMBAH", bahan: { materialId: "m1" }, qty: "3,4", alasan: "terlewat", tanggal: "2026-10-01", satuan: "METER", pengecualian: false });
  assert.notEqual(a, sidikIsian({ cara: "TAMBAH", bahan: { materialId: "m1" }, qty: "3,4", alasan: "terlewat", tanggal: "2026-10-01", satuan: "METER", pengecualian: true }));
  assert.notEqual(a, sidikIsian({ cara: "TAMBAH", bahan: { materialId: "m1" }, qty: "3,4", alasan: "terlewat", tanggal: "2026-10-01", satuan: "ROLL", pengecualian: false }));
  const pra = { stok: { saldoDilihat: 0 }, hppOperasional: { sidik: "h" } };
  const biasa = tubuhPembetulan({ cara: "TAMBAH", bahan: { materialId: "m1" }, qty: 2, alasan: "terlewat", tanggal: "2026-10-01", pra });
  assert.equal("pengecualianStokTidakCukup" in biasa, false); assert.equal("satuan" in biasa, false); assert.equal(biasa.qty, 2);
  const peng = tubuhPembetulan({ cara: "TAMBAH", bahan: { materialId: "m1" }, qty: 3.4, alasan: "terlewat", tanggal: "2026-10-01", pra, satuan: "METER", pengecualian: { alasan: " Pemakaian lama belum tercatat ", konfirmasi: true } });
  assert.deepEqual({ satuan: peng.satuan, flag: peng.pengecualianStokTidakCukup, alasan: peng.alasanPengecualianStok, konf: peng.konfirmasiSaldoMinus, qty: peng.qty }, { satuan: "METER", flag: true, alasan: "Pemakaian lama belum tercatat", konf: true, qty: 3.4 });
  assert.equal(tubuhPembetulan({ cara: "KURANGI", bahan: { materialId: "m1" }, qty: 1, alasan: "terlewat", tanggal: "2026-10-01", pra, pengecualian: null }).pengecualianStokTidakCukup, undefined);
});

test("pengecualian: infoPengecualian membaca pratinjau server (tidak menghitung sendiri); izin peran dihormati; peringatan tampil di dampak", () => {
  assert.equal(infoPengecualian({ pengecualianStok: null }).tampil, false);
  const pra = { izin: { pengecualianStokTidakCukup: true }, bahan: { satuan: "ROLL" }, pengecualianStok: { perlu: true, bisa: true, diminta: true, berlaku: true, saldoSebelum: -106.5, saldoSesudah: -106.7222, sebabTidakBisa: null, opname: { berjalan: [] } } };
  const i = infoPengecualian(pra); assert.deepEqual({ tampil: i.tampil, bisa: i.bisa, berlaku: i.berlaku, a: i.saldoSebelum, b: i.saldoSesudah, s: i.satuan }, { tampil: true, bisa: true, berlaku: true, a: -106.5, b: -106.7222, s: "ROLL" });
  const tanpaIzin = infoPengecualian({ ...pra, izin: { pengecualianStokTidakCukup: false }, pengecualianStok: { ...pra.pengecualianStok, bisa: false, berlaku: false, sebabTidakBisa: null } });
  assert.equal(tanpaIzin.bisa, false); assert.match(tanpaIzin.sebab, /Admin, Owner, Kepala Produksi/);
  const opname = infoPengecualian({ ...pra, pengecualianStok: { ...pra.pengecualianStok, bisa: false, berlaku: false, sebabTidakBisa: "Tanggal pemakaian sama dengan atau sebelum acuan opname" } });
  assert.match(opname.sebab, /opname/);
  const baris = barisDampak({ tindakan: { judul: "t", teks: "x", menulisStok: true }, waktu: { teks: "w" }, stok: { saldoSebelum: -106.5, saldoSesudah: -106.7222 }, pemakaianBersih: { sebelum: 0, sesudah: 0.2222 }, bahan: { satuan: "ROLL" }, qty: 0.2222, konversi: { teks: "20 METER ÷ 90 = 0,2222 ROLL" }, finance: { teks: "f", hasil: "GAP" }, hppOperasional: { teks: "h" }, peringatan: [{ kode: "SALDO_MINUS", pesan: "saldo menjadi minus" }] });
  assert.ok(baris.some((x) => x.k === "konversi" && /0,2222 ROLL/.test(x.teks))); assert.ok(baris.some((x) => x.peringatan && x.teks === "saldo menjadi minus"));
  assert.match(PESAN.pengecualianPeringatan, /TETAP mengurangi stok.*MINUS/); assert.match(PESAN.pengecualianPeringatan, /Tidak ada penerimaan, koreksi, harga, atau jurnal/); assert.equal(PESAN.pengecualianOpsi, "Tetap catat meskipun stok tidak cukup");
});

test("validasiPembetulan: jumlah meter terlalu kecil ditolak di layar; bahan biasa tidak terpengaruh", () => {
  const b = { materialId: "m1", ...LIST, satuanInput: "METER" };
  assert.equal(validasiPembetulan({ cara: "TAMBAH", bahan: b, qty: "0,001", alasan: "terlewat dicatat", tanggal: "2026-10-01" }).ok, false);
  assert.equal(validasiPembetulan({ cara: "TAMBAH", bahan: b, qty: "20", alasan: "terlewat dicatat", tanggal: "2026-10-01" }).ok, true);
  assert.equal(validasiPembetulan({ cara: "TAMBAH", bahan: { materialId: "k", satuan: "METER" }, qty: "0,001", alasan: "terlewat dicatat", tanggal: "2026-10-01" }).ok, true);
});

test("pengawatan UI: kotak pengecualian hanya dari pratinjau; izin dan konfirmasi; tombol menyebut pengeluaran stok baru; galat basi membuang pratinjau; satuan dikirim; tidak ada jalur tulis kedua", () => {
  const P = src("bahan/PembetulanUnitSelesai.jsx");
  assert.match(P, /infoPengecualian\(pra, izin\)/); assert.match(P, /pra && info\.tampil && <PengecualianStok/);
  assert.match(P, /data-testid="pengecualian-opsi"/); assert.match(P, /data-testid="pengecualian-alasan"/); assert.match(P, /data-testid="pengecualian-konfirmasi"/); assert.match(P, /data-testid="pengecualian-saldo"/);
  assert.match(P, /async function togglePengecualian\(on\) \{ setPengecualian\(on\); setKonfSaldo\(false\); await lihat\(on\); \}/);
  assert.match(P, /pengecualianOk: valPeng\.ok/); assert.match(P, /pengecualian: pakaiPengecualian \? \{ alasan: valPeng\.alasan, konfirmasi: konfSaldo \} : null/);
  assert.match(P, /PENGELUARAN STOK baru — stok tidak cukup, saldo jadi minus/); assert.match(P, /KODE_PRATINJAU_BASI/); assert.match(P, /UNIT_SALDO_BERGESER/);
  assert.match(P, /\.\.\.\(satuanKirim \? \{ satuan: satuanKirim \} : \{\}\), \.\.\.\(flag \? \{ pengecualianStokTidakCukup: true \} : \{\}\)/);
  assert.match(P, /if \(kirimRef\.current \|\| !siapKonfirmasi \|\| !v\.ok\) return;/, "klik ganda terkunci");
  assert.equal((P.match(/api\.addUnitMaterial\(/g) || []).length, 1, "satu jalur tulis: POST /units/:id/materials");
  assert.doesNotMatch(P, /stockMovement|postStockMovement|adjust|\/inventory\//i);
  const R = src("bahan/RiwayatBahanBaru.jsx"); assert.match(R, /Pengecualian stok tidak cukup/); assert.match(R, /data-testid="aktual-pakai"/); assert.match(R, /satuan: baris\.satuan, note:/);
  const C = src("bahan/CatatBahanBaru.jsx"); assert.match(C, /data-testid="aktual-satuan-pilih"/); assert.match(C, /data-testid="aktual-konversi"/);
  for (const f of ["UnitV1Materials.jsx", "workerApp/V1Panels.jsx"]) assert.match(src(f), /satuan: catalog\.find\(\(m\) => m\.id === form\.materialId\)\?\.unit/, `${f}: satuan stok eksplisit`);
});
