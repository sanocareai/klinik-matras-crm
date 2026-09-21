import { api } from "@/auth/session";
import { ApiError } from "@/api/errors";
import { isMoneyString, toMoney, type Money } from "@/lib/money";
import { ENV } from "@/lib/env";
import { mockDaftarPemasukan, mockRingkasanPemasukan } from "@/mocks/pemasukan";

// PEMASUKAN TERPADU (v1.1.0) — HANYA memetakan hasil server. Klasifikasi, total, pendapatan gabungan, piutang, dan dana masuk dihitung SERVER.
//   GET /finance/pemasukan/ringkasan?from&to   GET /finance/pemasukan?from&to&kategori&status&rekening&q&page&limit
// Aplikasi TIDAK mengimpor Data Sebelum Sistem dan tidak mencatat pemasukan (impor & posting tetap di web).

export const LIMIT_PEMASUKAN = 20;
export type KategoriPemasukan = "PENDAPATAN" | "PEMBAYARAN" | "LAIN" | "DANA" | "HISTORIS" | "DITINJAU" | "DIKECUALIKAN";
export type NadaP = "success" | "warning" | "danger" | "info" | "neutral";
const KATEGORI: KategoriPemasukan[] = ["PENDAPATAN", "PEMBAYARAN", "LAIN", "DANA", "HISTORIS", "DITINJAU", "DIKECUALIKAN"];
const NADA: NadaP[] = ["success", "warning", "danger", "info", "neutral"];
export const PERINGATAN_PENDAPATAN_2026 = "Pendapatan 2026 masih dalam proses rekonsiliasi data sebelum sistem dan backfill order. Angka belum final.";

export const LABEL_KATEGORI: Record<KategoriPemasukan, string> = {
  PENDAPATAN: "Pendapatan Penjualan", PEMBAYARAN: "Pembayaran Masuk", LAIN: "Pemasukan Lain", DANA: "Dana Masuk Bukan Pendapatan", HISTORIS: "Data Sebelum Sistem", DITINJAU: "Perlu Ditinjau", DIKECUALIKAN: "Dikecualikan",
};

