// Order Produksi — adopsi Admin (frontend): model murni (tiga sumbu, rencana bahan, galat) + pengawatan komponen. Server tetap penentu; di sini dijaga yang rawan salah di layar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KERJA_FILTER, adaPerubahan, badanRencana, barisEditor, dariRencana, formatJumlah, hapusBaris, kelompokkan, ketersediaanNada, ketersediaanText, kunciIdempoten, nadaBadge, parameterDaftar, parseJumlah,
  pesanGalatAdopsi, ringkasAdopsi, ringkasPilihan, sumberKerjaText, tambahBaris, ubahJumlah, validasiBaris, waktuWib,
} from "../src/features/production/orderProduksiModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const busa = { materialId: "11111111-1111-4111-8111-111111111111", kode: "BS-1", nama: "Busa HR", satuan: "SHEET", kelompok: { kode: "BUSA", label: "Busa" }, tersedia: 40, saldoDiketahui: true, keadaan: "ADA" };
const kain = { materialId: "22222222-2222-4222-8222-222222222222", kode: "KN-1", nama: "Kain Knit", satuan: "METER", kelompok: { kode: "KAIN", label: "Kain" }, tersedia: 5, saldoDiketahui: true, keadaan: "MENIPIS" };
const plastik = { materialId: "33333333-3333-4333-8333-333333333333", kode: "PL-1", nama: "Plastik", satuan: "ROLL", kelompok: { kode: "LAINNYA", label: "Lainnya" }, tersedia: null, saldoDiketahui: false, keadaan: "BELUM_ADA_CATATAN" };

test("jumlah: parse koma/titik Indonesia, format maksimal 4 desimal, tak valid = null", () => {
  assert.equal(parseJumlah("2,5"), 2.5); assert.equal(parseJumlah("2.5"), 2.5); assert.equal(parseJumlah("1.250,75"), 1250.75); assert.equal(parseJumlah(" 3 "), 3);
  assert.equal(parseJumlah(""), null); assert.equal(parseJumlah("abc"), null); assert.equal(parseJumlah(null), null);
  assert.equal(formatJumlah(2.5), "2,5"); assert.equal(formatJumlah(120), "120"); assert.equal(formatJumlah(0.12345), "0,1235"); assert.equal(formatJumlah(null), "—");
});

test("ketersediaan: saldo tidak diketahui TIDAK tampil sebagai nol; minus/habis/menipis punya teks jujur", () => {
  assert.equal(ketersediaanText(plastik), "Stok belum diketahui"); assert.doesNotMatch(ketersediaanText(plastik), /\b0\b/);
  assert.equal(ketersediaanText({ ...busa, tersedia: 0, keadaan: "NOL_TERHITUNG" }), "Habis menurut catatan");
  assert.match(ketersediaanText({ ...busa, tersedia: -4, keadaan: "MINUS" }), /minus/);
  assert.match(ketersediaanText(busa), /Tersedia 40 SHEET/);
  assert.equal(ketersediaanNada(plastik), "neutral"); assert.equal(ketersediaanNada(busa), "green"); assert.equal(ketersediaanNada(kain), "orange"); assert.equal(ketersediaanNada({ ...busa, keadaan: "MINUS", tersedia: -1 }), "red");
  assert.equal(ketersediaanText(null), "Stok belum diketahui");
});

test("editor rencana: tanpa duplikat, validasi jumlah > 0, badan PUT numerik, deteksi perubahan tak peduli urutan", () => {
  let b = []; b = tambahBaris(b, busa); b = tambahBaris(b, busa); b = tambahBaris(b, kain);
  assert.equal(b.length, 2, "bahan yang sama tidak dobel");
  assert.equal(validasiBaris(b).ok, false); assert.equal(validasiBaris(b).galat[busa.materialId], "Isi jumlah");
  b = ubahJumlah(b, busa.materialId, "0"); assert.equal(validasiBaris(b).galat[busa.materialId], "Jumlah harus lebih dari 0");
  b = ubahJumlah(ubahJumlah(b, busa.materialId, "3,5"), kain.materialId, "6"); assert.equal(validasiBaris(b).ok, true);
  assert.deepEqual(badanRencana(b), [{ materialId: busa.materialId, qty: 3.5 }, { materialId: kain.materialId, qty: 6 }]);
  const tersimpan = [{ materialId: kain.materialId, qty: 6 }, { materialId: busa.materialId, qty: 3.5 }];
  assert.equal(adaPerubahan(b, tersimpan), false, "urutan tidak berarti");
  assert.equal(adaPerubahan(ubahJumlah(b, kain.materialId, "7"), tersimpan), true);
  assert.equal(adaPerubahan(hapusBaris(b, kain.materialId), tersimpan), true);
  assert.equal(adaPerubahan([], []), false);
  assert.deepEqual(dariRencana([{ ...busa, qty: 2 }])[0].qty, "2");
});

