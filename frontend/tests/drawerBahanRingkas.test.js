// Drawer bahan (Stok & Lokasi) versi RINGKAS: logika murni peringatan/ringkasan + pengawatan sumber. Tanpa React/DOM.
// Yang dijaga: hanya tampilan yang berubah — layanan (stok, harga, izin, persetujuan, audit) dan makna angka tetap.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ISTILAH, TEKS_DRAWER, barisDampakBermakna, peringatanHarga, peringatanStok, ringkasHarga } from "../src/features/warehouse/stok/drawerBahanLogic.js";
import { TEKS as TEKS_HARGA, rp, rpNilai } from "../src/features/warehouse/stok/hargaBerlakuLogic.js";
import { TEKS as TEKS_KOREKSI } from "../src/features/warehouse/stok/koreksiSaldoLogic.js";

const src = (...p) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", ...p), "utf8").replace(/\r\n/g, "\n");

test("istilah Indonesia dan rumus stok hanya di penjelasan (Tersedia = Saldo − Dipesan)", () => {
  assert.deepEqual([ISTILAH.tersedia, ISTILAH.saldo, ISTILAH.dipesan], ["Tersedia", "Saldo", "Dipesan"]);
  assert.match(ISTILAH.rumusStok, /Tersedia = Saldo − Dipesan/); assert.match(ISTILAH.rumusStok, /Material Issue yang sudah disetujui tetapi belum dikeluarkan/);
});

test("peringatan stok: hanya yang butuh tindakan (minus, belum diketahui, koreksi menunggu); nol menurut pergerakan dan ada stok bukan peringatan", () => {
  assert.deepEqual(peringatanStok({ keadaan: "POSITIF" }), []); assert.deepEqual(peringatanStok({ keadaan: "NOL_MENURUT_PERGERAKAN" }), []); assert.deepEqual(peringatanStok({ keadaan: "NOL_TERVERIFIKASI" }), []);
  assert.deepEqual(peringatanStok({ keadaan: "MINUS" }).map((p) => p.kode), ["SALDO_MINUS"]); assert.equal(peringatanStok({ keadaan: "MINUS" })[0].nada, "red");
  const bd = peringatanStok({ keadaan: "BELUM_ADA_CATATAN" }); assert.equal(bd[0].kode, "STOK_BELUM_DIKETAHUI"); assert.match(bd[0].teks, /bukan nol/i);
  const ak = peringatanStok({ keadaan: "POSITIF", aktif: { id: "k1", nomor: "ADJ-1", statusTeks: "Menunggu persetujuan orang lain", kedaluwarsa: true } });
  assert.equal(ak[0].kode, "KOREKSI_MENUNGGU"); assert.match(ak[0].teks, /ADJ-1 menunggu persetujuan orang lain/); assert.match(ak[0].tambahan, /bergeser/);
  assert.equal(peringatanStok({ keadaan: "MINUS", aktif: { id: "k", nomor: "A", statusTeks: "Draf" } }).length, 2, "minus + koreksi berjalan = dua peringatan");
});

test("peringatan harga: belum diisi dan pembekuan gagal; belum ada harga TIDAK PERNAH menjadi Rp0", () => {
  const p = peringatanHarga({ h: null, dampak: { gagalPembekuan: { pemakaian: 2 } } }); assert.deepEqual(p.map((x) => x.kode), ["HARGA_BELUM_DIISI", "PEMBEKUAN_GAGAL"]);
  assert.match(p[0].teks, /bukan Rp0/); assert.equal(p[1].nada, "red");
  assert.deepEqual(peringatanHarga({ h: { harga: "20000" }, dampak: { gagalPembekuan: { pemakaian: 0 } } }), []);
  const kosong = ringkasHarga(null, "KG", rp); assert.deepEqual([kosong.ada, kosong.angka], [false, "Belum diisi"]); assert.ok(!/Rp\s?0\b/.test(kosong.angka));
  const ada = ringkasHarga({ harga: "36000", teksLabelBukti: "Belum didukung bukti", labelBukti: "BELUM_DIDUKUNG_BUKTI", berlakuMulai: "2026-10-18T13:50:00Z" }, "KG", rp);
  assert.deepEqual([ada.ada, ada.angka, ada.satuan, ada.label], [true, "Rp36.000", "kg", "Belum didukung bukti"]);
});

