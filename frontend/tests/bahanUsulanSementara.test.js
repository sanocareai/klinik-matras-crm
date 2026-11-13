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

test("BahanTab: Pemakaian aktual DI ATAS Rencana; rencana tertutup bawaan; satu kolom; tiga sumber di dialog form; sementara terpisah", () => {
  const tab = src("features", "production", "bahan", "BahanTab.jsx");
  assert.ok(tab.indexOf("<PemakaianAktualBagian") > 0 && tab.indexOf("<PemakaianAktualBagian") < tab.indexOf('data-testid="sec-rencana"'), "aktual sebelum rencana");
  assert.ok(!tab.includes("xl:grid-cols"), "tidak lagi dua kolom berdampingan");
  assert.match(tab, /useState\(false\); const \[rencanaEdit/, "rencanaBuka = false (tertutup bawaan)");
  assert.ok(tab.includes("izin={izin}") && tab.includes("data={data}"));
  // tiga sumber = pilihan segmen di komponen bersama (drawer dan tab memakai komponen yang SAMA)
  const bagian = src("features", "production", "bahan", "PemakaianAktualBagian.jsx");
  for (const k of ['data-testid="aktual-sumber-tombol"', 'data-testid="sec-pemakaian-sementara"', "PemakaianSementaraDaftar", '["gudang", Package', '["belum", HelpCircle', '["lama", Recycle', 'data-testid={`sumber-${kunci}`}']) assert.ok(bagian.includes(k), k);
});

test("PemakaianAktualBagian: TIGA sumber = pilihan segmen di dialog form (Bahan Gudang · Bahan belum tercatat · Komponen pelanggan); 'belum ada' langsung membuka formulir pemakaian sementara + usulan; komponen lama; pilihan dimatikan saat edit rencana atau tanpa izin", () => {
  const b = src("features", "production", "bahan", "PemakaianAktualBagian.jsx"); const m = src("features", "production", "bahan", "bahanModel.js");
  for (const k of ["Bahan dari Gudang", "Bahan belum ada di katalog", "Komponen lama dari kasur ini", "Perlu rekonsiliasi Gudang", "Mengurangi stok saat dikonfirmasi", "Tidak memengaruhi stok"]) assert.ok(m.includes(k), k);
  // dialog form: pilihan sumber di dalamnya, formulir sesuai mode di bawahnya; dialog hanya terbuka lewat '+ Tambah pemakaian' / tindakan berikutnya dan hanya bagi yang berizin (membuka TIDAK menulis)
  const iPanel = b.indexOf('data-testid="panel-catat-aktual"'); const iSeg = b.indexOf('data-testid="aktual-sumber-tombol"');
  assert.ok(iPanel > 0 && iSeg > iPanel, "pilihan sumber ada di dalam dialog form");
  assert.ok(b.includes("const formTampil = bolehTambah && (tambahBuka || !!mode)"), "dialog hanya terbuka sengaja dan berizin");
  assert.match(b, /mode === "belum" && <BahanBelumAda/); assert.match(b, /mode === "gudang" && <CatatBahanBaru/); assert.match(b, /mode === "lama" && <FormKomponenLama/);
  assert.match(b, /disabled=\{rencanaEdit\}/); assert.ok(b.includes("disabled={mati || rencanaEdit}") && b.includes('["belum", HelpCircle, !bolehBelumAda,'), "'belum tercatat' mati tanpa izin"); assert.match(b, /bolehBelumAda = bolehTambah && \(!!izin\.catatPemakaianSementara \|\| !!izin\.usulBahan\)/);
  assert.match(b, /Akun Anda hanya bisa melihat pemakaian bahan/);
  assert.ok(b.includes("konfirmasi-ganti-sumber") && b.includes("adaIsian"), "ganti sumber / tutup saat ada isian diberi peringatan, tidak membuang diam-diam");
  for (const k of ["sec-bahan-baru", "sec-pemakaian-sementara", "sec-komponen-lama"]) assert.ok(b.includes(k), "daftar per sumber tetap terpisah: " + k);
  assert.ok(!b.includes("addUnitMaterial") && !b.includes("api.catatPemakaianSementara") && !b.includes("api.ajukanBahanBaru"), "komponen ini hanya merakit; jalur API ada di formulir masing-masing");
});

test("PemakaianAktualBagian = SATU-SATUNYA formulir pemakaian di profil unit (tab Bahan; tidak ada salinan lama tanpa 'Bahan belum ada'); stok belum diketahui → jalur resmi dijelaskan", () => {
  const t = src("features", "production", "bahan", "BahanTab.jsx"); const c = src("features", "production", "bahan", "CatatBahanBaru.jsx"); const ws = src("features", "production", "workspace", "UnitWorkspace.jsx");
  assert.ok(t.includes("<PemakaianAktualBagian") && ws.includes("<BahanTab "), "profil unit (semua halaman Produksi) memakai tab Bahan yang sama");
  for (const f of [["workspace", "UnitWorkspace.jsx"], ["workspace", "RingkasanUnit.jsx"], ["workspace", "LangkahBerikutnya.jsx"]]) { const x = src("features", "production", ...f); assert.ok(!x.includes("PemilihBahanKatalog") && !x.includes("aktual-form"), "tanpa salinan formulir bahan: " + f.join("/")); }
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

test("tab Bahan profil unit: Pemakaian aktual DI ATAS Rencana; rencana terlipat bawaan; tindakan 'Susun rencana bahan' membuka tab Bahan; pemakaian sementara tampil; pemilih bahan = pemilih bersama", () => {
  const t = src("features", "production", "bahan", "BahanTab.jsx"); const b = src("features", "production", "bahan", "PemakaianAktualBagian.jsx"); const model = src("features", "production", "workspace", "profilModel.js");
  assert.ok(t.indexOf("<PemakaianAktualBagian") > 0 && t.indexOf('data-testid="sec-rencana"') > t.indexOf("<PemakaianAktualBagian"), "aktual sebelum rencana");
  assert.ok(t.includes("const [rencanaBuka, setRencanaBuka] = useState(false);") && t.includes("{rencanaBuka && ("), "rencana tertutup bawaan");
  assert.ok(model.includes('case "PLAN_MATERIAL": return izin.rencanaBahan ? { jenis: "bagian", bagian: "bahan", label: "Susun rencana bahan" } : null;'), "tindakan 'Susun rencana bahan' membuka tab Bahan");
  for (const k of ["PemakaianSementaraDaftar", "CatatBahanBaru", "BahanBelumAda", "FormKomponenLama"]) assert.ok(b.includes(k), k);
});

test("Order Produksi: FOKUS BAHAN — masuk untuk mencatat bahan langsung ke tab Bahan profil unit; tab lain tetap terjangkau; tanpa fokus = Ringkasan", () => {
  const w = src("pages", "bengkel", "ProductionWorkOrders.jsx");
  // Order Produksi membuka PROFIL UNIT yang sama dengan halaman Produksi lain (menempel di layar lebar, panel geser di layar sempit).
  assert.ok(w.includes('setBagianPanel(tab === "bahan" ? "bahan" : "ringkasan");'), "fokus bahan -> tab Bahan, selain itu Ringkasan");
  assert.ok(w.includes("<UnitWorkspace unitId={openUnitId} bagian={bagianPanel} onBagian={setBagianPanel}") && w.includes("<PanelUnit buka={openUnitId ? { unitId: openUnitId, bagian: bagianPanel } : null} onBagian={setBagianPanel}"), "tab bisa dipindah bebas (Ringkasan · Bahan · Foto · Riwayat)");
  assert.ok(w.includes('fokusKelengkapan={fokusPanel === "kelengkapan"}'), "fokus kelengkapan membuka rincian kelengkapan di Ringkasan");
  // daftar: klik baris/kartu membuka profil (pemicu disimpan untuk mengembalikan fokus); fokus bahan hanya lewat tab="bahan"
  for (const k of ["const bukaPanel", "pemicuRef", "unitAktif", "const tutupPanel"]) assert.ok(w.includes(k), k);
  assert.ok(!w.includes("catat-bahan-baris"), "tidak ada tombol Catat bahan per baris");
});