test("ringkasan pilihan menetap: jumlah bahan, per kelompok, melebihi stok, stok belum diketahui; pengelompokan mengikuti urutan katalog", () => {
  let b = [busa, kain, plastik].reduce((acc, m) => tambahBaris(acc, m), []);
  b = ubahJumlah(ubahJumlah(ubahJumlah(b, busa.materialId, "3"), kain.materialId, "9"), plastik.materialId, "1");
  const r = ringkasPilihan(b);
  assert.equal(r.jumlahBahan, 3); assert.deepEqual(r.melebihiStok, [kain.materialId], "9 > tersedia 5"); assert.equal(r.jumlahStokTidakDiketahui, 1);
  assert.deepEqual(r.perKelompok.map((k) => [k.kode, k.jumlah]).sort(), [["BUSA", 1], ["KAIN", 1], ["LAINNYA", 1]]);
  const g = kelompokkan(b, [{ kode: "KAIN" }, { kode: "BUSA" }, { kode: "LAINNYA" }]); assert.deepEqual(g.map((x) => x.kode), ["KAIN", "BUSA", "LAINNYA"]);
  assert.equal(barisEditor({ materialId: "x", nama: "n" }).saldoDiketahui, false, "tanpa data ketersediaan = belum diketahui, bukan nol");
});

test("galat: konflik revisi menawarkan muat ulang; status kerja dipegang aplikasi = info; jaringan = isian aman; tanpa izin", () => {
  const k = pesanGalatAdopsi({ code: "RIWAYAT_BERUBAH", message: "Rencana sudah direvisi" }); assert.equal(k.jenis, "konflik"); assert.equal(k.muatUlang, true); assert.match(k.petunjuk, /Muat ulang/);
  const a = pesanGalatAdopsi({ code: "KERJA_DIPEGANG_APLIKASI", message: "x" }); assert.equal(a.jenis, "info"); assert.match(a.petunjuk, /mengikuti aplikasi/);
  assert.equal(pesanGalatAdopsi({ code: "CATATAN_WAJIB", message: "wajib" }).jenis, "validasi");
  assert.match(pesanGalatAdopsi({ message: "Koneksi timeout — coba lagi" }).petunjuk, /tidak akan tersimpan dua kali/);
  assert.equal(pesanGalatAdopsi({ status: 403, message: "x" }).jenis, "izin"); assert.equal(pesanGalatAdopsi(null).teks, "");
  assert.equal(pesanGalatAdopsi({ code: "IDEMPOTENCY_IN_PROGRESS" }).muatUlang, true);
});

test("kunci idempotensi: unik per niat, panjang 12–128 (kontrak server)", () => {
  const a = kunciIdempoten("pakai"), b = kunciIdempoten("pakai"); assert.notEqual(a, b); assert.ok(a.length >= 12 && a.length <= 128); assert.match(a, /^pakai-/);
});

test("ringkasan baris daftar: payload lama tanpa adopsi = '—' jujur (tidak menebak); sumber status kerja dilabeli", () => {
  assert.equal(ringkasAdopsi({}).ada, false); assert.equal(ringkasAdopsi(null).kerja, null);
  const a = ringkasAdopsi({ adopsi: { statusOrder: { label: "Diproses" }, posisi: { key: "SUDAH_DIJEMPUT" }, kerja: { key: "DIKERJAKAN", label: "Dikerjakan", source: "MANUAL", detail: "Dicatat manual oleh Rina, 20 Okt 2026, 10.30 WIB" }, tindakan: { label: "x" }, targetSelesai: { at: "2026-10-26T00:00:00Z" }, pic: { nama: "Bayu" }, meja: "TABLE_2" } });
  assert.equal(a.ada, true); assert.equal(a.pic.nama, "Bayu");
  assert.match(sumberKerjaText(a.kerja), /Dicatat manual oleh Rina/); assert.equal(sumberKerjaText({ source: "APLIKASI" }), "Dari aplikasi Produksi");
  assert.equal(sumberKerjaText({ source: "STATUS_ORDER", key: "SELESAI" }), "Mengikuti status order"); assert.equal(sumberKerjaText({ source: "STATUS_ORDER", key: "DIBATALKAN" }), null); assert.equal(sumberKerjaText({ source: "JADWAL" }), null);
  assert.equal(nadaBadge("orange"), "orange"); assert.equal(nadaBadge("ungu"), "neutral");
});