test("rincian terdampak: baris nol tidak ditampilkan; semua nol = daftar kosong (satu kalimat)", () => {
  const nol = { akanMemakai: { order: 0, unit: 0 }, sudahDibekukanSejakMulai: { pemakaian: 0, nilai: 0 }, belumDibekukan: { pemakaian: 0, unit: 0 } };
  assert.deepEqual(barisDampakBermakna(nol, rpNilai), []); assert.deepEqual(barisDampakBermakna(null, rpNilai), []); assert.match(TEKS_DRAWER.dampakKosong, /Belum ada pemakaian yang terdampak/);
  const sebagian = barisDampakBermakna({ ...nol, sudahDibekukanSejakMulai: { pemakaian: 1, nilai: 100000 } }, rpNilai);
  assert.deepEqual(sebagian.map((x) => x.k), ["beku"]); assert.equal(sebagian[0].nilai, "1 · Rp100.000");
  const semua = barisDampakBermakna({ akanMemakai: { order: 3, unit: 4 }, sudahDibekukanSejakMulai: { pemakaian: 1, nilai: 5 }, belumDibekukan: { pemakaian: 2, unit: 2 } }, rpNilai); assert.deepEqual(semua.map((x) => x.k), ["order", "beku", "tanpa-harga"]);
});

test("teks aturan tetap ada dan tidak berubah makna: HPP operasional ≠ nilai Finance; persetujuan orang lain; tanpa mundur", () => {
  assert.match(TEKS_DRAWER.bedaAngka, /Nilai persediaan Finance adalah angka terpisah/); assert.match(TEKS_DRAWER.aturanKoreksi, /disetujui ORANG LAIN/);
  assert.match(TEKS_HARGA.bukan, /Bukan nilai buku dan bukan HPP final Finance/); assert.match(TEKS_HARGA.aturanTanpaMundur, /tidak boleh mundur/); assert.match(TEKS_KOREKSI.tidakDisentuh, /Harga Berlaku, nilai persediaan\/jurnal Finance/);
});

test("pengawatan drawer: Tersedia/Saldo/Dipesan, tombol di kartu, penjelasan di ikon info, bagian terlipat, label Indonesia, layanan sama", () => {
  const d = src("features", "warehouse", "components", "ItemDetailDrawer.jsx");
  for (const k of ['data-testid="stok-tersedia"', 'data-testid="stok-saldo"', 'data-testid="stok-dipesan"', "ISTILAH.tersedia", "ISTILAH.saldo", "ISTILAH.dipesan", "InfoToggleButton", "<KoreksiSaldoPanel", "<HargaBerlakuPanel materialId={materialId} />", 'testid="lipat-referensi-harga"', 'testid="lipat-detail-bahan"', 'testid="lipat-pergerakan"', "Riwayat pergerakan", "keIndonesia"]) assert.ok(d.includes(k), k);
  const tampilanSaja = d.replace(/^\s*\/\/.*$/gm, ""); // komentar kode tidak ikut tampil
  for (const lama of ["Available Stock", "On Hand", "Reserved", "Movement History", "Unit of Measure", "Service Line"]) assert.ok(!tampilanSaja.includes(lama), `istilah Inggris dihapus: ${lama}`);
  assert.ok(!d.includes("dihitung dari penjumlahan seluruh baris ledger"), "rumus tidak lagi tampil di awal (pindah ke ikon info)");
  assert.ok(d.indexOf("<KoreksiSaldoPanel") < d.indexOf("<HargaBerlakuPanel") && d.indexOf("<HargaBerlakuPanel") < d.indexOf('testid="lipat-referensi-harga"'), "urutan: stok, harga, lalu bagian terlipat");
  assert.match(d, /api\.updateMaterial\(materialId, \{ active: !item\.active \}\)/, "aksi nonaktifkan tidak berubah");
});

