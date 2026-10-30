// SATU periode laporan untuk tab Marketing (dulu Traffic/Akuisisi/Iklan) + state URL. Menutup bug 26 Okt 2026: filter global 1–26 Okt vs Akuisisi 26 Sep–25 Okt (state sendiri per tab).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { periodeTab, saranRentang, bacaUrlLaporan, tulisUrlLaporan, samaRentang, sumberAkuisisiDariTraffic, jalurRincian, teksPeriode, tglValid, tambahHari, MAKS_HARI_PERIODE } from "../src/features/laporan/periodeLaporan.js";

const HARI_INI = "2026-10-26";
const TABS = ["Ringkasan", "Sales", "Marketing", "Performa Tim", "Pipeline"];

test("periodeTab: rentang valid memakai range global apa adanya (1–26 Okt), hari berjalan ditandai — tidak pernah diganti 30 hari sendiri", () => {
  const p = periodeTab({ from: "2026-10-01", to: "2026-10-26" }, HARI_INI);
  assert.deepEqual([p.ok, p.dari, p.sampai, p.hari, p.termasukHariBerjalan], [true, "2026-10-01", "2026-10-26", 26, true]);
  const q = periodeTab({ from: "2026-09-26", to: "2026-10-25" }, HARI_INI);
  assert.deepEqual([q.ok, q.hari, q.termasukHariBerjalan], [true, 30, false]);
});

test("periodeTab: tanpa batas ('Semua'), terbalik, masa depan, >93 hari, tanggal tak valid → ditolak dengan alasan eksplisit (bukan diganti diam-diam)", () => {
  assert.equal(periodeTab({ from: null, to: null }, HARI_INI).kode, "TANPA_BATAS");
  assert.equal(periodeTab(null, HARI_INI).kode, "TANPA_BATAS");
  assert.equal(periodeTab({ from: "2026-10-10", to: "2026-10-01" }, HARI_INI).kode, "TERBALIK");
  assert.equal(periodeTab({ from: "2026-10-20", to: "2026-10-30" }, HARI_INI).kode, "MASA_DEPAN");
  assert.equal(periodeTab({ from: "2026-02-30", to: "2026-03-01" }, HARI_INI).kode, "TANGGAL_TIDAK_VALID");
  const panjang = periodeTab({ from: "2026-07-01", to: "2026-10-25" }, HARI_INI);
  assert.deepEqual([panjang.ok, panjang.kode, panjang.hari], [false, "TERLALU_PANJANG", 117]);
  assert.equal(periodeTab({ from: tambahHari(HARI_INI, -(MAKS_HARI_PERIODE - 1)), to: HARI_INI }, HARI_INI).ok, true, "tepat 93 hari boleh");
  assert.equal(periodeTab({ from: tambahHari(HARI_INI, -MAKS_HARI_PERIODE), to: HARI_INI }, HARI_INI).ok, false);
});

test("saranRentang: 7 & 30 hari PENUH berakhir kemarin (tidak memuat hari ini) → lolos periodeTab tanpa hari berjalan", () => {
  const s = saranRentang(HARI_INI);
  assert.deepEqual(s.map((x) => [x.dari, x.sampai]), [["2026-10-19", "2026-10-25"], ["2026-09-26", "2026-10-25"]]);
  for (const x of s) { const p = periodeTab({ from: x.dari, to: x.sampai }, HARI_INI); assert.equal(p.ok, true); assert.equal(p.termasukHariBerjalan, false); }
});

test("URL: bacaUrlLaporan hanya menerima nilai valid; tulisUrlLaporan menjaga parameter lain dan menghapus yang tidak relevan", () => {
  const a = bacaUrlLaporan("?tab=Marketing&dari=2026-10-01&sampai=2026-10-26&sumber=TIKTOK", TABS);
  assert.deepEqual([a.tab, a.dari, a.sampai, a.sumber, a.tabLama], ["Marketing", "2026-10-01", "2026-10-26", "TIKTOK", false]);
  const x = bacaUrlLaporan("?tab=Bukan&dari=2026-10-30&sampai=2026-10-01&sumber=<x>", TABS);
  assert.deepEqual([x.tab, x.dari, x.sampai, x.sumber], [null, null, null, null], "tab asing, rentang terbalik, sumber berbahaya → diabaikan");
  assert.deepEqual(bacaUrlLaporan("?dari=2026-10-01", TABS).dari, null, "satu sisi saja tidak dianggap rentang");
  const u = tulisUrlLaporan("?x=1&sumber=META", { tab: "Marketing", range: { from: "2026-10-01", to: "2026-10-26" }, sumber: "TIKTOK" });
  assert.equal(u.get("x"), "1"); assert.equal(u.get("tab"), "Marketing"); assert.equal(u.get("dari"), "2026-10-01"); assert.equal(u.get("sampai"), "2026-10-26"); assert.equal(u.get("sumber"), "TIKTOK");
  const lain = tulisUrlLaporan(u, { tab: "Sales", range: { from: "2026-10-01", to: "2026-10-26" }, sumber: "TIKTOK" });
  assert.equal(lain.get("sumber"), null, "sumber hanya bermakna di tab Marketing"); assert.equal(lain.get("dari"), "2026-10-01", "periode TIDAK berubah saat pindah tab");
  const ringkasan = tulisUrlLaporan(lain, { tab: "Ringkasan", range: { from: null, to: null } });
  assert.equal(ringkasan.get("tab"), null); assert.equal(ringkasan.get("dari"), null, "Semua = tanpa dari/sampai");
});

