// UX Bahan (Okt 2026): model murni + pengawatan UI untuk (a) urutan Pemakaian aktual di atas Rencana (tertutup bawaan), (b) kategori+pencarian di pemilih bahan, saldo & satuan sebelum konfirmasi,
// (c) "Bahan belum ada?" (usulan, BUKAN stok), (d) pemakaian sementara (BUKAN Material Issue) + rekonsiliasi Gudang, (e) halaman Gudang.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ASAL_UMUM, CATATAN_SEMENTARA, DAMPAK_SEMENTARA, KELOMPOK_USULAN, SUMBER_SEMENTARA, keadaanSaldo, ringkasBahan, ringkasPekerjaan, ringkasSementara } from "../src/features/production/bahan/bahanModel.js";
import { sumberKerjaPendek, sumberKerjaText } from "../src/features/production/orderProduksiModel.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, "..", "src", ...p), "utf8").replace(/\r\n/g, "\n");

test("kategori usulan = kelompok katalog Gudang (urutan tetap, tanpa 'Belum dikelompokkan')", () => {
  assert.deepEqual(KELOMPOK_USULAN.map((k) => k.label), ["Busa", "Kain", "Benang", "Pegas", "Kayu", "Lem/Kimia", "Aksesori", "Lainnya"]);
  assert.ok(ASAL_UMUM.includes("Dibeli sendiri / dari luar"));
});

test("saldo & satuan SEBELUM konfirmasi: cukup menampilkan saldo + sisa setelah dicatat; kurang memblokir; tidak diketahui diberi tahu jujur", () => {
  const b = { satuan: "METER", tersedia: 20, saldoDiketahui: true };
  const ok = keadaanSaldo(b, "2,5"); assert.equal(ok.status, "cukup"); assert.match(ok.teks, /Saldo Gudang 20 METER/); assert.match(ok.sisaTeks, /Sisa setelah dicatat: 17,5 METER/);
  assert.equal(keadaanSaldo(b, "").sisaTeks, null);
  const kurang = keadaanSaldo(b, "25"); assert.equal(kurang.status, "kurang"); assert.equal(kurang.blok, true);
  assert.equal(keadaanSaldo({ satuan: "CAN", saldoDiketahui: false }, "1").status, "tidak_diketahui");
});

test("ringkasSementara: hitung per status, terpisah dari bahan baru dan komponen lama (tidak dijumlahkan)", () => {
  const data = { pemakaianSementara: { items: [{ id: "a", status: "PERLU_REKONSILIASI" }, { id: "b", status: "DIREKONSILIASI" }, { id: "c", status: "DIBATALKAN" }] }, pemakaianAktual: { baris: [], total: [] }, rencanaBahan: { plan: null }, komponenLama: null };
  const r = ringkasSementara(data); assert.deepEqual({ ada: r.ada, perlu: r.perlu, direkonsiliasi: r.direkonsiliasi, dibatalkan: r.dibatalkan }, { ada: true, perlu: 1, direkonsiliasi: 1, dibatalkan: 1 });
  const rb = ringkasBahan(data); assert.equal(rb.sementara.perlu, 1); assert.equal(rb.baru.jumlahCatatan, 0); assert.equal(rb.kosong, false, "hanya ada pemakaian sementara ≠ kosong");
  assert.equal(ringkasSementara({}).ada, false);
});

test("Ringkasan Pekerjaan menyebut pemakaian sementara (perlu rekonsiliasi) dan sumber status kerja berlabel", () => {
  const p = ringkasPekerjaan({ adopsi: { kerja: { source: "PEMAKAIAN_SEMENTARA" }, pemakaianBahan: { baruCatatan: 0, komponenLamaDipakaiKembali: 0, sementaraPerluRekonsiliasi: 2 } } });
  assert.match(p.pemakaian, /2 pemakaian sementara \(perlu rekonsiliasi Gudang\)/); assert.equal(p.sumber, "Pemakaian sementara — perlu rekonsiliasi Gudang");
  assert.equal(sumberKerjaText({ source: "PEMAKAIAN_SEMENTARA" }), "Pemakaian sementara — perlu rekonsiliasi Gudang");
  assert.equal(sumberKerjaPendek({ source: "PEMAKAIAN_SEMENTARA", sourceLabel: "Pemakaian sementara — perlu rekonsiliasi Gudang", key: "DIKERJAKAN" }), "Pemakaian sementara — perlu rekonsiliasi Gudang");
});

