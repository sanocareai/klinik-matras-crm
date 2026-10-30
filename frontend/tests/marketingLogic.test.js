// Tab Marketing (menggantikan Traffic + Akuisisi + Iklan): URL lama, state URL, peringkat Meta, kartu ringkas, rekonsiliasi lead, kualitas data, ekspor.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bacaUrlLaporan, tulisUrlLaporan } from "../src/features/laporan/periodeLaporan.js";
import {
  petaTab, KRITERIA_META, kriteriaTersedia, urutkanMeta, terapkanUmur, normalisasiJalurMeta, jejakMeta, kartuRingkas, konversiTotal, rekonLead, kualitasData,
  kolomTampil, KOLOM_SUMBER, buatCsvMeta, KRITERIA_META_BAWAAN,
} from "../src/features/laporan/marketingLogic.js";

const TABS = ["Ringkasan", "Sales", "Marketing", "Performa Tim", "Pipeline"];
const DARI = "dari=2026-10-01&sampai=2026-10-26";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── URL lama → tujuan pengganti, periode dipertahankan ──────────────────────────────────────────────────────────────────────────────────────────
test("URL lama: Traffic/Akuisisi/Iklan membuka Marketing dan mempertahankan periode (dan sumber Akuisisi)", () => {
  const t = bacaUrlLaporan(`?tab=Traffic&${DARI}`, TABS);
  assert.deepEqual([t.tab, t.tabLama, t.dari, t.sampai, t.sumber], ["Marketing", true, "2026-10-01", "2026-10-26", null]);
  const a = bacaUrlLaporan(`?tab=Akuisisi&${DARI}&sumber=TIKTOK`, TABS);
  assert.deepEqual([a.tab, a.tabLama, a.sumber, a.dari], ["Marketing", true, "TIKTOK", "2026-10-01"]);
  const a0 = bacaUrlLaporan(`?tab=Akuisisi&${DARI}`, TABS);
  assert.deepEqual([a0.tab, a0.sumber], ["Marketing", null]);
  const i = bacaUrlLaporan(`?tab=Iklan&${DARI}`, TABS);
  assert.deepEqual([i.tab, i.sumber, i.level, i.dari, i.sampai], ["Marketing", "META", "campaign", "2026-10-01", "2026-10-26"]);
  assert.equal(bacaUrlLaporan(`?tab=Marketing&${DARI}`, TABS).tabLama, false, "URL baru bukan URL lama");
  assert.deepEqual(petaTab("Tab Asing", "META", TABS), { tab: null, sumber: null });
  assert.deepEqual(petaTab("constructor", null, TABS), { tab: null, sumber: null }, "kunci prototype tidak dianggap tab lama");
});

test("URL lama dikanonikalkan: tulis ulang menghasilkan ?tab=Marketing dengan periode yang sama dan tanpa sisa kunci lama", () => {
  const b = bacaUrlLaporan(`?tab=Iklan&${DARI}&x=1`, TABS);
  const u = tulisUrlLaporan(`?tab=Iklan&${DARI}&x=1`, { tab: b.tab, range: { from: b.dari, to: b.sampai }, marketing: { sumber: b.sumber, level: b.level, campaign: b.campaign, adset: b.adset } });
  assert.equal(u.get("tab"), "Marketing"); assert.equal(u.get("sumber"), "META"); assert.equal(u.get("dari"), "2026-10-01"); assert.equal(u.get("sampai"), "2026-10-26"); assert.equal(u.get("x"), "1");
});

