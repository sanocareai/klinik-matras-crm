import { api } from "@/auth/session";
import { ApiError } from "@/api/errors";
import { formatRupiah, isMoneyString, type Money } from "@/lib/money";
import { ENV } from "@/lib/env";
import { mockLaporanNyata } from "@/mocks/laporanNyata";
import type { BagianLaporan, BarisLaporanNyata, DrillLaporan, JenisLaporanNyata, LaporanNyata, NadaTx, RingkasanLaporan } from "./types";

// LAPORAN (S10) — HANYA menata hasil server. Laba, margin, saldo, selisih, arus kas, umur piutang/utang, dan indikator seimbang dihitung server; klien tidak
// menjumlah, mengurangi, atau membandingkan uang. Nilai negatif tampil utuh (string desimal). Endpoint = endpoint yang dipakai web:
//   GET /finance/reports/income-statement|cash-flow|trial-balance?from&to · balance-sheet|receivables|payables?to
// Perbandingan periode & ekspor file dari server TIDAK tersedia di backend (gap terdokumentasi).

export const JENIS_LAPORAN: JenisLaporanNyata[] = ["laba-rugi", "neraca", "arus-kas", "neraca-saldo", "umur-piutang", "umur-utang"];
const JUDUL: Record<JenisLaporanNyata, string> = {
  "laba-rugi": "Laba Rugi", neraca: "Neraca", "arus-kas": "Arus Kas", "neraca-saldo": "Neraca Saldo", "umur-piutang": "Umur Piutang", "umur-utang": "Umur Utang",
};
const PATH: Record<JenisLaporanNyata, string> = {
  "laba-rugi": "income-statement", neraca: "balance-sheet", "arus-kas": "cash-flow", "neraca-saldo": "trial-balance", "umur-piutang": "receivables", "umur-utang": "payables",
};
/** Laporan posisi per tanggal (hanya `to`) vs laporan periode (`from` & `to`). */
export const LAPORAN_PER_TANGGAL: JenisLaporanNyata[] = ["neraca", "umur-piutang", "umur-utang"];

