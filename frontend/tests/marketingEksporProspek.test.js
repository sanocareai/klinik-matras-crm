// Ekspor CSV/XLSX Marketing: 7 kolom prospek DITAMBAHKAN DI AKHIR; urutan dan isi 22 (CSV) / 19 (XLSX) kolom lama tidak berubah; data tidak ada -> kosong (bukan 0).
import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { buatCsvAkuisisi } from "../src/features/laporan/akuisisiLogic.js";
import { sheetMarketing, KOLOM_XLSX_MARKETING } from "../src/utils/marketingXlsx.js";

const CSV_LAMA = ["Sumber", "Dasar biaya", "Total lead (termasuk spam)", "Spam", "Lead sah", "Ber-order", "Membayar", "Customer lunas (terbukti ledger)", "Konversi ber-order % (÷ total lead termasuk spam)", "Pembilang", "Penyebut",
  "Nilai order saat ini (Rp)", "Pembayaran tercatat bersih (Rp)", "Biaya iklan (Rp)", "Status biaya", "CPA lunas (Rp)", "Alasan CPA kosong", "Booked ROAS", "Cash ROAS", "Alasan ROAS kosong", "Sementara", "Verifikasi biaya (bukan verifikasi independen)"];
const BARU = ["Prospek eksplisit (keputusan manual sales)", "Prospek eksplisit % lead sah", "Prospek atau lanjut (rincian: definisi lama)", "Langsung ke transaksi tanpa catatan PROSPECT", "Saat ini di stage PROSPECT", "Biaya per prospek eksplisit (Rp)", "Alasan biaya per prospek kosong"];
const XLSX_LAMA = ["Sumber", "Dasar biaya", "Total lead (termasuk spam)", "Spam", "Lead sah (non-spam)", "Customer ber-order", "Customer membayar", "Customer lunas (terbukti ledger)", "Konversi ber-order % (÷ total lead termasuk spam)", "Konversi non-spam %", "Nilai order saat ini", "Pembayaran tercatat bersih", "Biaya iklan", "Status biaya", "CPA lunas", "Alasan CPA kosong", "Booked ROAS", "Cash ROAS", "Alasan ROAS kosong"];
const sumber = (id, label, jenis, o = {}) => ({ id, label, jenis, lead: 100, spam: 10, leadSah: 90, berOrder: 5, membayar: 0, lunas: 0, konversiOrder: { nilai: 5, pembilang: 5, penyebut: 100 }, konversiOrderNonSpam: { nilai: 5.56 }, uang: { nilaiOrderSaatIni: 5_000_000, uangBersih: 0 }, biaya: { dasar: "ATRIBUSI_LABEL_CRM", status: "BELUM_DIISI", spend: null, alasanNull: { costPerProspekEksplisit: "BELUM_DIISI" } }, ...o });
const LAP = (adaProspek = true) => ({ periode: { dari: "2026-11-01", sampai: "2026-11-05" }, cutoffEvaluasi: { waktuWib: "2026-11-05 08:15:00 WIB" }, status: { ledger: { orderEligible: 14, orderBerLedger: 0, persen: 0 } },
  sumber: [
    sumber("META", "Meta Ads", "IKLAN", adaProspek ? { prospek: { prospekEksplisit: { jumlah: 103, persenDariLeadSah: 25.75, penyebut: 400 }, pernahProspekAtauLanjut: { jumlah: 107 }, langsungKeTransaksiTanpaProspect: 4, saatIniProspect: 101 }, biaya: { dasar: "ATRIBUSI_LABEL_CRM", status: "LENGKAP", spend: 1_000_000, costPerProspekEksplisit: 9708.74, alasanNull: {}, cakupan: {} } } : {}),
    sumber("GOOGLE", "Google Ads", "IKLAN", adaProspek ? { lead: 0, spam: 0, leadSah: 0, prospek: { prospekEksplisit: { jumlah: 0, persenDariLeadSah: null, penyebut: 0 }, pernahProspekAtauLanjut: { jumlah: 0 }, langsungKeTransaksiTanpaProspect: 0, saatIniProspect: 0 }, biaya: { dasar: "ATRIBUSI_LABEL_CRM", status: "LENGKAP", spend: 500_000, costPerProspekEksplisit: null, alasanNull: { costPerProspekEksplisit: "BELUM_ADA_PROSPEK" }, cakupan: {} } } : {}),
  ],
  total: { lead: 100, spam: 10, leadSah: 90, berOrder: 5, membayar: 0, lunas: 0, nilaiOrderSaatIni: 5_000_000, uangBersih: 0, ...(adaProspek ? { prospek: { prospekEksplisit: 40, pernahProspekAtauLanjut: 107, langsungKeTransaksiTanpaProspect: 4, saatIniProspect: 101 } } : {}), berbayar: null } });