// ── state di URL: periode, filter, urutan, sumber, drilldown ────────────────────────────────────────────────────────────────────────────────────
test("state Marketing di URL: roundtrip menyimpan sumber, urutan, kolom, banding, drilldown Meta, peringkat, umur — dan nilai bawaan tidak ditulis", () => {
  const m = { sumber: "META", urut: "lunas", kolom: "lengkap", banding: true, level: "ad", campaign: "52694481763084", adset: "52694481763284", rank: "cpa_lunas", umur: "hari30" };
  const u = tulisUrlLaporan("", { tab: "Marketing", range: { from: "2026-10-01", to: "2026-10-26" }, marketing: m });
  const b = bacaUrlLaporan(u, TABS);
  assert.deepEqual({ sumber: b.sumber, urut: b.urut, kolom: b.kolom, banding: b.banding, level: b.level, campaign: b.campaign, adset: b.adset, rank: b.rank, umur: b.umur }, m);
  const bawaan = tulisUrlLaporan("", { tab: "Marketing", range: { from: "2026-10-01", to: "2026-10-26" }, marketing: { sumber: null, urut: "berOrder", kolom: "ringkas", banding: false, level: "campaign", rank: KRITERIA_META_BAWAAN, umur: "semua" } });
  assert.equal(bawaan.toString(), "tab=Marketing&dari=2026-10-01&sampai=2026-10-26", "tidak ada kunci bawaan yang ditulis");
  // pindah tab membersihkan kunci Marketing tetapi mempertahankan periode dan parameter lain
  const sales = tulisUrlLaporan(`${u.toString()}&x=1`, { tab: "Sales", range: { from: "2026-10-01", to: "2026-10-26" }, marketing: {} });
  for (const k of ["sumber", "urut", "kolom", "banding", "level", "campaign", "adset", "rank", "umur"]) assert.equal(sales.get(k), null, k);
  assert.equal(sales.get("dari"), "2026-10-01"); assert.equal(sales.get("x"), "1");
});

test("URL: nilai berbahaya/tidak valid diabaikan (tidak melempar); drilldown tak konsisten diturunkan ke level yang sah; kunci Meta hanya untuk sumber META", () => {
  const b = bacaUrlLaporan("?tab=Marketing&sumber=META&urut=<x>&kolom=zzz&level=ad&campaign=bukan-id&adset=123&rank=drop&umur=hari999&banding=2", TABS);
  assert.deepEqual([b.urut, b.kolom, b.level, b.campaign, b.adset, b.rank, b.umur, b.banding], ["berOrder", "ringkas", "campaign", null, null, KRITERIA_META_BAWAAN, "semua", false]);
  assert.deepEqual(normalisasiJalurMeta({ level: "ad", campaign: "52694481763084", adset: null }), { level: "adset", campaign: "52694481763084", adset: null });
  assert.deepEqual(normalisasiJalurMeta({ level: "adset", campaign: null }), { level: "campaign", campaign: null, adset: null });
  const tiktok = bacaUrlLaporan("?tab=Marketing&sumber=TIKTOK&level=adset&campaign=52694481763084&rank=cpa_lunas", TABS);
  assert.deepEqual([tiktok.level, tiktok.campaign, tiktok.adset], ["campaign", null, null], "drilldown Meta tidak bocor ke sumber lain");
});

// ── peringkat Meta ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const grup = (kunci, o = {}) => ({
  kunci, status: "MAPPED", level: "campaign", campaign: { id: kunci, nama: `Camp ${kunci}` }, lead: { unik: 10, spam: 1, leadSah: 9, bukanSpam: 9 }, customerDenganOrder: 0, customerPernahMembayar: 0, closingUtama: { customerLunasTerbuktiLedger: 0 },
  bookedValue: 0, uangBersihLedger: 0, uangLedger: 0, biaya: { spend: null, cpa: null, bookedRoas: null, cashRoas: null, alasanNull: { cpa: "SPEND_TIDAK_LENGKAP", bookedRoas: "SPEND_TIDAK_LENGKAP", cashRoas: "SPEND_TIDAK_LENGKAP" } }, ...o,
});
const G = [
  grup("A", { customerDenganOrder: 3, customerPernahMembayar: 1, closingUtama: { customerLunasTerbuktiLedger: 0 }, bookedValue: 10_000_000, lead: { unik: 13, spam: 0, leadSah: 13, bukanSpam: 13 } }),
  grup("B", { customerDenganOrder: 3, customerPernahMembayar: 3, closingUtama: { customerLunasTerbuktiLedger: 2 }, bookedValue: 5_000_000 }),
  grup("C", { customerDenganOrder: 1, bookedValue: 12_000_000 }),
  grup("D", { customerDenganOrder: 0 }),
  grup("U", { status: "UNMAPPED", customerDenganOrder: 9, ad: { id: "52699999999999" } }),
  grup("K", { status: "UNKNOWN", customerDenganOrder: 9 }),
];