export const NORMALISASI_LAPORAN = {
  // marginKotor/marginBersih = persen (bukan uang). `terbayar`/`hariLewat` tidak tertangkap pola uang bawaan.
  uang: ["terbayar", "mutasiDebit", "mutasiKredit", "saldoDebit", "saldoKredit", "belum_jatuh_tempo", "1_30", "31_60", "61_90", "90_plus"],
  hitungan: ["marginKotor", "marginBersih", "hariLewat", "jumlah", "gapTerbuka", "periodeTerbuka"],
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const teks = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const angka = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const uang = (v: unknown): Money | null => (typeof v === "string" && isMoneyString(v) ? (v as Money) : null);
const daftar = (v: unknown): Obj[] => (Array.isArray(v) ? v.flatMap((x) => { const o = obj(x); return o ? [o] : []; }) : []);

const rs = (label: string, nilai: unknown, tebal = false, nada: NadaTx | null = null): RingkasanLaporan => ({ label, nilai: uang(nilai), teks: null, tebal, nada });
const persen = (label: string, v: unknown): RingkasanLaporan | null => {
  const n = angka(v);
  // Persen datang dari server; klien hanya menuliskannya (format id-ID, tanpa menghitung).
  return n == null ? null : { label, nilai: null, teks: `${String(n).replace(".", ",")}%`, tebal: false, nada: null };
};

function barisAkun(rows: unknown, sub?: (o: Obj) => string | null): BarisLaporanNyata[] {
  return daftar(rows).flatMap((o): BarisLaporanNyata[] => {
    const nilai = uang(o.nilai ?? o.saldo);
    if (!nilai) return [];
    const id = teks(o.accountId);
    // Baris sintetis ("laba-tahun-sebelumnya") bukan akun sungguhan → tidak bisa di-drill.
    const drill: DrillLaporan | null = id && /^[0-9a-f-]{36}$/i.test(id) ? { tipe: "akun", id } : null;
    return [{ kunci: `${id ?? teks(o.code) ?? teks(o.name)}`, kode: teks(o.code ?? o.kode), nama: teks(o.name ?? o.nama) ?? "—", nilai, sub: sub ? sub(o) : null, drill }];
  });
}

const bagian = (judul: string, baris: BarisLaporanNyata[]): BagianLaporan => ({ judul, baris });

function catatanDari(v: unknown): string[] {
  const o = obj(v);
  return Array.isArray(o?.pesan) ? o.pesan.filter((p): p is string => typeof p === "string" && p !== "") : [];
}

const EMBER_LABEL: Record<string, string> = { belum_jatuh_tempo: "Belum jatuh tempo", "1_30": "1–30 hari", "31_60": "31–60 hari", "61_90": "61–90 hari", "90_plus": "> 90 hari" };
const EMBER_URUT = ["belum_jatuh_tempo", "1_30", "31_60", "61_90", "90_plus"];

function umurBagian(baris: Obj[], mapBaris: (o: Obj) => BarisLaporanNyata | null): BagianLaporan[] {
  const kelompok = new Map<string, BarisLaporanNyata[]>();
  for (const o of baris) {
    const b = mapBaris(o);
    if (!b) continue;
    const k = teks(o.ember) ?? "belum_jatuh_tempo";
    kelompok.set(k, [...(kelompok.get(k) ?? []), b]);
  }
  return EMBER_URUT.filter((k) => kelompok.has(k)).map((k) => bagian(EMBER_LABEL[k] ?? k, kelompok.get(k) ?? []));
}

/** Payload laporan (SUDAH dinormalkan: uang = string desimal) → tampilan. Bagian yang hilang dilaporkan di `bagianKosong` (data parsial), tidak melempar. */
export function mapLaporan(jenis: JenisLaporanNyata, raw: unknown, tanggalAcuan: string): LaporanNyata {
  const r = obj(raw) ?? {};
  const hilang: string[] = [];
  let ringkasan: RingkasanLaporan[] = [];
  let bag: BagianLaporan[] = [];
  let seimbang: boolean | null = null;
  let selisih: Money | null = null;
  let periode = "";

  if (jenis === "laba-rugi") {
    const g = obj(r.ringkasan);
    if (!g) hilang.push("ringkasan");
    const p = obj(r.periode);
    periode = `${teks(p?.from)?.slice(0, 10) ?? ""} – ${teks(p?.to)?.slice(0, 10) ?? ""}`;
    ringkasan = g ? [
      rs("Pendapatan bruto", g.pendapatanBruto), rs("Retur & potongan", g.retur), rs("Pendapatan bersih", g.pendapatanBersih, true), rs("Beban pokok", g.bebanPokok),
      rs("Laba kotor", g.labaKotor, true), ...(persen("Margin kotor", g.marginKotor) ? [persen("Margin kotor", g.marginKotor) as RingkasanLaporan] : []),
      rs("Beban operasional", g.bebanOperasional), rs("Laba bersih", g.labaBersih, true), ...(persen("Margin bersih", g.marginBersih) ? [persen("Margin bersih", g.marginBersih) as RingkasanLaporan] : []),
    ].filter((x) => x.nilai != null || x.teks != null) : [];
    bag = [bagian("Pendapatan", barisAkun(r.pendapatan)), bagian("Retur & potongan penjualan", barisAkun(r.retur)), bagian("Beban pokok", barisAkun(r.bebanPokok)), bagian("Beban operasional", barisAkun(r.bebanOperasional))];
  } else if (jenis === "neraca") {
    const g = obj(r.ringkasan);
    if (!g) hilang.push("ringkasan");
    periode = `Per ${tanggalAcuan}`;
    seimbang = g ? g.seimbang === true : null;
    selisih = uang(g?.selisih);
    ringkasan = g ? [rs("Total aset", g.totalAset, true), rs("Total kewajiban", g.totalKewajiban), rs("Total ekuitas", g.totalEkuitas), rs("Total kewajiban + ekuitas", g.totalPasiva, true), rs("Selisih (aset − kewajiban − ekuitas)", g.selisih, true, g.seimbang === true ? "success" : "danger")].filter((x) => x.nilai != null) : [];
    const ekuitas = barisAkun(r.ekuitas);
    const labaBerjalan = uang(r.labaTahunBerjalan);
    // Laba/rugi tahun berjalan adalah baris tersendiri dari server (bukan bagian daftar `ekuitas`): ditampilkan agar penjumlahan terlihat utuh.
    if (labaBerjalan) ekuitas.push({ kunci: "laba-tahun-berjalan", kode: "—", nama: "Laba/rugi tahun berjalan", nilai: labaBerjalan, sub: "Sejak 1 Januari tahun ini", drill: null });
    const sebelumnya = ekuitas.find((b) => b.kunci === "laba-tahun-sebelumnya");
    if (sebelumnya) sebelumnya.sub = "Belum ditutup ke Laba Ditahan (sistem belum punya tutup buku)";
    bag = [bagian("Aset", barisAkun(r.aset)), bagian("Kewajiban", barisAkun(r.kewajiban)), bagian("Ekuitas", ekuitas)];
  } else if (jenis === "arus-kas") {
    const g = obj(r.ringkasan);
    if (!g) hilang.push("ringkasan");
    const p = obj(r.periode);
    periode = `${teks(p?.from)?.slice(0, 10) ?? ""} – ${teks(p?.to)?.slice(0, 10) ?? ""}`;
    ringkasan = g ? [rs("Saldo awal kas & bank", g.saldoAwal), rs("Uang masuk", g.masuk), rs("Uang keluar", g.keluar), rs("Arus bersih", g.arusBersih, true), rs("Saldo akhir kas & bank", g.saldoAkhir, true)].filter((x) => x.nilai != null) : [];
    bag = [bagian("Operasi", barisAkun(r.operasi)), bagian("Investasi", barisAkun(r.investasi)), bagian("Pendanaan", barisAkun(r.pendanaan)), bagian("Belum dikategorikan", barisAkun(r.takTerkategori))];
  } else if (jenis === "neraca-saldo") {
    const t = obj(r.total);
    if (!t) hilang.push("total");
    const p = obj(r.periode);
    periode = `${teks(p?.from)?.slice(0, 10) ?? ""} – ${teks(p?.to)?.slice(0, 10) ?? ""}`;
    seimbang = t ? t.seimbang === true : null;
    selisih = uang(t?.selisih);
    ringkasan = t ? [rs("Total mutasi debit", t.mutasiDebit), rs("Total mutasi kredit", t.mutasiKredit), rs("Selisih debit − kredit", t.selisih, true, t.seimbang === true ? "success" : "danger")].filter((x) => x.nilai != null) : [];
    const baris = barisAkun(r.baris, (o) => `Mutasi debit ${uang(o.mutasiDebit) ? formatRupiah(uang(o.mutasiDebit) as Money) : "—"} · kredit ${uang(o.mutasiKredit) ? formatRupiah(uang(o.mutasiKredit) as Money) : "—"}`);
    const tipe = new Map<string, BarisLaporanNyata[]>();
    daftar(r.baris).forEach((o, i) => { const b = baris.find((x) => x.kunci === (teks(o.accountId) ?? "")) ?? baris[i]; if (b) tipe.set(teks(o.type) ?? "LAIN", [...(tipe.get(teks(o.type) ?? "LAIN") ?? []), b]); });
    const LABEL: Record<string, string> = { ASET: "Aset", KEWAJIBAN: "Kewajiban", EKUITAS: "Ekuitas", PENDAPATAN: "Pendapatan", BEBAN_POKOK: "Beban pokok", BEBAN: "Beban", LAIN: "Lainnya" };
    bag = ["ASET", "KEWAJIBAN", "EKUITAS", "PENDAPATAN", "BEBAN_POKOK", "BEBAN", "LAIN"].filter((k) => tipe.has(k)).map((k) => bagian(LABEL[k] ?? k, tipe.get(k) ?? []));
  } else if (jenis === "umur-piutang") {
    periode = `Per ${tanggalAcuan}`;
    const g = obj(r.ringkasan);
    if (!g) hilang.push("ringkasan");
    const mv = obj(r.menungguVerifikasi);
    ringkasan = [
      rs("Total piutang", r.total, true), ...(g ? EMBER_URUT.map((k) => rs(EMBER_LABEL[k] ?? k, g[k])).filter((x) => x.nilai != null && !/^0+(\.0+)?$/.test(String(x.nilai))) : []),
      ...(mv && uang(mv.total) && (angka(mv.jumlah) ?? 0) > 0 ? [rs(`Lunas di CRM, menunggu verifikasi · ${angka(mv.jumlah)}`, mv.total)] : []),
    ].filter((x) => x.nilai != null);
    bag = umurBagian(daftar(r.baris), (o) => {
      const nilai = uang(o.sisaTagihan);
      const id = teks(o.orderId);
      if (!nilai || !id) return null;
      const lewat = angka(o.hariLewat);
      return { kunci: id, kode: teks(o.invoiceNumber) ?? teks(o.orderNumber), nama: teks(o.customerName) ?? "—", nilai, sub: `${teks(o.orderNumber) ? `Order ${teks(o.orderNumber)} · ` : ""}${lewat != null && lewat > 0 ? `lewat ${lewat} hari` : "belum jatuh tempo"} (${teks(o.sumberJatuhTempo) === "invoice" ? "jatuh tempo invoice" : "dari tanggal order"})`, drill: { tipe: "piutang", id } };
    });
  } else {
    periode = `Per ${tanggalAcuan}`;
    const g = obj(r.ringkasan);
    if (!g) hilang.push("ringkasan");
    ringkasan = [rs("Total utang usaha", r.total, true), ...(g ? EMBER_URUT.map((k) => rs(EMBER_LABEL[k] ?? k, g[k])).filter((x) => x.nilai != null && !/^0+(\.0+)?$/.test(String(x.nilai))) : [])].filter((x) => x.nilai != null);
    bag = umurBagian(daftar(r.baris), (o) => {
      const nilai = uang(o.sisa);
      const id = teks(o.billId);
      if (!nilai || !id) return null;
      const lewat = angka(o.hariLewat);
      return { kunci: id, kode: teks(o.billNumber), nama: teks(o.supplierName) ?? "—", nilai, sub: `${lewat != null && lewat > 0 ? `lewat ${lewat} hari` : "belum jatuh tempo"} (${teks(o.sumberJatuhTempo) === "tagihan" ? "jatuh tempo tagihan" : "dari tanggal tagihan"})`, drill: { tipe: "tagihan", id } };
    });
  }
  return {
    jenis, judul: JUDUL[jenis], periode, tanggalAcuan, ringkasan, bagian: bag.filter((b) => b.baris.length > 0), seimbang, selisih, catatan: catatanDari(r.catatan), bagianKosong: hilang,
    diperbaruiPada: new Date().toISOString(),
  };
}

export async function fetchLaporan(jenis: JenisLaporanNyata, periode: { from: string; to: string }): Promise<LaporanNyata> {
  if (ENV.useMocks) return mockLaporanNyata(jenis, periode);
  const raw = await api.get<unknown>(`/finance/reports/${PATH[jenis]}`, {
    query: LAPORAN_PER_TANGGAL.includes(jenis) ? { to: periode.to } : { from: periode.from, to: periode.to }, normalisasi: NORMALISASI_LAPORAN,
  });
  if (!obj(raw)) throw new ApiError({ status: 502, code: "PARSE", message: "Respons server tidak bisa dibaca" });
  return mapLaporan(jenis, raw, periode.to);
}

/** Teks ringkas untuk dibagikan — disusun dari HASIL server yang sedang tampil (format saja; tidak ada perhitungan). */
export function teksBagikan(l: LaporanNyata): string {
  const baris = [`SANO Finance — ${l.judul}`, l.periode, ""];
  for (const r of l.ringkasan) baris.push(`${r.label}: ${r.nilai ? formatRupiah(r.nilai) : r.teks ?? ""}`);
  if (l.seimbang === false) baris.push("", "⚠ Laporan TIDAK seimbang. Periksa jurnal di web.");
  baris.push("", `Diambil dari server ${new Date(l.diperbaruiPada).toISOString().slice(0, 16).replace("T", " ")} UTC. Sumber resmi: web Finance.`);
  return baris.join("\n");
}
