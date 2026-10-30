// Sheet XLSX tab Marketing (laporan sumber dan Meta CTWA). Memakai objek server yang sama dengan layar; null → "—" (bukan 0).
import * as XLSX from "xlsx";
import { FMT, num, rp, SheetBuilder, judul } from "./sheetBuilder.js";
import { urutkan, statusBiayaTeks, alasanTeks, teksCutoff, DASAR_BIAYA_LABEL, METRIK_BY_ID } from "../features/laporan/akuisisiLogic.js";
import { barisMeta, BASIS_LAPORAN } from "../features/laporan/marketingLogic.js";

// ── Sheet: Marketing (laporan sumber) ──────────────────────────────────────
// Isi = objek server yang sama dengan tabel di layar (/atribusi/iklan/sumber), urutan sama dengan layar. null → "—" (bukan 0); alasan null di kolom sebelahnya.
export const KOLOM_XLSX_MARKETING = ["Sumber", "Dasar biaya", "Total lead (termasuk spam)", "Spam", "Lead sah (non-spam)", "Customer ber-order", "Customer membayar", "Customer lunas (ledger)", "Konversi ber-order % (÷ total lead termasuk spam)", "Konversi non-spam %", "Nilai order saat ini", "Pembayaran tercatat bersih", "Biaya iklan", "Status biaya", "CPA lunas", "Alasan CPA kosong", "Booked ROAS", "Cash ROAS", "Alasan ROAS kosong"];
export function sheetMarketing({ periode, marketing }) {
  const { lap, urut } = marketing;
  const p = lap.periode || {};
  const sb = new SheetBuilder();
  judul(sb, "MARKETING — SEMUA SUMBER (LABEL CRM)", periode);
  sb.row(["Basis laporan", BASIS_LAPORAN]);
  sb.row(["Dasar sumber", "Label CRM (Customer.leadSource). CPA/ROAS = Atribusi label CRM, BUKAN CPA campaign (lihat sheet \"Meta CTWA\")."]);
  sb.row(["Periode lead masuk (WIB)", `${p.dari ?? ""} s/d ${p.sampai ?? ""}`]);
  sb.row(["Evaluasi pembayaran sampai", teksCutoff(lap) || "—"]);
  sb.row(["Urut menurut", (urut && METRIK_BY_ID[urut]?.label) || "urutan server"]);
  sb.row(["Definisi", "Nilai order = nilai order eligible saat ini; pembayaran bersih = ledger − refund disetujui; bukan laba. \"—\" = tidak tersedia (bukan 0)."]);
  if (!marketing.iklan?.grup) sb.row(["Catatan", "Sheet \"Meta CTWA\" tidak disertakan: laporan Meta belum termuat atau gagal dimuat saat ekspor."]);
  sb.blank();
  sb.row(KOLOM_XLSX_MARKETING);
  const daftar = urut && METRIK_BY_ID[urut] ? urutkan(lap.sumber || [], urut) : (lap.sumber || []);
  daftar.forEach((s) => {
    const b = s.biaya || {};
    sb.row([s.label, b.dasar === "ATRIBUSI_LABEL_CRM" ? DASAR_BIAYA_LABEL : "—", num(s.lead), num(s.spam), num(s.leadSah), num(s.berOrder), num(s.membayar), num(s.lunas), num(s.konversiOrder?.nilai, FMT.pct), num(s.konversiOrderNonSpam?.nilai, FMT.pct),
      rp(s.uang?.nilaiOrderSaatIni), rp(s.uang?.uangBersih), rp(b.spend), statusBiayaTeks(b.status), rp(b.cpa), b.cpa == null ? (alasanTeks(b.alasanNull?.cpa) || "tidak tersedia") : "", num(b.bookedRoas, "0.00"), num(b.cashRoas, "0.00"), b.cashRoas == null ? (alasanTeks(b.alasanNull?.cashRoas) || "tidak tersedia") : ""]);
  });
  const t = lap.total || {};
  sb.row(["TOTAL (semua sumber)", "—", num(t.lead), num(t.spam), num(t.leadSah), num(t.berOrder), num(t.membayar), num(t.lunas), t.lead > 0 ? num(Math.round((t.berOrder / t.lead) * 10000) / 100, FMT.pct) : "—", t.leadSah > 0 ? num(Math.round((t.berOrder / t.leadSah) * 10000) / 100, FMT.pct) : "—", rp(t.nilaiOrderSaatIni), rp(t.uangBersih)]);
  const bb = t.berbayar;
  if (bb) sb.row(["TOTAL sumber berbayar", DASAR_BIAYA_LABEL, num(bb.lead), "—", "—", "—", "—", num(bb.lunas), "—", "—", rp(bb.nilaiOrderSaatIni), rp(bb.uangBersih), rp(bb.spend), bb.lengkap ? "Biaya terisi setiap hari" : "Ada sumber belum lengkap", rp(bb.cpa)]);
  return sb.build([26, 18, 14, 8, 12, 12, 12, 12, 16, 12, 16, 16, 14, 22, 14, 24, 11, 11, 24]);
}

// ── Sheet: Meta CTWA (campaign terbukti) ───────────────────────────────────
export function sheetMetaCtwa({ periode, marketing }) {
  const { iklan, rank } = marketing;
  const { meta, kolom, isi } = barisMeta(iklan, rank || undefined);
  const sb = new SheetBuilder();
  judul(sb, "MARKETING — META CAMPAIGN (ATRIBUSI CTWA TERBUKTI)", periode);
  meta.forEach(([k, v]) => sb.row([k, v || "—"]));
  sb.blank();
  sb.row(kolom);
  const rupiahKol = new Set([9, 10, 11, 12]);
  isi.forEach((r) => sb.row(r.map((v, i) => (i >= 4 && i !== 13 ? (rupiahKol.has(i) ? rp(v) : num(v, i >= 14 ? "0.00" : FMT.int)) : (v === "" || v == null ? "—" : v)))));
  return sb.build([9, 12, 36, 20, 16, 8, 12, 12, 12, 16, 16, 14, 14, 24, 11, 11]);
}