test("parameter daftar = parameter ekspor (SATU fungsi): status kerja berformat CSV; kosong tidak dikirim; waktu WIB terbaca", () => {
  assert.deepEqual(parameterDaftar({ q: "ibu", kerja: ["DIKERJAKAN", "SELESAI"], scope: "aktif" }), { q: "ibu", statusKerja: "DIKERJAKAN,SELESAI", scope: "aktif" });
  assert.deepEqual(parameterDaftar({}), {}); assert.deepEqual(parameterDaftar({ kerja: [] }), {});
  assert.deepEqual(KERJA_FILTER.map((k) => k.key), ["BELUM_DIJADWALKAN", "DIJADWALKAN", "DIKERJAKAN", "TERTUNDA", "MENUNGGU_QC", "DIKERJAKAN_ULANG", "SELESAI"]);
  assert.equal(waktuWib("2026-10-20T03:30:00.000Z"), "20 Okt 2026, 10.30 WIB"); assert.equal(waktuWib(null), "—"); assert.equal(waktuWib("bukan-tanggal"), "—");
});

// ───────────────────────────── pengawatan komponen ─────────────────────────────
const WO = strip(src("pages", "bengkel", "ProductionWorkOrders.jsx"));
const PANEL = strip(src("features", "production", "OrderProduksiPanel.jsx"));
const EDITOR = strip(src("features", "production", "MaterialPlanEditor.jsx"));
const API = src("api.js");

