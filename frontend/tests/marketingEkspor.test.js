// Ekspor tab Marketing: CSV (sumber, Meta) dan XLSX harus memuat periode, basis, dan cutoff yang sama dengan layar, dan tidak mengubah null menjadi 0.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { buatCsvMeta, cutoffMetaWib } from "../src/features/laporan/marketingLogic.js";
import { buatCsvAkuisisi } from "../src/features/laporan/akuisisiLogic.js";
import { sheetMarketing, sheetMetaCtwa } from "../src/utils/marketingXlsx.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NULL_BIAYA = { spend: null, cpa: null, bookedRoas: null, cashRoas: null, alasanNull: { cpa: "SPEND_TIDAK_LENGKAP", cashRoas: "SPEND_TIDAK_LENGKAP" } };
const grup = (kunci, o = {}) => ({
  kunci, status: "MAPPED", level: "campaign", campaign: { id: kunci, nama: `Camp ${kunci}` }, lead: { unik: 10, spam: 1 }, customerDenganOrder: 0, customerPernahMembayar: 0, closingUtama: { customerLunasTerbuktiLedger: 0 },
  bookedValue: 0, uangBersihLedger: 0, biaya: { ...NULL_BIAYA }, ...o,
});
const sumberS = (id, o = {}) => ({
  id, label: id, jenis: "IKLAN", lead: 20, spam: 2, leadSah: 18, berOrder: 4, membayar: 2, lunas: 1, konversiOrder: { nilai: 20, pembilang: 4, penyebut: 20 }, konversiOrderNonSpam: { nilai: 22.22, pembilang: 4, penyebut: 18 },
  uang: { nilaiOrderSaatIni: 8_000_000, uangBersih: 3_000_000 }, biaya: { dasar: "ATRIBUSI_LABEL_CRM", status: "BELUM_DIISI", ...NULL_BIAYA }, ...o,
});
const LAP = () => ({
  periode: { dari: "2026-10-01", sampai: "2026-10-10" }, cutoffEvaluasi: { waktuWib: "2026-10-30 09:15:00 WIB" },
  total: { lead: 55, spam: 4, leadSah: 51, berOrder: 5, membayar: 2, lunas: 1, nilaiOrderSaatIni: 16_000_000, uangBersih: 6_000_000 },
  sumber: [sumberS("META", { lead: 5 }), sumberS("TIKTOK", { lead: 30, berOrder: 1 }), sumberS("ORGANIK", { jenis: "ORGANIK", lead: 0, berOrder: 0, lunas: 0, uang: { nilaiOrderSaatIni: 0, uangBersih: 0 } })],
});
const semuaBaris = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

test("CSV sumber: periode, basis, cutoff, urutan layar; 'Total lead (termasuk spam)'; null kosong (bukan 0) + alasan", () => {
  const csv = buatCsvAkuisisi(LAP(), { urut: "lead" });
  assert.match(csv, /Basis laporan,.*tanggal lead masuk/);
  assert.match(csv, /Periode lead masuk \(WIB\),2026-10-01 s\/d 2026-10-10/);
  assert.match(csv, /Evaluasi pembayaran sampai,2026-10-30 09:15:00 WIB/);
  assert.match(csv, /Total lead \(termasuk spam\)/);
  assert.match(csv, /Urut menurut,Total lead/);
  const b = csv.trim().split("\r\n"); const iHead = b.findIndex((x) => x.startsWith("Sumber,")); const kol = b[iHead].split(",");
  assert.deepEqual(b.slice(iHead + 1, iHead + 4).map((x) => x.split(",")[0]), ["TIKTOK", "META", "ORGANIK"], "urutan = layar (lead terbanyak dulu)");
  const baris = b[iHead + 1].split(",");
  assert.equal(baris[kol.indexOf("Biaya iklan (Rp)")], "", "spend null = sel kosong");
  assert.equal(baris[kol.indexOf("CPA lunas (Rp)")], "");
  assert.match(b[iHead + 1], /spend/i, "alasan tertulis");
  assert.equal(baris[kol.indexOf("Total lead (termasuk spam)")], "30");
  assert.equal(buatCsvAkuisisi(null), "");
});