test("peringkat Meta: ber-order, membayar, dan lunas adalah kriteria TERPISAH; seri = peringkat sama; UNMAPPED/UNKNOWN selalu di bawah dan tidak diperingkat", () => {
  const ber = urutkanMeta(G, "customer_ber_order");
  assert.deepEqual(ber.baris.map((r) => [r.g.kunci, r.peringkat]), [["B", 1], ["A", 1], ["C", 3], ["D", 4], ["U", null], ["K", null]], "seri 3 & 3 → peringkat 1 bersama (pemecah: lunas ledger lebih dulu hanya mengatur urutan tampil)");
  const lunas = urutkanMeta(G, "customer_lunas_ledger");
  assert.deepEqual(lunas.baris.slice(0, 2).map((r) => [r.g.kunci, r.nilai]), [["B", 2], ["A", 0]], "lunas ledger ≠ ber-order");
  const bayar = urutkanMeta(G, "customer_pernah_membayar");
  assert.deepEqual(bayar.baris.slice(0, 2).map((r) => r.g.kunci), ["B", "A"]);
  assert.equal(ber.baris.at(-1).tanpaPeringkat, "UNKNOWN"); assert.equal(ber.baris.at(-2).tanpaPeringkat, "UNMAPPED");
  assert.equal(urutkanMeta(G, "tidak_ada").kriteria.id, KRITERIA_META_BAWAAN, "kriteria asing → bawaan");
  const nilai = urutkanMeta(G, "nilai_order");
  assert.deepEqual(nilai.baris.slice(0, 3).map((r) => r.g.kunci), ["C", "A", "B"]);
});

test("peringkat Meta: CPA/ROAS hanya berperingkat bila server mengisinya (null + alasan, bukan 0); CPA terendah = terbaik", () => {
  assert.deepEqual(Object.entries(kriteriaTersedia(G)).filter(([, v]) => !v).map(([k]) => k).sort(), ["booked_roas", "cash_roas", "cpa_lunas"], "belum ada spend → CPA/ROAS belum valid");
  const cpa = urutkanMeta(G, "cpa_lunas");
  assert.ok(cpa.baris.slice(0, 4).every((r) => r.peringkat === null && r.alasan === "SPEND_TIDAK_LENGKAP"), "semua tanpa peringkat + alasan");
  const dengan = [grup("X", { biaya: { cpa: 200_000, bookedRoas: 1.5, cashRoas: 1, spend: 1e6, alasanNull: {} }, closingUtama: { customerLunasTerbuktiLedger: 5 } }), grup("Y", { biaya: { cpa: 100_000, bookedRoas: 3, cashRoas: 2, spend: 1e6, alasanNull: {} }, closingUtama: { customerLunasTerbuktiLedger: 10 } }), grup("Z")];
  assert.deepEqual(urutkanMeta(dengan, "cpa_lunas").baris.map((r) => r.g.kunci), ["Y", "X", "Z"], "CPA terendah dulu; null di akhir");
  assert.deepEqual(urutkanMeta(dengan, "booked_roas").baris.map((r) => r.g.kunci), ["Y", "X", "Z"]);
  assert.equal(kriteriaTersedia(dengan).cpa_lunas, true);
  const nol = urutkanMeta([grup("P"), grup("Q")], "customer_lunas_ledger");
  assert.equal(nol.semuaNol, true, "semua 0 → bukan pemenang"); assert.deepEqual(nol.baris.map((r) => r.peringkat), [1, 1]);
});

test("kohort umur: angka yang tampil = angka yang diperingkat; pembayaran bersih/membayar tidak tersedia (null, bukan 0)", () => {
  const g = grup("A", { customerDenganOrder: 5, bookedValue: 9e6, customerPernahMembayar: 4, uangBersihLedger: 1e6, kematangan: { hari30: { leadMatang: 7, customerDenganOrder: 2, orderEligible: 2, bookedValue: 3e6, customerLunasTerbuktiLedger: 1, uangLedger: 2e6 } } });
  const v = terapkanUmur(g, "hari30");
  assert.deepEqual([v.customerDenganOrder, v.bookedValue, v.closingUtama.customerLunasTerbuktiLedger, v.customerPernahMembayar, v.uangBersihLedger, v._leadMatang], [2, 3e6, 1, null, null, 7]);
  assert.equal(terapkanUmur(g, "semua"), g); assert.equal(terapkanUmur(g, "hari60").customerDenganOrder, 5, "tanpa blok kohort → apa adanya (sama dengan tabel lama)");
  assert.equal(urutkanMeta([v], "uang_ledger_bersih").baris[0].peringkat, null);
});