test("panel koreksi saldo: tombol Koreksi saldo hanya bila berizin; Riwayat; layanan sama; aturan di ikon info; modal memuat ketentuan", () => {
  const p = src("features", "warehouse", "stok", "KoreksiSaldoPanel.jsx");
  for (const k of ["d.izin.bolehMengajukan &&", "disabled={!!aktif}", "api.getKoreksiSaldoBahan(materialId)", 'data-testid="tombol-koreksi-saldo"', 'data-testid="tombol-riwayat-koreksi"', "peringatanStok(", "InfoToggleIsi", "TEKS_DRAWER.aturanKoreksi", "d.izin.teks", 'data-testid="izin-koreksi"', "<KoreksiSaldoModal"]) assert.ok(p.includes(k), k);
  const m = src("features", "warehouse", "stok", "KoreksiSaldoModal.jsx"); assert.match(m, /TEKS\.jalur/); assert.match(m, /data-testid="catatan-tidak-disentuh"/); assert.match(m, /api\.ajukanKoreksiSaldo\(body, kunciUntuk/); assert.match(m, /saldoDilihat: pra\.saldoDilihat/);
});

test("panel harga berlaku: harga atau 'Belum diisi', label bukti, Ubah harga hanya bila d.bolehUbah, nilai Finance + terdampak terlipat, tanpa Rp0 untuk belum ada harga; modal memuat ketentuan", () => {
  const p = src("features", "warehouse", "stok", "HargaBerlakuPanel.jsx");
  for (const k of ["d.bolehUbah && <Button", 'data-testid="tombol-ubah-harga"', 'data-testid="tombol-riwayat-harga"', 'testid="lipat-finance"', 'testid="lipat-dampak"', "barisDampakBermakna(", "peringatanHarga(", "ringkasHarga(", "TEKS_DRAWER.bedaAngka", 'data-testid="nilai-persediaan-finance"', 'data-testid="pemisah-angka"', "api.getHargaBerlaku(materialId)", "e.status === 403"]) assert.ok(p.includes(k), k);
  assert.ok(!/\|\| ?0\b/.test(p.replace(/^\s*\/\/.*$/gm, "")), "tidak ada fallback ke 0");
  const m = src("features", "warehouse", "stok", "UbahHargaModal.jsx"); for (const k of ["TEKS.bukan", "TEKS.finance", "TEKS.aturanTanpaMundur", 'data-testid="belum-ada-harga-modal"', "hashPratinjau: pra.hash", "api.pratinjauHargaBerlaku(masukan)"]) assert.ok(m.includes(k), k);
  assert.match(m, /bukan Rp0/);
});

test("ikon info: tombol sungguhan (keyboard), aria-expanded/aria-controls, target sentuh 44px di HP, isi sejajar (bukan tooltip hover)", () => {
  const t = src("components", "ui", "info-toggle.jsx");
  for (const k of ['type="button"', "aria-expanded={info.buka}", "aria-controls={info.id}", "aria-label={`Penjelasan: ${label}`}", "max-sm:h-11 max-sm:w-11", 'role="note"', "useId()"]) assert.ok(t.includes(k), k);
  assert.ok(!t.includes("createPortal") && !t.includes("onMouseEnter"), "tidak bergantung hover dan tidak di-portal");
  const l = src("features", "warehouse", "stok", "Lipat.jsx"); assert.match(l, /<details/); assert.match(l, /<summary/); assert.match(l, /sm:min-h-9/); assert.match(l, /min-h-11/);
});