test("CSV Meta: basis, dasar CTWA, periode, dan cutoff dari waktu hitung server (WIB); tanpa cutoff = kosong, tidak dikarang", () => {
  assert.equal(cutoffMetaWib({ dihitungPada: "2026-10-30T02:15:00.000Z" }), "2026-10-30 09:15:00 WIB");
  assert.equal(cutoffMetaWib({}), null); assert.equal(cutoffMetaWib({ dihitungPada: "x" }), null);
  const lap = { dihitungPada: "2026-10-30T02:15:00.000Z", rentangLead: { dari: "2026-10-01", sampai: "2026-10-10", level: "campaign" }, grup: [grup("A", { customerDenganOrder: 3 })] };
  const csv = buatCsvMeta(lap);
  assert.match(csv, /Basis laporan/);
  assert.match(csv, /Atribusi CTWA terbukti per Ad ID \(bukan label CRM\)/);
  assert.match(csv, /Periode lead \(WIB\),2026-10-01 s\/d 2026-10-10/);
  assert.match(csv, /Evaluasi pembayaran sampai,2026-10-30 09:15:00 WIB/);
  assert.match(csv, /Lead CTWA terbukti \(termasuk spam\)/);
  assert.match(buatCsvMeta({ ...lap, dihitungPada: undefined }), /Evaluasi pembayaran sampai,\r?\n/);
});

test("XLSX: sheet Marketing = layar (periode, urutan, cutoff); null → '—' bukan 0; nol nyata tetap 0; sheet Meta CTWA terpisah", () => {
  const ws = sheetMarketing({ periode: "1 Okt – 10 Okt 2026", marketing: { lap: LAP(), iklan: null, urut: "lead", rank: null } });
  const baris = semuaBaris(ws); const teks = baris.map((r) => r.join("|")).join("\n");
  assert.match(teks, /Basis laporan\|.*tanggal lead masuk/);
  assert.match(teks, /Periode lead masuk \(WIB\)\|2026-10-01 s\/d 2026-10-10/);
  assert.match(teks, /Evaluasi pembayaran sampai\|2026-10-30 09:15:00 WIB/);
  assert.match(teks, /Urut menurut\|Total lead/);
  const iHead = baris.findIndex((r) => r[0] === "Sumber"); const kol = baris[iHead];
  assert.deepEqual(baris.slice(iHead + 1, iHead + 4).map((r) => r[0]), ["TIKTOK", "META", "ORGANIK"]);
  const t = baris[iHead + 1];
  assert.equal(t[kol.indexOf("Total lead (termasuk spam)")], 30);
  assert.equal(t[kol.indexOf("Biaya iklan")], "—", "spend null tidak menjadi 0");
  assert.equal(t[kol.indexOf("CPA lunas")], "—"); assert.equal(t[kol.indexOf("Booked ROAS")], "—");
  assert.match(String(t[kol.indexOf("Alasan CPA kosong")]), /spend/i);
  assert.equal(baris[iHead + 3][kol.indexOf("Total lead (termasuk spam)")], 0, "0 nyata tetap 0");
  const tot = baris.find((r) => String(r[0]).startsWith("TOTAL (semua"));
  assert.equal(tot[kol.indexOf("Total lead (termasuk spam)")], 55); assert.equal(tot[kol.indexOf("Spam")], 4);

  const meta = { dihitungPada: "2026-10-30T02:15:00.000Z", rentangLead: { dari: "2026-10-01", sampai: "2026-10-10", level: "campaign" }, grup: [grup("A", { customerDenganOrder: 3 }), grup("U", { status: "UNMAPPED", ad: { id: "9" } })] };
  const wm = semuaBaris(sheetMetaCtwa({ periode: "x", marketing: { lap: LAP(), iklan: meta, rank: null } })); const tm = wm.map((r) => r.join("|")).join("\n");
  assert.match(tm, /Atribusi CTWA terbukti per Ad ID/); assert.match(tm, /Evaluasi pembayaran sampai\|2026-10-30 09:15:00 WIB/); assert.match(tm, /UNMAPPED/);
  const hm = wm.findIndex((r) => r[0] === "Peringkat"); const kb = wm[hm]; const rowA = wm.slice(hm + 1).find((r) => r[2] === "Camp A");
  assert.equal(rowA[kb.indexOf("Spend (Rp)")], "—", "spend null = —"); assert.equal(rowA[kb.indexOf("Customer ber-order")], 3);
});

test("XLSX legacy diberi label jelas; sheet Marketing didaftarkan lebih dulu; catatan lama yang keliru dihapus", () => {
  const src = fs.readFileSync(path.join(root, "src/utils/exportLaporan.js"), "utf8");
  assert.match(src, /TRAFFIC LEAD \(LEGACY — TANPA SPAM\)/); assert.match(src, /RINCIAN PER IKLAN \(LEGACY — BASIS LABEL CRM\)/);
  assert.ok(src.indexOf('["Marketing",') < src.indexOf('["Traffic (legacy)"'), "sheet Marketing pertama");
  assert.ok(!/Termasuk salah sambung\/spam/.test(src));
});