test("kriteria peringkat klien sejajar dengan tool MCP (laporanMeta.js#KRITERIA_URUT): id dan arah sama", () => {
  const src = fs.readFileSync(path.join(root, "..", "backend", "src", "services", "attribution", "laporanMeta.js"), "utf8");
  const blok = src.slice(src.indexOf("export const KRITERIA_URUT"), src.indexOf("export const DAFTAR_KRITERIA"));
  const server = [...blok.matchAll(/^\s{2}(\w+): \{ label: [^\n]*?arah: "(asc|desc)"/gm)].map((m) => [m[1], m[2]]);
  const klien = KRITERIA_META.map((k) => [k.id, k.arah]);
  for (const [id, arah] of klien) assert.ok(server.some(([i, a]) => i === id && a === arah), `kriteria ${id} (${arah}) ada di server`);
  for (const [id] of server.filter(([i]) => !["spend", "customer_pernah_membayar_X"].includes(i))) assert.ok(klien.some(([i]) => i === id), `kriteria server ${id} ada di klien`);
});

test("jejak Meta: nama dari baris laporan, fallback ke ID", () => {
  const j = jejakMeta({ level: "ad", campaign: "52694481763084", adset: "52694481763284" }, [{ campaign: { id: "52694481763084", nama: "Jabo IG" }, adSet: { id: "52694481763284", nama: "Set 84" } }]);
  assert.deepEqual(j.map((x) => x.label), ["Semua campaign", "Jabo IG", "Set 84"]);
  assert.deepEqual(jejakMeta({ level: "adset", campaign: "52694481763084" }, []).map((x) => x.label), ["Semua campaign", "Campaign 52694481763084"]);
  assert.deepEqual(jejakMeta({ level: "campaign" }, []).map((x) => x.label), ["Semua campaign"]);
});

// ── kartu ringkas: kosong ≠ nol, lunas = ledger ────────────────────────────────────────────────────────────────────────────────────────────────
const LAP = (o = {}) => ({
  status: { ledger: { orderEligible: 10, orderBerLedger: 6, persen: 60 }, spend: "BELUM_DIISI", atribusi: {} },
  total: { lead: 100, spam: 8, leadSah: 90, berOrder: 12, membayar: 5, lunas: 3, nilaiOrderSaatIni: 36_000_000, uangBersih: 9_000_000, berbayar: { sumber: ["META", "TIKTOK"], lengkap: false, belumLengkap: [{ id: "TIKTOK", status: "BELUM_DIISI" }], spend: null, cpa: null, bookedRoas: null, cashRoas: null, alasanNull: "SPEND_TIDAK_LENGKAP_PADA_SUMBER_WAJIB" }, ...(o.total || {}) },
  sumber: [], peringatan: [], ...o.atas,
});
test("kartu ringkas: enam kartu; biaya iklan tidak lengkap = '—' dengan alasan (bukan Rp0); lunas = batas bawah saat ledger parsial; label eksplisit (tanpa 'Closing')", () => {
  const k = kartuRingkas(LAP());
  assert.deepEqual(k.map((x) => x.id), ["lead", "berOrder", "lunas", "nilai", "uang", "biaya"]);
  const biaya = k.find((x) => x.id === "biaya"); assert.equal(biaya.nilai, "—"); assert.equal(biaya.kosong, true); assert.match(biaya.sub, /spend belum lengkap|belum lengkap/i);
  const lunas = k.find((x) => x.id === "lunas"); assert.match(lunas.nilai, /^≥ 3$/); assert.equal(lunas.peringatan, true);
  assert.match(k.find((x) => x.id === "lead").sub, /90 sah · 8 spam/);
  for (const x of k) assert.ok(!/closing/i.test(`${x.judul} ${x.sub} ${x.tip}`), `label ambigu 'Closing' pada kartu ${x.id}`);
  const lengkap = kartuRingkas(LAP({ total: { berbayar: { sumber: ["META"], lengkap: true, belumLengkap: [], spend: 5_000_000, cpa: 1_666_667, bookedRoas: 7.2, cashRoas: 1.8, sementara: false } }, atas: { status: { ledger: { orderEligible: 10, orderBerLedger: 10, persen: 100 } } } }));
  assert.equal(lengkap.find((x) => x.id === "biaya").nilai, "Rp5.000.000"); assert.equal(lengkap.find((x) => x.id === "lunas").nilai, "3");
  assert.equal(kartuRingkas(null).length, 0);
});

test("konversi total = Σ ber-order ÷ Σ lead (pembilang dan penyebut total), dibulatkan 2 desimal seperti server; penyebut 0 → null", () => {
  const k = konversiTotal({ berOrder: 12, lead: 100, leadSah: 90 }); assert.deepEqual([k.nilai, k.pembilang, k.penyebut, k.nilaiNonSpam], [12, 12, 100, 13.33]);
  assert.equal(konversiTotal({ berOrder: 0, lead: 0, leadSah: 0 }).nilai, null);
});

// ── rekonsiliasi total lead ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("rekonsiliasi lead: total lead − spam = lead tanpa spam = total tren; selisih ditandai (bukan disembunyikan)", () => {
  const traffic = { totalLeads: 92, daily: [{ value: 40 }, { value: 52 }] };
  const ok = rekonLead(LAP(), traffic); assert.deepEqual([ok.tersedia, ok.tanpaSpam, ok.tren, ok.selisih, ok.cocok, ok.harianCocokTotal], [true, 92, 92, 0, true, true]);
  const beda = rekonLead(LAP(), { totalLeads: 95, daily: [{ value: 95 }] }, { termasukHariBerjalan: true });
  assert.deepEqual([beda.cocok, beda.selisih], [false, 3]); assert.match(beda.penjelasanSelisih, /hari berjalan/);
  assert.match(rekonLead(LAP(), { totalLeads: 95, daily: [{ value: 95 }] }).penjelasanSelisih, /tidak terduga/);
  assert.equal(rekonLead(LAP(), null).tersedia, false); assert.equal(rekonLead(null, traffic).tersedia, false);
});