test("daftar: kolom Status order · Status kerja · Target · PIC · Tindakan; filter status kerja di server; ekspor memakai parameter yang SAMA; kosong/galat/loading ada", () => {
  for (const h of ["Status order", "Status kerja", "Target selesai", "PIC", "Tindakan berikutnya"]) assert.match(WO, new RegExp(`<TH>${h}</TH>`));
  assert.match(WO, /parameterDaftar\(\{ q: qDebounced \|\| undefined, kerja: kerja \? \[kerja\] : \[\] \}\)/);
  assert.match(WO, /api\.eksporOrderProduksiXlsx\(\{ displayStatus: displayParam, \.\.\.paramDaftar,/, "ekspor = daftar yang sama");
  assert.match(WO, /\.\.\.paramDaftar, page: String\(page\)/, "daftar memakai paramDaftar yang sama");
  assert.match(WO, /data-testid="order-export-excel"/); assert.match(WO, /data-testid="order-filter-kerja"/);
  assert.match(WO, /TableSkeletonRows/); assert.match(WO, /Tidak ada unit yang cocok/); assert.match(WO, /Hapus filter/);
  assert.match(WO, /data-testid="posisi-perhatian"/, "posisi yang perlu perhatian tampil terpisah dari status order");
  assert.match(WO, /className="hidden lg:block"/); assert.match(WO, /ul className="m-0 list-none divide-y divide-line p-0 lg:hidden"/, "tabel desktop, kartu kerja di HP");
  assert.match(WO, /Berikutnya:/, "kartu HP memuat tindakan berikutnya");
  assert.doesNotMatch(WO, /transition-all|animate-bounce/); assert.match(WO, /motion-reduce:/);
});

test("panel: urutan ringkasan+tindakan → status&target → pemakaian aktual → rencana bahan (opsional, terlipat) → riwayat → lanjutan; tiga status berlabel; Rencana vs Aktual dibedakan tegas", () => {
  const order = ["panel-ringkasan", "panel-lompat", 'id="sec-status"', 'id="sec-aktual"', 'id="sec-rencana-wrap"', 'id="sec-riwayat"', "panel-lanjutan"].map((k) => PANEL.indexOf(k));
  assert.ok(order.every((x) => x > 0) && order.every((x, i) => i === 0 || x > order[i - 1]), `urutan bagian: ${order}`);
  for (const t of ["Status order", "Posisi unit", "Status kerja"]) assert.match(PANEL, new RegExp(t));
  assert.match(EDITOR, /Rencana · tidak mengurangi stok/);
  // dampak stok dijelaskan PER SUMBER di komponen bersama (bukan satu lencana "mengurangi stok" untuk semuanya)
  const BAGIAN = strip(src("features", "production", "bahan", "PemakaianAktualBagian.jsx")); const BARU = strip(src("features", "production", "bahan", "CatatBahanBaru.jsx"));
  assert.match(BAGIAN, /KARTU_SUMBER\.gudang/); assert.match(BARU, /stok Gudang <b>berkurang<\/b> saat Anda konfirmasi/); assert.match(BARU, /Konfirmasi & kurangi stok/);
  assert.match(PANEL, /Buka Unit 360/, "akses data lama & Unit 360 dipertahankan");
  assert.match(PANEL, /Dicatat manual oleh \{r\.by/, "jejak 'Dicatat manual oleh [nama], [waktu]'");
});

test("panel: status order lewat api.updateOrder (jalur Sales yang sama) dengan konfirmasi; catat manual memakai expectedLatestId; pemakaian aktual membawa Idempotency-Key per niat", () => {
  assert.match(PANEL, /api\.updateOrder\(u\.order\.id, \{ status: "READY"/); assert.match(PANEL, /api\.updateOrder\(u\.order\.id, \{ status: orderPilih/);
  assert.match(PANEL, /Ubah status order .* menjadi Siap Kirim\?/); assert.match(PANEL, /Sales dan Delivery akan melihat status yang sama/);
  assert.match(PANEL, /api\.postStatusKerjaManual\(u\.id, \{ status: kerja, note: catatan\.trim\(\) \|\| undefined, expectedLatestId: km\.terakhirId \}\)/);
  const BARU2 = strip(src("features", "production", "bahan", "CatatBahanBaru.jsx"));
  assert.match(BARU2, /kunciIdempoten\("pakai"\)/); assert.match(BARU2, /api\.addUnitMaterial\(unitId, \{ materialId: b\.materialId, qty: v, note: catatan\.trim\(\) \|\| undefined \}, kunciUntuk\(b\)\)/);
  assert.match(BARU2, /cur\.sig !== sig/, "isian berubah = kunci baru; isian sama (retry) = kunci sama");
  assert.match(PANEL, /disabled=\{!izin\.statusOrder \|\| !aktif/, "akun hanya-lihat: kontrol mati"); assert.match(strip(src("features", "production", "bahan", "PemakaianAktualBagian.jsx")), /Akun Anda hanya bisa melihat/);
  assert.match(PANEL, /Menunggu kain dari supplier|Mis\. menunggu kain dari supplier/);
});

test("editor rencana: pilih per kelompok ATAU cari seluruh katalog; ringkasan menetap; konflik revisi → muat versi terbaru; simpan memakai revisi yang dilihat; target sentuh ≥ 40px", () => {
  assert.match(EDITOR, /api\.getKatalogBahanProduksi\(\{ q: cariTunda \|\| undefined, kelompok: cariTunda \? undefined : kelompok \|\| undefined/);
  assert.match(EDITOR, /api\.putRencanaBahan\(unitId, \{ lines: badanRencana\(baris\), expectedRevision: plan\?\.revision \?\? 0/);
  assert.match(EDITOR, /data-testid="rencana-bilah"/); assert.match(EDITOR, /sticky bottom-0/); assert.match(EDITOR, /data-testid="rencana-ringkasan"/);
  assert.match(EDITOR, /Buang isian &amp; muat versi terbaru/); assert.match(EDITOR, /Stok tidak berubah/);
  assert.match(EDITOR, /Melebihi stok tersedia saat ini/); assert.match(EDITOR, /aria-label=\{`Hapus \$\{b\.nama\} dari rencana`\}/); assert.match(EDITOR, /aria-label="Alasan revisi"/);
  assert.ok((EDITOR.match(/min-h-\[4[04]px\]|h-1[01]/g) || []).length >= 6, "target sentuh besar di tombol/isian");
  assert.match(EDITOR, /motion-reduce:animate-none/);
  assert.doesNotMatch(EDITOR, /api\.addUnitMaterial|stockMovement/, "editor rencana tidak menyentuh stok");
});

test("api: fungsi baru terdaftar; Idempotency-Key opsional pada addUnitMaterial; ekspor mengunduh blob .xlsx dengan penanganan 401/galat", () => {
  for (const f of ["getUnitAdopsi", "postStatusKerjaManual", "getKatalogBahanProduksi", "putRencanaBahan", "eksporOrderProduksiXlsx"]) assert.match(API, new RegExp(`${f}:`));
  assert.match(API, /addUnitMaterial: \(unitId, \{ materialId, qty, note, alasanPembetulan \} = \{\}, idempotencyKey = null\)/); /* alasanPembetulan: opsional, hanya dikirim bila ada (unit selesai) */ assert.match(API, /"Idempotency-Key": idempotencyKey/);
  assert.match(API, /\/production\/work-orders\/export\.xlsx/);
});

test("label status: 'Belum Masuk Alur' tidak lagi dipakai; 'Status unit' ambigu diganti 'Status order'", () => {
  assert.doesNotMatch(src("features", "bengkel", "unitStatus.js").replace(/\/\/.*$/gm, ""), /Belum Masuk Alur/);
  assert.match(src("features", "production", "unitOrderFallbackModel.js"), /\["Status order",/); assert.doesNotMatch(src("features", "production", "unitOrderFallbackModel.js").replace(/\/\/.*$/gm, ""), /\["Status unit"/);
});