export type BarisPemasukan = {
  key: string; jenis: "jurnal" | "pembayaran" | "historis"; id: string; tanggal: string; nomor: string; sumber: string; sumberLabel: string; pihak: string | null; keterangan: string; rekening: string | null;
  nilai: Money; status: string; statusLabel: string; nada: NadaP; kategori: KategoriPemasukan; kategoriLabel: string; sub: string; subLabel: string; perluTinjau: boolean; catatan: string | null;
  dihitung: boolean | null;
  tautan: { jurnal: { id: string; nomor: string } | null; pembayaran: { id: string } | null; invoice: { id: string; nomor: string } | null; dokumen: { modul: string; id: string } | null };
};
export type HalamanPemasukan = { items: BarisPemasukan[]; page: number; total: number; adaLagi: boolean; totalNilai: Money; terpotong: boolean; diperbaruiPada: string | null };
export type JumlahNilai = { jumlah: number; nilai: Money };
export type RingkasanPemasukan = {
  periode: { from: string; to: string }; terpotong: boolean; labelHistoris: string;
  pendapatanSistem: JumlahNilai & { bruto: Money; retur: Money };
  pendapatanHistoris: JumlahNilai & { lunas: Money; belumBayar: Money; perluDitinjau: JumlahNilai };
  pendapatanGabungan: { nilai: Money; catatan: string };
  pembayaranMasuk: { terverifikasi: JumlahNilai; menunggu: JumlahNilai; tidakDihitung: JumlahNilai; belumDibukukan: JumlahNilai };
  piutangTersisa: { nilai: Money; jumlahOrder: number; perTanggal: string | null };
  pemasukanLain: JumlahNilai;
  danaMasukBukanPendapatan: JumlahNilai & { rincian: { sub: string; label: string; nilai: Money; jumlah: number }[] };
  perluDitinjau: JumlahNilai;
  dikecualikan: { transfer: JumlahNilai; saldoAwal: JumlahNilai; pembalikanBiaya: JumlahNilai };
  cutoff: { tanggal: string | null; dasar: string; celah: { jumlahOrder: number; nilaiOrder: Money; dari: string; sampai: string } | null };
  penjelasan: string[];
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const teks = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const angka = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const uang = (v: unknown): Money | null => (typeof v === "string" && isMoneyString(v) ? (v as Money) : null);
const NOL: Money = toMoney("0.00");
const jn = (v: unknown): JumlahNilai => { const o = obj(v); return { jumlah: angka(o?.jumlah), nilai: uang(o?.nilai) ?? NOL }; };

export const NORMALISASI_PEMASUKAN = { uang: [], hitungan: ["jumlah", "jumlahOrder", "total", "page", "limit"] };

export function mapBaris(raw: unknown): BarisPemasukan | null {
  const o = obj(raw);
  const nilai = uang(o?.nilai);
  if (!o || typeof o.key !== "string" || typeof o.id !== "string" || !nilai || !KATEGORI.includes(o.kategori as KategoriPemasukan)) return null; // fail-closed: baris tak lengkap dijatuhkan
  const t = obj(o.tautan);
  const j = obj(t?.jurnal); const p = obj(t?.pembayaran); const iv = obj(t?.invoice); const d = obj(t?.dokumen);
  return {
    key: o.key, jenis: (["jurnal", "pembayaran", "historis"].includes(String(o.jenis)) ? o.jenis : "jurnal") as BarisPemasukan["jenis"], id: o.id, tanggal: teks(o.tanggal) ?? "", nomor: teks(o.nomor) ?? "—",
    sumber: teks(o.sumber) ?? "", sumberLabel: teks(o.sumberLabel) ?? teks(o.sumber) ?? "", pihak: teks(o.pihak), keterangan: teks(o.keterangan) ?? "(tanpa keterangan)", rekening: teks(o.rekening), nilai,
    status: teks(o.status) ?? "", statusLabel: teks(o.statusLabel) ?? "—", nada: NADA.includes(o.nada as NadaP) ? (o.nada as NadaP) : "neutral", kategori: o.kategori as KategoriPemasukan, kategoriLabel: teks(o.kategoriLabel) ?? LABEL_KATEGORI[o.kategori as KategoriPemasukan],
    sub: teks(o.sub) ?? "", subLabel: teks(o.subLabel) ?? "", perluTinjau: o.perluTinjau === true, catatan: teks(o.catatan), dihitung: typeof o.dihitung === "boolean" ? o.dihitung : null,
    tautan: {
      jurnal: j && typeof j.id === "string" ? { id: j.id, nomor: teks(j.nomor) ?? "—" } : null, pembayaran: p && typeof p.id === "string" ? { id: p.id } : null,
      invoice: iv && typeof iv.id === "string" ? { id: iv.id, nomor: teks(iv.nomor) ?? "—" } : null, dokumen: d && typeof d.id === "string" && typeof d.modul === "string" ? { modul: d.modul, id: d.id } : null,
    },
  };
}

export function mapHalaman(raw: unknown): HalamanPemasukan {
  const o = obj(raw);
  return {
    items: (Array.isArray(o?.items) ? o.items : []).map(mapBaris).filter((x): x is BarisPemasukan => x != null), page: angka(o?.page) || 1, total: angka(o?.total), adaLagi: o?.adaLagi === true,
    totalNilai: uang(o?.totalNilai) ?? NOL, terpotong: o?.terpotong === true, diperbaruiPada: teks(o?.diperbaruiPada),
  };
}

export function mapRingkasan(raw: unknown): RingkasanPemasukan | null {
  const o = obj(raw);
  const ps = obj(o?.pendapatanSistem); const ph = obj(o?.pendapatanHistoris); const pg = obj(o?.pendapatanGabungan); const pm = obj(o?.pembayaranMasuk); const pt = obj(o?.piutangTersisa);
  const dm = obj(o?.danaMasukBukanPendapatan); const dk = obj(o?.dikecualikan); const ct = obj(o?.cutoff); const per = obj(o?.periode);
  if (!o || !ps || !ph || !pg || !pm || !pt || !dm || !dk || !per || !uang(ps.nilai) || !uang(pg.nilai)) return null;
  const celah = obj(ct?.celahPengakuan);
  return {
    periode: { from: teks(per.from) ?? "", to: teks(per.to) ?? "" }, terpotong: o.terpotong === true, labelHistoris: teks(o.labelHistoris) ?? "",
    pendapatanSistem: { ...jn(ps), bruto: uang(ps.bruto) ?? NOL, retur: uang(ps.retur) ?? NOL },
    pendapatanHistoris: { ...jn(ph), lunas: uang(ph.lunas) ?? NOL, belumBayar: uang(ph.belumBayar) ?? NOL, perluDitinjau: jn(ph.perluDitinjau) },
    pendapatanGabungan: { nilai: uang(pg.nilai) ?? NOL, catatan: teks(pg.catatan) ?? "" },
    pembayaranMasuk: { terverifikasi: jn(pm.terverifikasi), menunggu: jn(pm.menunggu), tidakDihitung: jn(pm.tidakDihitung), belumDibukukan: jn(pm.belumDibukukan) },
    piutangTersisa: { nilai: uang(pt.nilai) ?? NOL, jumlahOrder: angka(pt.jumlahOrder), perTanggal: teks(pt.perTanggal) },
    pemasukanLain: jn(o.pemasukanLain),
    danaMasukBukanPendapatan: { ...jn(dm), rincian: (Array.isArray(dm.rincian) ? dm.rincian : []).flatMap((r) => { const x = obj(r); const n = uang(x?.nilai); return x && n ? [{ sub: teks(x.sub) ?? "", label: teks(x.label) ?? "", nilai: n, jumlah: angka(x.jumlah) }] : []; }) },
    perluDitinjau: jn(o.perluDitinjau), dikecualikan: { transfer: jn(dk.transfer), saldoAwal: jn(dk.saldoAwal), pembalikanBiaya: jn(dk.pembalikanBiaya) },
    cutoff: { tanggal: teks(ct?.tanggal), dasar: teks(ct?.dasar) ?? "", celah: celah ? { jumlahOrder: angka(celah.jumlahOrder), nilaiOrder: uang(celah.nilaiOrder) ?? NOL, dari: teks(celah.dari) ?? "", sampai: teks(celah.sampai) ?? "" } : null },
    penjelasan: (Array.isArray(o.penjelasan) ? o.penjelasan : []).filter((x): x is string => typeof x === "string"),
  };
}

export type FilterPemasukan = { from: string; to: string; kategori: KategoriPemasukan | null; q: string };

export async function fetchRingkasanPemasukan(from: string, to: string): Promise<RingkasanPemasukan> {
  if (ENV.useMocks) return mockRingkasanPemasukan(from, to);
  const r = mapRingkasan(await api.get<unknown>("/finance/pemasukan/ringkasan", { query: { from, to }, normalisasi: NORMALISASI_PEMASUKAN }));
  if (!r) throw new ApiError({ status: 502, code: "PARSE", message: "Respons server tidak bisa dibaca" });
  return r;
}

export async function fetchDaftarPemasukan(f: FilterPemasukan, page: number): Promise<HalamanPemasukan> {
  if (ENV.useMocks) return mockDaftarPemasukan(f, page);
  return mapHalaman(await api.get<unknown>("/finance/pemasukan", { query: { from: f.from, to: f.to, kategori: f.kategori ?? undefined, q: f.q.trim() || undefined, page, limit: LIMIT_PEMASUKAN }, normalisasi: NORMALISASI_PEMASUKAN }));
}
