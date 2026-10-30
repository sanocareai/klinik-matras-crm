// LAPORAN PRODUKSI TERPADU (frontend): model murni (tab menurut izin, periode <-> URL, kueri, format, ekspor) + pagar kode halaman.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILTER_KOSONG, TABS, angka, filterUntukTab, rupiahDiketahui, tautanLengkapi, daftarMasalah, durasiTeks, jumlahFilterLanjut, jumlahSeri, normalisasiTab, paramsDariRange, queryEkspor, queryLaporan, rangeDariParams, rupiah, rupiahRingkas, skalaBatang, tabAktif, tabsUntuk } from "../src/features/production/laporan/laporanModel.js";
import { makeCustomRange, makeRange } from "../src/lib/dateRange.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("empat tab persis; tab ditampilkan mengikuti kemampuan dari server; kunci tab lama dipetakan", () => {
  assert.deepEqual(TABS.map((t) => t.key), ["ringkasan", "biaya", "kinerja", "bahan"]);
  assert.deepEqual(TABS.map((t) => t.label), ["Ringkasan", "Biaya per Order", "Kinerja Produksi", "Bahan & Gudang"]);
  assert.deepEqual(tabsUntuk({ ringkasan: true, biayaOrder: true, kinerja: true, bahanGudang: true }).map((t) => t.key), ["ringkasan", "biaya", "kinerja", "bahan"]);
  assert.deepEqual(tabsUntuk({ bahanGudang: true }).map((t) => t.key), ["bahan"], "Gudang hanya Bahan & Gudang");
  assert.deepEqual(tabsUntuk({}), []);
  for (const [lama, baru] of Object.entries({ meja: "kinerja", pic: "kinerja", gudang: "bahan", laporan: "biaya", produksi: "ringkasan", ringkasan: "ringkasan", xx: "ringkasan" })) assert.equal(normalisasiTab(lama), baru, lama);
  assert.equal(tabAktif("gudang", tabsUntuk({ bahanGudang: true })).key, "bahan"); assert.equal(tabAktif("biaya", tabsUntuk({ bahanGudang: true })).key, "bahan", "tab di luar izin jatuh ke tab yang boleh");
});

test("periode <-> URL: preset, kustom, dan tidak valid; kunci lain dipertahankan; round-trip identik", () => {
  const p = new URLSearchParams("tab=biaya&x=1");
  const kustom = makeCustomRange("2026-10-01", "2026-10-15"); const u = paramsDariRange(p, kustom);
  assert.equal(u.get("preset"), "custom"); assert.equal(u.get("dari"), "2026-10-01"); assert.equal(u.get("sampai"), "2026-10-15"); assert.equal(u.get("tab"), "biaya"); assert.equal(u.get("x"), "1");
  const r = rangeDariParams(u); assert.equal(r.from, "2026-10-01"); assert.equal(r.to, "2026-10-15"); assert.equal(r.preset, "custom");
  const pre = makeRange("last_7_days"); const u2 = paramsDariRange(new URLSearchParams(), pre); assert.equal(u2.get("preset"), "last_7_days"); assert.equal(u2.get("dari"), null);
  const r2 = rangeDariParams(u2); assert.equal(r2.preset, "last_7_days"); assert.equal(r2.from, pre.from); assert.equal(r2.to, pre.to);
  assert.equal(rangeDariParams(new URLSearchParams("preset=custom&dari=bukan&sampai=tanggal")).preset, "last_30_days", "tidak valid → 30 hari terakhir");
  assert.equal(rangeDariParams(new URLSearchParams()).preset, "last_30_days");
  const bersih = paramsDariRange(u, pre); assert.equal(bersih.get("dari"), null, "kunci periode lama dibersihkan");
});

test("kueri API: periode + filter; ekspor mengikuti tab, periode, dan filter aktif (parameter SAMA dengan layar)", () => {
  const r = makeCustomRange("2026-10-01", "2026-10-15");
  assert.equal(queryLaporan(r, FILTER_KOSONG), "from=2026-10-01&to=2026-10-15");
  const f = { ...FILTER_KOSONG, q: " RES-1 ", status: "PARSIAL", masalah: "TANPA_HARGA", alasan: "TANPA_PEMAKAIAN", urut: "nilai", hanyaPemakaian: true };
  const qs = queryLaporan(r, f); const sp = new URLSearchParams(qs);
  assert.equal(sp.get("q"), "RES-1"); assert.equal(sp.get("status"), "PARSIAL"); assert.equal(sp.get("masalah"), "TANPA_HARGA"); assert.equal(sp.get("urut"), "nilai"); assert.equal(sp.get("hanyaPemakaian"), "1"); assert.equal(sp.get("alasan"), "TANPA_PEMAKAIAN"); assert.equal(new URLSearchParams(queryLaporan(r, FILTER_KOSONG)).get("hanyaPemakaian"), null, "lingkup bawaan = PENUH (tanpa parameter)");
  assert.equal(queryEkspor("biaya", r, { ...FILTER_KOSONG, qOrder: " RES-1 ", status: "PARSIAL", masalah: "TANPA_HARGA", alasan: "TANPA_PEMAKAIAN", urut: "nilai", hanyaPemakaian: true }), `tab=biaya-order&${qs}`); assert.equal(queryEkspor("bahan", r, FILTER_KOSONG), "tab=bahan-gudang&from=2026-10-01&to=2026-10-15");
  assert.equal(new URLSearchParams(queryLaporan(r, { ...FILTER_KOSONG, peran: "CORNER" })).get("peran"), "CORNER");
  assert.equal(jumlahFilterLanjut(FILTER_KOSONG), 0); assert.equal(jumlahFilterLanjut(f), 5);
});