test("state tunggal: roundtrip URL → baca → tulis tidak mengubah periode (refresh, Back, buka detail, ganti tab)", () => {
  let url = tulisUrlLaporan("", { tab: "Marketing", range: { from: "2026-10-01", to: "2026-10-26" } });
  for (const langkah of [{ tab: "Marketing", sumber: "META" }, { tab: "Sales" }, { tab: "Pipeline" }, { tab: "Marketing", sumber: "TIKTOK" }, { tab: "Marketing", sumber: null }]) {
    const b = bacaUrlLaporan(url, TABS);
    url = tulisUrlLaporan(url, { tab: langkah.tab, range: { from: b.dari, to: b.sampai }, sumber: langkah.sumber });
    const sesudah = bacaUrlLaporan(url, TABS);
    assert.deepEqual([sesudah.dari, sesudah.sampai], ["2026-10-01", "2026-10-26"], `periode stabil setelah ${JSON.stringify(langkah)}`);
  }
  assert.equal(samaRentang({ from: "a", to: "b" }, { from: "a", to: "b" }), true); assert.equal(samaRentang({ from: null, to: null }, undefined), true); assert.equal(samaRentang({ from: "a", to: "b" }, { from: "a", to: "c" }), false);
});

test("navigasi: label Traffic → id sumber Akuisisi; B2B/karyawan tidak punya detail; jalur rincian jujur per sumber (tidak ada tabel palsu)", () => {
  assert.deepEqual(["META_ADS", "TIKTOK_ADS", "WHATSAPP_DIRECT", "INSTAGRAM", "WEBSITE_ORGANIC", "OTHER", "GOOGLE_ADS", "REFERRAL"].map(sumberAkuisisiDariTraffic), ["META", "TIKTOK", "WHATSAPP", "INSTAGRAM", "WEBSITE", "LAINNYA", "LAINNYA", "LAINNYA"]);
  assert.equal(sumberAkuisisiDariTraffic("B2B_DIRECT"), null); assert.equal(sumberAkuisisiDariTraffic("PENJUALAN_KARYAWAN"), null); assert.equal(sumberAkuisisiDariTraffic(""), null);
  assert.equal(jalurRincian("META").campaign, true); assert.equal(jalurRincian("TIKTOK").campaign, false); assert.match(jalurRincian("TIKTOK").penjelasan, /belum punya data per campaign/); assert.equal(jalurRincian("WHATSAPP").campaign, false);
});

test("format periode WIB", () => {
  assert.equal(teksPeriode("2026-10-01", "2026-10-26"), "1 Okt 2026 – 26 Okt 2026"); assert.equal(teksPeriode("2026-10-05", "2026-10-05"), "5 Okt 2026");
  assert.equal(tglValid("2026-02-29"), false); assert.equal(tglValid("2024-02-29"), true);
});

test("arsitektur: Laporan.jsx membaca periode dari URL dan meneruskan SATU range ke Marketing; Marketing tidak punya state rentang/DateRangePicker sendiri", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const baca = (p) => fs.readFileSync(path.join(root, p), "utf8");
  const laporan = baca("src/pages/Laporan.jsx");
  assert.match(laporan, /useSearchParams/); assert.match(laporan, /<MarketingTab range={range}/);
  assert.ok(!/<(AkuisisiTab|IklanCampaignTab|TrafficTab)/.test(laporan), "tab lama tidak lagi dirender");
  for (const f of ["src/features/laporan/components/MarketingTab.jsx", "src/features/laporan/components/marketing/MetaDetail.jsx", "src/features/laporan/components/marketing/RingkasanMarketing.jsx"]) {
    const t = baca(f);
    assert.ok(!/DateRangePicker/.test(t.replace(/\/\/.*$/gm, "")), `${f} tidak boleh punya date picker sendiri`);
    assert.ok(!/useState\(\(\) => \{ const k = todayWIB\(\)|rentangBawaan|makeCustomRange\(k\./.test(t), `${f} tidak boleh membuat rentang bawaan sendiri`);
  }
});