test("kualitas data: coverage, ledger parsial, spend hilang, UNKNOWN, UNMAPPED, rekonsiliasi lead — butir sesuai data server", () => {
  const iklan = { grup: [grup("A"), grup("U", { status: "UNMAPPED", ad: { id: "1" }, lead: { unik: 4 } }), grup("K", { status: "UNKNOWN", lead: { unik: 6 } })], tidakTerpetakan: { adIds: ["1", "2"] }, biaya: { sumber: { terhubung: true, terakhirTanggal: "2026-10-16", terlambat: true }, kesegaran: { hariHilang: ["2026-10-17", "2026-10-18"] }, spendTidakTerpetakan: 0 }, rekonsiliasi: { ok: true, cek: [1, 2, 3] }, cakupan: { denganTouchAkuisisi: 5, leadBaruDalamRentang: 20, leadBaruTouchTanpaBukti: 1, leadBaruTouchPadaCustomerSudahAda: 0, tanpaTouch: 14, persenDenganTouch: 25 }, atribusi: { attributionStartWib: "2026-10-12 08:00" } };
  const traffic = { totalLeads: 95, daily: [{ value: 95 }], atribusi: { total: 95, teridentifikasi: 60, rate: 63.2, belumDikonfirmasi: 12 } };
  const butir = kualitasData({ lap: LAP(), iklan, traffic, periode: { termasukHariBerjalan: false } });
  const by = Object.fromEntries(butir.map((b) => [b.id, b]));
  for (const id of ["coverage", "ledgerParsial", "spendSumber", "spendMeta", "unknown", "unmapped", "atribusiMeta", "rekonMeta", "labelSumber", "rekonLead"]) assert.ok(by[id], `butir ${id}`);
  assert.equal(by.coverage.status, "perhatian"); assert.equal(by.ledgerParsial.nilai, "Parsial");
  assert.equal(by.unknown.nilai, "6"); assert.match(by.unmapped.nilai, /2 Ad ID/); assert.equal(by.unmapped.status, "perhatian");
  assert.match(by.spendMeta.nilai, /2 hari hilang/); assert.match(by.spendMeta.teks, /2026-10-17/);
  assert.equal(by.rekonLead.status, "perhatian", "selisih 95 vs 92 ditandai"); assert.match(by.rekonLead.nilai, /Selisih \+3/);
  assert.equal(by.labelSumber.aksi.ke, "/customers?source=WHATSAPP_DIRECT&confirmed=false");
  const tanpaMeta = kualitasData({ lap: LAP(), iklan: null, traffic: null });
  assert.ok(!tanpaMeta.some((b) => ["unknown", "unmapped", "spendMeta", "rekonLead"].includes(b.id)), "butir Meta/traffic tidak diada-adakan saat tidak dimuat");
});