test("format: nilai tidak diketahui = '—' (bukan Rp 0); rupiah/angka/durasi", () => {
  assert.equal(rupiah(null), "—"); assert.equal(rupiah(undefined), "—"); assert.match(rupiah(0), /^Rp\s0$/); assert.match(rupiah(1250000), /^Rp\s1\.250\.000$/);
  assert.equal(angka(null), "—"); assert.match(rupiahRingkas(2_500_000), /2,5 jt/); assert.equal(rupiahRingkas(null), "—");
  assert.equal(durasiTeks({ n: 0, rataMenit: null, catatan: "Belum tersedia" }), "Belum tersedia"); assert.match(durasiTeks({ n: 4, rataMenit: 135 }), /2 j 15 mnt \(n=4\)/); assert.match(durasiTeks({ n: 2, rataMenit: null, catatan: "Data belum cukup (n=2, minimal 3)" }), /belum cukup/);
});

test("daftar masalah berurut, hanya > 0; grafik: skala aman untuk semua nol; jumlah seri = total", () => {
  const d = { A: { label: "a", aksi: "x" } };
  assert.deepEqual(daftarMasalah({ A: 2, B: 5, C: 0 }, d).map((m) => m.key), ["B", "A"]); assert.equal(daftarMasalah({ A: 2 }, d)[0].aksi, "x");
  assert.deepEqual(skalaBatang([{ nilai: 0 }, { nilai: 0 }]).map((s) => s.pct), [0, 0]); assert.deepEqual(skalaBatang([{ nilai: 5 }, { nilai: 10 }]).map((s) => s.pct), [50, 100]);
  assert.equal(jumlahSeri([{ nilai: 1.1 }, { nilai: 2.2 }]), 3.3);
});

