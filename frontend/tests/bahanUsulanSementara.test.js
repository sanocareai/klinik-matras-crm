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
  assert.ok(tab.indexOf("<PemakaianAktualBagian") > 0 && tab.indexOf("<PemakaianAktualBagian") < tab.indexOf('data-testid="sec-rencana"'), "aktual sebelum rencana");
  assert.ok(!tab.includes("xl:grid-cols"), "tidak lagi dua kolom berdampingan");
  assert.match(tab, /useState\(false\); const \[rencanaEdit/, "rencanaBuka = false (tertutup bawaan)");
  assert.ok(tab.includes("izin={izin}") && tab.includes("data={data}"));
  // tiga sumber = kartu di komponen bersama (drawer dan tab memakai komponen yang SAMA)
  const bagian = src("features", "production", "bahan", "PemakaianAktualBagian.jsx");
  for (const k of ['data-testid="aktual-sumber-tombol"', 'data-testid="sec-pemakaian-sementara"', "PemakaianSementaraDaftar", 'kunci="gudang"', 'kunci="belum"', 'kunci="lama"']) assert.ok(bagian.includes(k), k);
});

test("PemakaianAktualBagian: TIGA sumber selalu terlihat (kartu di luar panel formulir, tanpa menggulir daftar); 'belum ada' langsung membuka formulir pemakaian sementara + usulan; komponen lama; kartu dimatikan saat edit rencana atau tanpa izin", () => {
  const b = src("features", "production", "bahan", "PemakaianAktualBagian.jsx"); const m = src("features", "production", "bahan", "bahanModel.js");
  for (const k of ["Bahan dari Gudang", "Bahan belum ada di katalog", "Komponen lama dari kasur ini", "Perlu rekonsiliasi Gudang", "Mengurangi stok saat dikonfirmasi", "Tidak memengaruhi stok"]) assert.ok(m.includes(k), k);
  // kartu dirender tanpa syarat mode (hanya izin+aktif), formulir di bawahnya bergantung mode
  const iKartu = b.indexOf('data-testid="aktual-sumber-tombol"'); const iPanel = b.indexOf('data-testid="panel-catat-aktual"');
  assert.ok(iKartu > 0 && iPanel > iKartu, "kartu sebelum panel formulir"); assert.match(b, /\{boleh && \(\s*<div role="radiogroup"/, "kartu tampil selama boleh (bukan hanya saat mode kosong)");
  assert.match(b, /mode === "belum" && <BahanBelumAda/); assert.match(b, /mode === "gudang" && <CatatBahanBaru/); assert.match(b, /mode === "lama" && <FormKomponenLama/);
  assert.match(b, /disabled=\{rencanaEdit\}/); assert.match(b, /disabled=\{rencanaEdit \|\| !bolehBelumAda\}/); assert.match(b, /bolehBelumAda = boleh && \(!!izin\.catatPemakaianSementara \|\| !!izin\.usulBahan\)/);
  assert.match(b, /Akun Anda hanya bisa melihat pemakaian bahan/);
  for (const k of ["sec-bahan-baru", "sec-pemakaian-sementara", "sec-komponen-lama"]) assert.ok(b.includes(k), "daftar per sumber tetap terpisah: " + k);
  assert.ok(!b.includes("addUnitMaterial") && !b.includes("api.catatPemakaianSementara") && !b.includes("api.ajukanBahanBaru"), "komponen ini hanya merakit; jalur API ada di formulir masing-masing");
});

test("PemakaianAktualBagian dipakai drawer Order Produksi DAN tab Bahan (tidak ada salinan lama tanpa 'Bahan belum ada'); stok belum diketahui → jalur resmi dijelaskan", () => {
  const p = src("features", "production", "OrderProduksiPanel.jsx"); const t = src("features", "production", "bahan", "BahanTab.jsx"); const c = src("features", "production", "bahan", "CatatBahanBaru.jsx");
  assert.ok(p.includes("<PemakaianAktualBagian") && t.includes("<PemakaianAktualBagian")); assert.ok(!p.includes("PemilihBahanKatalog") && !p.includes("aktual-form"), "salinan lama di drawer sudah dibuang");
  for (const k of ["aktual-ganti", "Ganti bahan", "aktual-dampak-stok", "Dampak stok", "aktual-ke-sementara", "Yang saya pakai bukan bahan ini", "onPakaiSementara", "ketersediaanText"]) assert.ok(c.includes(k), k);
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
  assert.ok(!c.includes("api.ajukanBahanBaru") && !c.includes("api.catatPemakaianSementara"), "usulan/sementara bukan bagian dari jalur stok");
});

test("Bahan belum ada?: periksa kembar dulu, nama sama memblokir, mirip perlu konfirmasi, kategori/satuan wajib, usulan tidak menyentuh stok; pemakaian sementara hanya bila izin", () => {
  const b = src("features", "production", "bahan", "BahanBelumAda.jsx");
  for (const k of ["api.cekKembarBahan", "api.ajukanBahanBaru", "api.catatPemakaianSementara", "kembar.adaSama", "bedaDariMirip", "Usulkan ke Gudang", "tidak ada saldo, penerimaan, pergerakan stok, biaya, atau jurnal", "izin.catatPemakaianSementara", "izin.usulBahan", "kirimRef.current"]) assert.ok(b.includes(k), k);
  assert.ok(!b.includes("addUnitMaterial"), "usulan/sementara tidak lewat jalur stok");
});

test("Bahan belum ada di katalog = SATU formulir (pemakaian sementara + usulan): status 'Perlu rekonsiliasi Gudang' SEBELUM konfirmasi dan SESUDAH tersimpan; usulan dulu lalu sementara bertaut; gagal di tengah tidak mengirim ulang usulan; nama SAMA PERSIS dengan katalog diblokir (server menolak), nama mirip boleh dengan alasan+asal wajib", () => {
  const b = src("features", "production", "bahan", "BahanBelumAda.jsx");
  for (const k of ["status-rekon-sebelum", "status-rekon-sesudah", "STATUS_REKON", "belum-ada-ringkasan", "Akan dicatat:", "usulan-centang", "usulkanEfektif", "proposalId: dibuat?.id || undefined", "if (usulkanEfektif && !dibuat)", "setUsulan(r.usulan)", "Hanya pemakaian yang masih dicoba", "kunciRef.current ??= kunciIdempoten(\"sementara\")", "if (sidikRef.current !== sidik)"]) assert.ok(b.includes(k), k);
  assert.ok(b.indexOf("api.ajukanBahanBaru") < b.indexOf("api.catatPemakaianSementara"), "usulan lebih dulu, lalu pemakaian sementara bertaut");
  assert.match(b, /const sudahAda = !usulan && kembar\.adaSama;/); assert.match(b, /valid = namaOk && !blokKatalogSama && usulanOk && sementaraOk && alasanOk && asalOk && \(bolehSementara \|\| usulkanEfektif\)/, "nama sama persis dengan katalog diblokir; nama usulan terbuka/mirip tidak");
  assert.ok(!b.includes("addUnitMaterial") && !b.includes("Material Issue ke"), "tidak membuat Material Issue/stok");
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
  const yAktual = p.indexOf('<Bagian id="sec-aktual"'); const yRencana = p.indexOf('id="sec-rencana-wrap"');
  assert.ok(yAktual > 0 && yRencana > yAktual, "aktual sebelum rencana");
  assert.match(p, /<details className="border-t border-line pt-5" id="sec-rencana-wrap"/); assert.ok(!/<details[^>]*\sopen[\s>=]/.test(p.slice(yRencana - 80, yRencana + 120)), "tertutup bawaan");
  assert.match(p, /if \(el\.tagName === "DETAILS"\) el\.open = true;/);
  for (const k of ["PemakaianAktualBagian", "tanpaJudul"]) assert.ok(p.includes(k), k);
  const b = src("features", "production", "bahan", "PemakaianAktualBagian.jsx"); for (const k of ["PemakaianSementaraDaftar", "CatatBahanBaru", "BahanBelumAda", "FormKomponenLama"]) assert.ok(b.includes(k), k);
});

test("drawer Order Produksi: FOKUS BAHAN — masuk untuk mencatat bahan langsung ke Pemakaian aktual (tanpa melewati Status & target); Status & target tetap terjangkau (bilah lompat + bagian terlipat); tanpa fokus urutan lama", () => {
  const p = src("features", "production", "OrderProduksiPanel.jsx"); const w = src("pages", "bengkel", "ProductionWorkOrders.jsx");
  for (const k of ["fokus = null", 'fokus === "bahan" || fokusLokal', 'data-testid="panel-lompat"', 'data-testid="lompat-bahan"', 'data-testid="lompat-status"', 'data-testid="lompat-riwayat"', "!fokusBahan && <Bagian id=\"sec-status\"", "fokusBahan && (", 'data-testid="sec-status-lipat"', "fokusSudahRef", 'scrollIntoView({ behavior: "auto", block: "start" })']) assert.ok(p.includes(k), k);
  assert.ok(p.indexOf('<Bagian id="sec-aktual"') < p.indexOf('id="sec-status-lipat"'), "fokus bahan: Pemakaian aktual SEBELUM Status & target (terlipat)");
  assert.ok(p.indexOf('!fokusBahan && <Bagian id="sec-status"') < p.indexOf('<Bagian id="sec-aktual"'), "tanpa fokus: Status & target tetap sebelum Pemakaian aktual");
  assert.match(p, /if \(el\.tagName === "DETAILS" \|\| buka\)/, "bilah lompat membuka bagian terlipat");
  // daftar: tombol 'Catat bahan' per baris (desktop) dan per kartu (HP) membuka panel dengan fokus bahan; klik baris biasa tanpa fokus
  for (const k of ['data-testid="catat-bahan-baris"', 'setFokusPanel("bahan")', "const bukaBahan", "const bukaPanel", "e.stopPropagation()", "unitAktif(u)"]) assert.ok(w.includes(k), k);
  assert.equal((w.match(/data-testid="catat-bahan-baris"/g) || []).length, 2, "satu di tabel desktop, satu di kartu HP");
  assert.match(w, /setFokusPanel\(null\); setDetailUnit\(u\)/, "klik baris biasa = tanpa fokus");
});