// ── kolom & ekspor ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("kolom sumber: ringkas = 8 kolom utama; lengkap menambah spam, membayar, konversi non-spam, Booked & Cash ROAS", () => {
  assert.deepEqual(kolomTampil("ringkas").map((k) => k.id), ["lead", "berOrder", "lunas", "nilai", "uang", "spend", "konversi", "cpa"]);
  assert.equal(kolomTampil("lengkap").length, KOLOM_SUMBER.length); assert.deepEqual(kolomTampil("lengkap").slice(8).map((k) => k.id), ["spam", "membayar", "konversiNonSpam", "booked", "cash"]);
});

test("ekspor CSV Meta: kolom ber-order/membayar/lunas terpisah; null dikosongkan + alasan; UNMAPPED/UNKNOWN ikut; formula injection dinetralkan", () => {
  const lap = { rentangLead: { dari: "2026-10-01", sampai: "2026-10-10", level: "campaign" }, grup: [grup("A", { campaign: { id: "A", nama: "=HYPERLINK(1)" }, customerDenganOrder: 3, customerPernahMembayar: 2, closingUtama: { customerLunasTerbuktiLedger: 1 } }), grup("U", { status: "UNMAPPED", ad: { id: "52699999999999" } })] };
  const csv = buatCsvMeta(lap, "customer_ber_order");
  assert.match(csv, /Customer ber-order,Customer membayar,Customer lunas \(ledger\)/); assert.match(csv, /'=HYPERLINK\(1\)/); assert.match(csv, /UNMAPPED/); assert.match(csv, /SPEND TIDAK LENGKAP|spend belum lengkap|spend tidak lengkap/i);
  const baris = csv.trim().split("\r\n"); assert.equal(baris.length, 4 + 1 + 1 + 2, "4 meta + kosong + header + 2 baris");
  assert.equal(buatCsvMeta(null), "");
});

test("arsitektur: komponen Marketing memakai service/logika existing — tidak ada fetch langsung ke endpoint lain dan tidak ada 'Closing' pada label baru", () => {
  const baca = (p) => fs.readFileSync(path.join(root, p), "utf8");
  const berkas = ["src/features/laporan/components/MarketingTab.jsx", "src/features/laporan/components/marketing/MetaDetail.jsx", "src/features/laporan/components/marketing/TabelSumber.jsx", "src/features/laporan/components/marketing/RingkasanMarketing.jsx", "src/features/laporan/components/marketing/KualitasDataPanel.jsx", "src/features/laporan/marketingLogic.js"];
  for (const f of berkas) {
    const t = baca(f).replace(/\/\/.*$/gm, "");
    assert.ok(!/\bfetch\(/.test(t), `${f} tidak boleh fetch langsung (pakai api.js)`);
    assert.ok(!/>\s*Closing\s*</.test(t) && !/"Closing\b/.test(t), `${f} tidak memakai label ambigu 'Closing'`);
  }
  assert.ok(!/DateRangePicker/.test(baca("src/features/laporan/components/MarketingTab.jsx").replace(/\/\/.*$/gm, "")));
});
