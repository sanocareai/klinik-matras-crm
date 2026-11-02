// Filter lengkap Order Produksi + Ringkasan (3 Nov 2026): model murni, kesesuaian kontrak dengan backend, dan pengawatan komponen (tanpa DOM). Penyaringan nyata dibuktikan di backend/tests/filterDaftarOrderProduksi.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HUBUNGAN_FILTER_TEKS, KELENGKAPAN_FILTER, PIC_TANPA, POSISI_FILTER, TARGET_FILTER, URUTAN_DAFTAR, bacaHitungKelengkapan, chipFilterAktif, jumlahFilterLainnya, opsiPic, parameterDaftar, sumberKerjaText,
} from "../src/features/production/orderProduksiModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const be = (...p) => fs.readFileSync(path.join(here, "..", "..", "backend", ...p), "utf8");

test("kontrak dengan backend: kunci posisi, nilai target, dan penanda PIC kosong SAMA dengan filterDaftarOrderProduksi.js", () => {
  const b = be("src", "lib", "domain", "filterDaftarOrderProduksi.js");
  const kunciBe = [...b.matchAll(/key: "([A-Z_]+)", label: "([^"]+)"/g)].map((m) => [m[1], m[2]]);
  for (const p of POSISI_FILTER) assert.ok(kunciBe.some(([k, l]) => k === p.key && l === p.label), `posisi ${p.key} sama kunci dan label dengan backend`);
  assert.equal(kunciBe.length, POSISI_FILTER.length, "jumlah posisi sama");
  const targetBe = [...b.matchAll(/key: "([a-z_]+)", label: "([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(TARGET_FILTER.map((t) => [t.key, t.label]), targetBe, "target: kunci, label, dan urutan sama");
  assert.ok(b.includes(`PIC_TANPA = "${PIC_TANPA}"`), "penanda PIC kosong sama");
});

test("parameter daftar: posisi (csv), PIC, target ikut dikirim; kosong tidak dikirim; satu fungsi untuk daftar dan ekspor", () => {
  assert.deepEqual(parameterDaftar({}), {});
  const p = parameterDaftar({ posisi: ["DI_WORKSHOP", "SUDAH_DIJEMPUT"], pic: "Sari Dewi", target: "terlambat", urut: "terlama", dari: "2026-11-01", sampai: "2026-11-03" });
  assert.deepEqual(p, { dari: "2026-11-01", sampai: "2026-11-03", urut: "terlama", posisi: "DI_WORKSHOP,SUDAH_DIJEMPUT", pic: "Sari Dewi", target: "terlambat" });
  assert.deepEqual(parameterDaftar({ posisi: [], pic: "", target: "" }), {});
  assert.equal(parameterDaftar({ pic: PIC_TANPA }).pic, PIC_TANPA);
});

test("chip filter aktif: satu chip per nilai, Aktif/Riwayat/Semua dan Terkirim-bawaan-Riwayat BUKAN filter, urutan bawaan bukan filter", () => {
  assert.deepEqual(chipFilterAktif({ scope: "aktif" }), []);
  assert.deepEqual(chipFilterAktif({ scope: "riwayat", tab: "TERKIRIM" }), [], "status order Terkirim di Riwayat = bawaan antrean");
  const c = chipFilterAktif({ scope: "semua", tab: "DIPROSES", kerja: "TERTUNDA", cari: "hani", dari: "2026-11-01", sampai: "2026-11-03", urut: "terlama", posisi: ["DI_WORKSHOP", "DI_PELANGGAN"], pic: "Rahmat", target: "hari_ini", kelengkapan: ["HPP_BELUM_LENGKAP"] }, { statusOrderLabel: () => "Diproses", fmtTgl: (x) => x });
  assert.deepEqual(c.map((x) => x.label), [
    "Cari: hani", "Status order: Diproses", "Status kerja: Tertunda", "Order masuk: 2026-11-01 – 2026-11-03", "Posisi: Di workshop", "Posisi: Sudah di pelanggan", "PIC: Rahmat", "Target selesai: Hari ini", "Kelengkapan: HPP belum lengkap", "Urutan: Paling lama belum ditangani",
  ]);
  assert.deepEqual(c.filter((x) => x.kelompok === "posisi").map((x) => x.nilai), ["DI_WORKSHOP", "DI_PELANGGAN"], "tiap posisi bisa dihapus sendiri");
  assert.equal(chipFilterAktif({ pic: PIC_TANPA })[0].label, "PIC: Belum ditugaskan");
  assert.equal(new Set(c.map((x) => x.id)).size, c.length, "id chip unik");
});

test("lencana Filter lainnya: tiap kelompok dihitung SATU (posisi/PIC/target/kelengkapan); periode dan urutan di toolbar tidak ikut", () => {
  assert.equal(jumlahFilterLainnya({}), 0);
  assert.equal(jumlahFilterLainnya({ posisi: ["A", "B", "C"], pic: "x", target: "terlambat", kelengkapan: ["HPP_BELUM_LENGKAP", "DATA_ORDER_KURANG"] }), 4);
  assert.equal(jumlahFilterLainnya({ posisi: ["A"] }), 1);
});

test("pilihan PIC: Belum ditugaskan + PIC dari server dengan jumlah; PIC terpilih yang tak ada di hasil tetap tampil (jumlah 0)", () => {
  const h = bacaHitungKelengkapan({ pic: [{ nama: "Rahmat", jumlah: 3 }, { nama: "Sari", jumlah: 1 }], tanpaPic: 2 });
  assert.deepEqual(opsiPic(h).map((o) => o.label), ["Belum ditugaskan · 2", "Rahmat · 3", "Sari · 1"]);
  assert.equal(opsiPic(h)[0].value, PIC_TANPA);
  assert.deepEqual(opsiPic(h, "Dimas").map((o) => o.label).slice(-1), ["Dimas · 0"], "pilihan aktif tidak jatuh ke 'Semua PIC'");
  assert.deepEqual(opsiPic(null).map((o) => o.label), ["Belum ditugaskan"], "belum dimuat: tidak mengarang jumlah");
  assert.deepEqual(bacaHitungKelengkapan({}).pic, []); assert.equal(bacaHitungKelengkapan({}).tanpaPic, 0);
});

test("teks hubungan filter menyatakan DAN/ATAU dan memisahkan periode order masuk dari target selesai", () => {
  assert.ok(/DAN/.test(HUBUNGAN_FILTER_TEKS) && /ATAU/.test(HUBUNGAN_FILTER_TEKS) && /order masuk/.test(HUBUNGAN_FILTER_TEKS) && /target selesai/.test(HUBUNGAN_FILTER_TEKS));
  assert.ok(TARGET_FILTER.every((t) => t.bantu && /\S/.test(t.bantu)), "tiap pilihan target punya definisi");
});

test("sumber status kerja: Selesai dari status order TIDAK diartikan bukti tahap/QC; yang lain tetap singkat", () => {
  assert.equal(sumberKerjaText({ source: "STATUS_ORDER", key: "SELESAI" }), "Mengikuti status order — bukan bukti tahap kerja atau QC");
  assert.equal(sumberKerjaText({ source: "APLIKASI", key: "SELESAI" }), "Dari aplikasi Produksi");
});

test("halaman daftar: filter tidak diduplikasi di klien (server menyaring), Reset tidak menyentuh antrean, respons terlambat diabaikan, filter bertahan", () => {
  const p = src("pages", "bengkel", "ProductionWorkOrders.jsx");
  assert.ok(p.includes("posisi, pic, target, ...rentang }") && p.includes("posisi: posisi.length ? posisi.join(\",\") : undefined, pic: pic || undefined, target: target || undefined"), "daftar DAN hitungan memakai filter yang sama");
  assert.ok(!/rows\.filter\(|\.filter\(\(u\) => .*adopsi/.test(p.replace(/DISPLAY_STATUS_TABS\.filter|tabsShown/g, "")), "klien tidak menyaring baris sendiri");
  const reset = p.match(/const hapusFilter = \(\) => \{([^}]*)\}/)[1];
  for (const s of ["setCari(\"\")", "setKerja(\"\")", "setKelengkapan([])", "setPeriode(periodeSemuaWaktu())", "setUrut(\"terbaru\")", "setPosisi([])", "setPic(\"\")", "setTarget(\"\")"]) assert.ok(reset.includes(s), `Reset: ${s}`);
  assert.ok(!reset.includes("onScopeChange"), "Reset tidak mengganti antrean Aktif/Riwayat/Semua");
  assert.ok(p.includes("const id = ++reqRef.current;") && p.includes("if (id !== reqRef.current) return;"), "respons terlambat dari filter lama diabaikan");
  assert.ok(p.includes("setMuatBaru(!append)") && p.includes("muatBaru && \"memuat\""), "daftar lama diredupkan dan jumlah lama tidak ditampilkan saat filter baru dimuat");
  assert.ok(p.includes("fetchPage(meta.page + 1, { append: true })") && p.includes("queryServer(page)"), "Muat berikutnya memakai filter yang sama");
  assert.ok(p.includes("<ChipFilterAktif chip={chip} onHapus={hapusChip} onReset={hapusFilter}"), "chip bisa dihapus + Reset");
  assert.ok(p.includes("jumlahHasilTeks") && p.includes('data-testid="order-rowcount"'), "jumlah hasil terpisah dari kontrol");
  assert.ok(p.includes('placeholder="Semua status order"') && p.includes('placeholder="Semua status kerja"') && !/Status order\$\{rows/.test(p), "label jelas tanpa angka bercampur");
  assert.ok(p.includes("<PilihanUrutan value={urut} onChange={setUrut} />") && !p.includes("URUTAN_DAFTAR"), "Urutan di toolbar utama, bukan di Filter lainnya");
  assert.ok(p.includes('periode?.preset === PERIODE_BAWAAN && "semua"'), "periode bawaan tanpa kata 'Semua' berulang");
  assert.ok(p.includes("hp && (") && p.includes("<PanelSamping open={lainnyaBuka}") && p.includes("tombolFilterRef.current?.focus"), "HP: lembar filter + fokus kembali ke tombol");
});

test("Pekerjaan: layanan dan ukuran dipisah; layanan lengkap tetap di rincian", () => {
  const p = src("pages", "bengkel", "ProductionWorkOrders.jsx");
  assert.ok(p.includes('className="prod-ol-layanan-nama"') && p.includes('className="prod-ol-ukuran"'), "dua elemen terpisah");
  assert.ok(src("features", "production", "OrderProduksiPanel.jsx").includes("layanan"), "rincian memuat layanan");
});

test("PilihanUrutan: pilihan tunggal tanpa baris kosong; tiap opsi satu kali (sumber duplikat 'Terbaru dulu' = placeholder FilterDropdown)", () => {
  const u = src("features", "production", "PilihanUrutan.jsx");
  assert.ok(u.includes("URUTAN_DAFTAR.map") && !u.includes("filter-dropdown.jsx") && u.includes("aria-label="), "komponen sendiri, berlabel");
  assert.equal(URUTAN_DAFTAR.length, 2); assert.deepEqual(URUTAN_DAFTAR.map((x) => x.key), ["terbaru", "terlama"], "definisi urutan lama dipertahankan");
  assert.equal(URUTAN_DAFTAR[1].label, "Paling lama belum ditangani");
  const f = src("components", "ui", "filter-dropdown.jsx");
  assert.ok(f.includes("onSelect={() => onChange(\"\")}") && f.includes("{placeholder}"), "penyebab duplikat: FilterDropdown selalu menambah baris placeholder di atas opsi");
});

test("FilterLainnya memuat posisi, PIC, target, kelengkapan, dan hubungan filter; semua chip aria-pressed", () => {
  const f = src("features", "production", "FilterLainnya.jsx");
  for (const s of ["POSISI_FILTER.map", "TARGET_FILTER.map", "opsiPic(hitung, pic)", "<KelengkapanFilter", "HUBUNGAN_FILTER_TEKS", "aria-pressed={on}", 'ariaLabel="Saring PIC"']) assert.ok(f.includes(s), s);
  assert.equal(KELENGKAPAN_FILTER.length, 4);
  assert.ok(!f.includes("api."), "tidak menulis");
});

test("Ringkasan: warna KPI sama di terang dan gelap sesuai spesifikasi; Menunggu mulai netral beraksen amber (bukan hijau)", () => {
  const css = src("styles", "sanss-produksi.css");
  const aturan = (sel) => css.split("\n").filter((l) => l.includes(sel)).join("\n");
  assert.ok(/\.prod-kpi\.biru \{ background: #3965FA; color: #FFFFFF; \}/.test(css), "Target hari ini #3965FA teks putih");
  assert.ok(/\.prod-kpi\.muda \{ background: #99B7FC; color: #1B1B39; \}/.test(css), "Selesai hari ini #99B7FC teks #1B1B39");
  assert.ok(/\.prod-kpi\.lavender \{ background: #E9EBFF; color: #1B1B39; \}/.test(css), "Sedang dikerjakan #E9EBFF teks #1B1B39");
  assert.ok(!/data-theme="dark"\][^\n]*\.prod-kpi\.(biru|muda|lavender|lime)/.test(css), "tidak ada penimpaan warna KPI di mode gelap");
  assert.ok(!/\.prod-kpi\.lime/.test(css), "tidak ada KPI hijau-lime");
  assert.ok(/\.prod-kpi\.netral \{[^}]*var\(--crm-panel\)[^}]*#E8A317/.test(css) && aturan(".prod-kpi.netral .prod-kpi-ikon").includes("--prod-kuning-bg"), "Menunggu mulai: bidang netral + aksen amber");
  const r = src("pages", "bengkel", "ProductionRingkasan.jsx");
  assert.ok(r.includes('queue: "netral"') && r.includes('target: "biru"') && r.includes('done: "muda"') && r.includes('active: "lavender"'), "pemetaan KPI → warna");
  // kontras: putih di atas #3965FA ≥ 4,5:1; #1B1B39 di atas #99B7FC dan #E9EBFF ≥ 4,5:1
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const kontras = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  assert.ok(kontras("#FFFFFF", "#3965FA") >= 4.5, `putih/#3965FA = ${kontras("#FFFFFF", "#3965FA").toFixed(2)}`);
  assert.ok(kontras("#1B1B39", "#99B7FC") >= 4.5 && kontras("#1B1B39", "#E9EBFF") >= 4.5, "ink/#99B7FC dan ink/#E9EBFF");
  assert.ok(/\.prod-kpi\.biru \.prod-kpi-label \{ opacity: 1; \}/.test(css), "label kecil di KPI biru tidak diredupkan");
});

test("Ringkasan: panel 'Pekerjaan hari ini' mengikuti tinggi isi dan kolom kanan menampung Posisi unit (tanpa ruang kosong besar); rumus/populasi tak berubah", () => {
  const css = src("styles", "sanss-produksi.css"); const r = src("pages", "bengkel", "ProductionRingkasan.jsx");
  assert.ok(/\.prod-grid-dua \{ align-items: start; \}/.test(css), "tinggi panel mengikuti isi (tidak direnggangkan)");
  assert.ok(r.includes('<div className="prod-kolom">') && r.indexOf('data-testid="pic-card"') < r.indexOf('data-testid="pipeline-strip"') && r.indexOf('data-testid="pipeline-strip"') < r.indexOf('data-testid="jadwal-hari-ini"'), "PIC lalu Posisi unit dalam satu kolom, jadwal di bawah");
  assert.ok(r.includes("bagiTile(summary?.tiles)") && r.includes("summaryFromV2(v2)") && r.includes("jadwalHariIni(v2)"), "sumber data dan rumus Ringkasan tidak diubah");
  const m = src("features", "production", "ringkasanModel.js");
  assert.ok(m.includes("export function bagiTile") && !/\.of\s*=|to:\s*"\/bengkel\/order-produksi\?tab=(?!aktif)/.test(r), "tujuan klik KPI tidak diubah di halaman");
});