test("CSV: 22 kolom lama UTUH dan urut sama; 7 kolom prospek hanya di akhir", () => {
  const b = buatCsvAkuisisi(LAP(), { urut: "lead" }).trim().split("\r\n"); const i = b.findIndex((x) => x.startsWith("Sumber,")); const kol = b[i].split(",");
  assert.equal(kol.length, 22 + 7);
  assert.deepEqual(kol.slice(0, 22), CSV_LAMA, "urutan kolom existing tidak berubah");
  assert.deepEqual(kol.slice(22), BARU);
  for (const r of b.slice(i + 1)) assert.equal(r.split(",").length, 29, "semua baris sejajar dengan header: " + r.slice(0, 40));
});
test("CSV: nilai kolom baru per sumber dan total; tidak ada data -> kosong (bukan 0); biaya per prospek kosong membawa alasan", () => {
  const b = buatCsvAkuisisi(LAP(), { urut: "lead" }).trim().split("\r\n"); const i = b.findIndex((x) => x.startsWith("Sumber,"));
  const meta = b.find((x) => x.startsWith("Meta Ads,")).split(","), google = b.find((x) => x.startsWith("Google Ads,")).split(","), total = b.find((x) => x.startsWith("TOTAL (semua sumber)")).split(",");
  assert.deepEqual(meta.slice(22), ["103", "25.75", "107", "4", "101", "9708.74", ""]);
  assert.equal(google[22], "0"); assert.equal(google[23], ""); assert.equal(google[27], ""); assert.notEqual(google[28], "", "alasan biaya per prospek kosong tertulis");
  assert.deepEqual(total.slice(22, 27), ["40", "44.44", "107", "4", "101"]);   // eksplisit total / lead sah total (40/90)
  const tanpa = buatCsvAkuisisi(LAP(false), { urut: "lead" }).trim().split("\r\n").find((x) => x.startsWith("Meta Ads,")).split(",");
  assert.deepEqual(tanpa.slice(22), ["", "", "", "", "", "", ""], "respons server lama tanpa blok prospek: kosong, bukan 0");
});
test("XLSX: 19 kolom lama utuh; 7 kolom prospek di akhir; nilai sejajar; tidak ada data -> '—'", () => {
  assert.deepEqual(KOLOM_XLSX_MARKETING.slice(0, 19), XLSX_LAMA); assert.deepEqual(KOLOM_XLSX_MARKETING.slice(19), BARU);
  const ws = sheetMarketing({ periode: "1–5 Nov 2026", marketing: { lap: LAP(), iklan: null, urut: "lead", rank: null } });
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }); const i = rows.findIndex((r) => r[0] === "Sumber");
  assert.deepEqual(rows[i].slice(0, 26), KOLOM_XLSX_MARKETING);
  const meta = rows.find((r) => r[0] === "Meta Ads"); assert.equal(meta[19], 103); assert.equal(meta[21], 107); assert.equal(meta[22], 4); assert.equal(meta[23], 101); assert.equal(meta[24], 9708.74);
  const tanpa = sheetMarketing({ periode: "x", marketing: { lap: LAP(false), iklan: null, urut: "lead", rank: null } });
  const r2 = XLSX.utils.sheet_to_json(tanpa, { header: 1, defval: "" }); const m2 = r2.find((r) => r[0] === "Meta Ads");
  for (const k of [19, 20, 21, 22, 23, 24]) assert.ok(m2[k] === "—" || m2[k] === "", `kolom ${k} tanpa data bukan 0: ${JSON.stringify(m2[k])}`);
});