test("pagar kode: empat tab, DateRangePicker standar (tanpa date picker baru), periode di URL, Export mengikuti tab, grafik ≤ 2 per tampilan, definisi lewat ikon info, target lewat aksi Pengaturan target", () => {
  const shell = read("src/features/production/laporan/LaporanProduksi.jsx"); const parts = read("src/features/production/laporan/parts.jsx");
  assert.match(shell, /import DateRangePicker from "@\/components\/DateRangePicker\.jsx"/); assert.doesNotMatch(shell + parts, /type="date"/, "tanpa input tanggal native / date picker baru");
  assert.match(shell, /rangeDariParams\(params\)/); assert.match(shell, /paramsDariRange\(p, nextRange\)/, "periode tercermin di URL"); assert.match(shell, /queryEkspor\(tab\.key, range, filters\)/, "Export mengikuti tab, periode, filter");
  assert.match(shell, /useState\(urlTab\)/, "tab aktif di state lokal (sistem tab dalam-app)"); assert.match(shell, /Pengaturan target/); assert.match(shell, /TargetPanel/);
  assert.doesNotMatch(shell, /<TargetPanel[^>]*\/>\s*<\/PageBody>/, "formulir target tidak lagi di bawah ringkasan");
  const grafik = (f) => (read(`src/features/production/laporan/${f}`).match(/<Grafik\b/g) || []).length;
  assert.ok(grafik("TabRingkasan.jsx") <= 2 && grafik("TabKinerja.jsx") <= 2 && grafik("TabBiaya.jsx") <= 2 && grafik("TabBahan.jsx") <= 2, "maksimal dua grafik per tampilan");
  assert.match(read("src/features/production/laporan/TabRingkasan.jsx"), /info=\{info\(/, "definisi lewat ikon info");
  for (const f of ["TabRingkasan", "TabBiaya", "TabKinerja", "TabBahan", "LaporanProduksi", "parts"]) assert.doesNotMatch(read(`src/features/production/laporan/${f}.jsx`), /method:\s*"(POST|PUT|PATCH|DELETE)"/, `${f} baca-saja`);
  const api = read("src/api.js"); const blok = api.slice(api.indexOf("getLaporanMeta"), api.indexOf("getLaporanMeta") + 1600);
  assert.match(blok, /laporan\/export/); assert.doesNotMatch(blok.replace(/exportLaporan[\s\S]*$/, ""), /method:/);
});

test("pagar kode: filter lanjutan terlipat (details), tabel panjang punya paginasi server, kartu mobile untuk Biaya per Order, rincian order memuat kolom wajib", () => {
  const biaya = read("src/features/production/laporan/TabBiaya.jsx");
  assert.match(biaya, /PanelLanjut/); assert.match(biaya, /<Paginasi/); assert.match(biaya, /md:hidden/); assert.match(biaya, /hidden min-w-0 overflow-x-auto rounded-card bg-surface md:block/);
  for (const k of ["Jumlah", "Harga", "Subtotal", "Tgl pemakaian", "Harga sejak", "Status · sumber", "catatan-guard", "catatan-finance", "rincian-masalah"]) assert.ok(biaya.includes(k), k);
  assert.match(read("src/features/production/laporan/parts.jsx"), /<details/);
});

test("filter per tab: pencarian order tidak menyaring tab Bahan (dan sebaliknya); hanya filter yang berlaku dikirim; Export memakai filter tab itu", () => {
  const f = { ...FILTER_KOSONG, qOrder: "RES-1", qBahan: "BUSA", status: "PARSIAL", peran: "CORNER" };
  assert.deepEqual(filterUntukTab("bahan", f), { q: "BUSA" }); assert.equal(filterUntukTab("biaya", f).q, "RES-1"); assert.equal(filterUntukTab("biaya", f).status, "PARSIAL");
  assert.deepEqual(filterUntukTab("kinerja", f), { peran: "CORNER" }); assert.deepEqual(filterUntukTab("ringkasan", f), {});
  const r = makeCustomRange("2026-10-01", "2026-10-15");
  assert.equal(new URLSearchParams(queryEkspor("bahan", r, f)).get("q"), "BUSA"); assert.equal(new URLSearchParams(queryEkspor("bahan", r, f)).get("status"), null);
  assert.equal(new URLSearchParams(queryEkspor("biaya", r, f)).get("q"), "RES-1");
});

test("nilai yang belum diketahui tidak tampil sebagai Rp 0", () => {
  assert.equal(rupiahDiketahui(0, false), "Belum diketahui"); assert.match(rupiahDiketahui(0, true), /^Rp\s0$/); assert.match(rupiahDiketahui(215000, true), /215\.000/);
  const biaya = fs.readFileSync(path.join(root, "src/features/production/laporan/TabBiaya.jsx"), "utf8");
  assert.ok(biaya.includes('d.status === "BELUM_DIKETAHUI" ? "Belum diketahui" : rupiah(d.total.nilaiDiketahui)')); assert.ok(biaya.includes("rupiahDiketahui(u.ringkas.nilaiDiketahui, unitAdaNilai(u))"));
});

test("aturan tampilan baru: Lengkapi → Order Produksi?q=; selesai = posisi/bertanggal/tanpa tanggal (bukan 0); PIC berlabel penugasan + cakupan; SANO GUARD tidak disembunyikan; lingkup order bawaan penuh", () => {
  assert.equal(tautanLengkapi("RES-1 A/B"), "/bengkel/order-produksi?q=RES-1%20A%2FB");
  const wo = read("src/pages/bengkel/ProductionWorkOrders.jsx"); assert.ok(wo.includes('new URLSearchParams(window.location.search).get("q")'), "Order Produksi menerima ?q= dari tautan Lengkapi");
  const biaya = read("src/features/production/laporan/TabBiaya.jsx"); assert.ok(biaya.includes("data-testid={`lengkapi-${o.orderNumber}`}")); assert.ok(biaya.includes("filter-hanya-pemakaian")); assert.ok(!/filter-masuk|termasukMasuk/.test(biaya), "tidak ada lagi opsi yang menyembunyikan order tanpa pemakaian secara bawaan");
  assert.ok(biaya.includes("tanda-guard") && biaya.includes("termasuk SANO GUARD")); assert.ok(!/SANO GUARD[^.<]{0,60}tidak dihitung/.test(biaya + read("src/features/production/laporan/TabBahan.jsx")), "SANO GUARD tidak diberi label tidak dihitung");
  const kin = read("src/features/production/laporan/TabKinerja.jsx"); for (const k of ["tanpa tanggal tercatat", "posisi saat ini", "label-penugasan", "cakupan-pic", "bukan berarti tidak ada produksi"]) assert.ok(kin.includes(k), k);
  const rg = read("src/features/production/laporan/TabRingkasan.jsx"); for (const k of ["tanpa tanggal tercatat", "catatan-tanpa-tanggal", "dasar-lingkup"]) assert.ok(rg.includes(k), k);
});