test("teks dampak: bukan Material Issue, stok/biaya/jurnal tidak berubah; tetap bukti 'Sudah dikerjakan' dan tampil di Ringkasan/Riwayat/Excel", () => {
  assert.match(CATATAN_SEMENTARA, /Stok tidak berkurang/); assert.match(CATATAN_SEMENTARA, /bukan Material Issue/);
  assert.match(DAMPAK_SEMENTARA, /Sudah dikerjakan/); assert.match(DAMPAK_SEMENTARA, /Riwayat/); assert.match(DAMPAK_SEMENTARA, /Excel/); assert.match(DAMPAK_SEMENTARA, /Bukan selesai QC/);
  assert.equal(SUMBER_SEMENTARA.ringkas, "Perlu rekonsiliasi Gudang");
});

test("BahanTab: Pemakaian aktual DI ATAS Rencana; rencana tertutup bawaan; satu kolom; dua tombol sumber; sementara terpisah", () => {
  const tab = src("features", "production", "bahan", "BahanTab.jsx");
  assert.ok(tab.indexOf('data-testid="sec-aktual"') > 0 && tab.indexOf('data-testid="sec-aktual"') < tab.indexOf('data-testid="sec-rencana"'), "aktual sebelum rencana");
  assert.ok(!tab.includes("xl:grid-cols"), "tidak lagi dua kolom berdampingan");
  assert.match(tab, /useState\(false\); const \[rencanaEdit/, "rencanaBuka = false (tertutup bawaan)");
  for (const k of ["Catat bahan baru dari Gudang", "Catat komponen lama dari unit ini", 'data-testid="aktual-buka"', 'data-testid="aktual-buka-lama"', 'data-testid="sec-pemakaian-sementara"', "PemakaianSementaraDaftar", "izin={izin}"]) assert.ok(tab.includes(k), k);
});

test("Pemilih bahan: kategori + kata kunci dikirim BERSAMA (cari di dalam kategori), kategori tetap aktif saat mencari, saldo+satuan per baris, tombol 'Bahan belum ada?'", () => {
  const p = src("features", "production", "bahan", "PemilihBahanKatalog.jsx");
  assert.match(p, /getKatalogBahanProduksi\(\{ q: tunda \|\| undefined, kelompok: kelompok \|\| undefined/);
  assert.ok(!p.includes("disabled={!!tunda || disabled}"), "kategori tidak dimatikan saat mencari");
  for (const k of ["Kategori bahan", "satuan {b.satuan}", "ketersediaanText(b)", "Bahan belum ada?", "-belum-ada", "Cari di semua kategori"]) assert.ok(p.includes(k), k);
});

test("CatatBahanBaru: jalur stok resmi tetap; saldo→sisa + ringkasan SEBELUM konfirmasi; 'Bahan belum ada?' hanya bila izin usulBahan; baris terpilih tidak hilang saat panel dibuka", () => {
  const c = src("features", "production", "bahan", "CatatBahanBaru.jsx");
  for (const k of ["api.addUnitMaterial", "kunciIdempoten", "aktual-sisa", "aktual-ringkasan-konfirmasi", "Stok Gudang akan berkurang", "izin.usulBahan", "BahanBelumAda", "onGunakanKatalog"]) assert.ok(c.includes(k), k);
  assert.ok(!c.includes("ajukanBahanBaru") && !c.includes("catatPemakaianSementara"), "usulan/sementara bukan bagian dari jalur stok");
});

test("Bahan belum ada?: periksa kembar dulu, nama sama memblokir, mirip perlu konfirmasi, kategori/satuan wajib, usulan tidak menyentuh stok; pemakaian sementara hanya bila izin", () => {
  const b = src("features", "production", "bahan", "BahanBelumAda.jsx");
  for (const k of ["api.cekKembarBahan", "api.ajukanBahanBaru", "kembar.adaSama", "bedaDariMirip", "Usulkan ke Gudang", "tidak menambah saldo, penerimaan, pergerakan stok, biaya, atau jurnal", "izin.catatPemakaianSementara", "kirimRef.current", "Menunggu Gudang".slice(0, 0)]) assert.ok(b.includes(k), k);
  assert.ok(!b.includes("addUnitMaterial"), "usulan tidak lewat jalur stok");
});

test("FormPemakaianSementara: Idempotency-Key per niat (kunci diganti bila isian berubah), klik ganda dikunci, jalur API sementara — bukan jalur stok", () => {
  const f = src("features", "production", "bahan", "FormPemakaianSementara.jsx");
  for (const k of ["kunciIdempoten(\"sementara\")", "kunciRef.current ??=", "if (sidikRef.current !== sidik)", "kirimRef.current", "api.catatPemakaianSementara", "CATATAN_SEMENTARA", "berubah dan tidak ada biaya atau jurnal"]) assert.ok(f.includes(k), k);
  assert.ok(!f.includes("addUnitMaterial"), "bukan Material Issue / pergerakan stok");
});

test("Rekonsiliasi: tautkan ke pergerakan resmi atau 'bukan stok Gudang' (alasan ≥10), selisih wajib penjelasan, tidak ada jalur stok baru", () => {
  const r = src("features", "production", "bahan", "RekonsiliasiPanel.jsx"); const d = src("features", "production", "bahan", "PemakaianSementaraDaftar.jsx");
  for (const k of ["api.getKandidatPergerakanSementara", "api.rekonsiliasiPemakaianSementara", "TAUTKAN_ISSUE", "TANPA_STOK", "catatanMin", "satuanSama", "Menyelesaikan tidak menulis pergerakan stok, biaya, atau jurnal"]) assert.ok(r.includes(k), k);
  assert.ok(!r.includes("addUnitMaterial") && !r.includes("postStockMovement"));
  assert.match(d, /bolehGudang && .*Selesaikan \(Gudang\)/); assert.match(d, /Batalkan \(salah input\)/); assert.match(d, /Menunggu Gudang menyelesaikan sumber stoknya/);
});

test("halaman Gudang Usulan Bahan: rute, menu Stok, badge antrean, status jelas, keputusan hanya bila izin, tanpa API stok", () => {
  const reg = src("routes", "pageRegistry.jsx"), lay = src("components", "Layout.jsx"), nav = src("lib", "gudangNav.js"), halaman = src("pages", "warehouse", "WarehouseUsulanBahan.jsx"), grup = src("components", "GudangNavGrup.jsx");
  assert.match(reg, /path: "\/warehouse\/usulan-bahan", render: \(\) => <WarehouseUsulanBahan \/>/); assert.match(lay, /to: "\/warehouse\/usulan-bahan", label: "Usulan Bahan"/);
  assert.match(nav, /"\/warehouse\/usulan-bahan": \["USULAN_BAHAN", "SEMENTARA_REKON"\]/); assert.match(grup, /USULAN_BAHAN/); assert.match(grup, /SEMENTARA_REKON/);
  for (const k of ["api.getUsulanBahan", "api.putuskanUsulanBahan", "api.getPemakaianSementara", "izinPutuskan", "izinRekon", "usulan-status", "Menunggu Gudang", "tanpa saldo awal", "Halaman ini tidak mengubah saldo stok"]) assert.ok(halaman.includes(k), k);
  assert.ok(!halaman.includes("addUnitMaterial") && !halaman.includes("createGoodsReceipt"));
});

test("koreksi & pembatalan beralasan: kunci idempoten per niat, alasan wajib, lama tetap tampil (dicoret) dan tidak lagi bukti kerja; Gudang boleh membatalkan 'bukan stok Gudang'", () => {
  const d = src("features", "production", "bahan", "PemakaianSementaraDaftar.jsx"); const api = src("api.js");
  for (const k of ["api.koreksiPemakaianSementara", "kunciIdempoten(\"koreksi-sem\")", "if (sidikRef.current !== sidik)", "kirimRef.current", "Alasan koreksi (wajib)", "alasan.trim().length >= 3", "sementara-koreksi-buka", "Tidak lagi dihitung sebagai bukti pekerjaan", "Dikoreksi (diganti catatan baru)", "bisaBatalSelesai", "line-through"]) assert.ok(d.includes(k), k);
  assert.match(api, /koreksiPemakaianSementara: \(id, body, idempotencyKey = mutationKey\("koreksi-sem"\)\) => request\(`\/production\/provisional-usages\/\$\{id\}\/correct`/);
  assert.ok(!d.includes("addUnitMaterial"), "koreksi bukan jalur stok");
});

test("drawer lama (OrderProduksiPanel): Pemakaian aktual DI ATAS Rencana; rencana terlipat bawaan dan dibuka oleh tindakan 'Susun rencana bahan'; pemakaian sementara tampil; pemilih bahan = pemilih bersama", () => {
  const p = src("features", "production", "OrderProduksiPanel.jsx");
  const yAktual = p.indexOf('id="sec-aktual"'); const yRencana = p.indexOf('id="sec-rencana-wrap"');
  assert.ok(yAktual > 0 && yRencana > yAktual, "aktual sebelum rencana");
  assert.match(p, /<details className="border-t border-line pt-5" id="sec-rencana-wrap"/); assert.ok(!/<details[^>]*\sopen[\s>=]/.test(p.slice(yRencana - 80, yRencana + 120)), "tertutup bawaan");
  assert.match(p, /if \(el\.tagName === "DETAILS"\) el\.open = true;/);
  for (const k of ["PemilihBahanKatalog", "aktual-sementara", "PemakaianSementaraDaftar", "data.izin?.catatPemakaianSementara"]) assert.ok(p.includes(k), k);
});
