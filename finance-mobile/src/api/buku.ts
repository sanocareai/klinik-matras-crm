import { api } from "@/auth/session";
import { ApiError } from "@/api/errors";
import { jalankanPerintah } from "@/api/command";
import { petaRiwayat } from "@/api/approvals";
import { isMoneyString, toMoney, type Money } from "@/lib/money";
import { ENV } from "@/lib/env";
import { mockCocokkan, mockDaftarAkun, mockDaftarJurnal, mockDaftarRekon, mockDetailJurnal, mockDetailRekon, mockLepas, mockMutasiAkun } from "@/mocks/buku";
import type {
  AksiTx, AkunPilihan, BarisBuku, BarisJurnal, BarisRekon, BukuBesarHalaman, DetailJurnal, DokumenJurnal, FilterJurnal, HalamanJurnal, JurnalItem, KandidatRekon,
  ModulTx, NadaTx, RekonDetail, RekonItem,
} from "./types";

// BUKU (S9) — HANYA memetakan bentuk dari server. Total debit/kredit, indikator seimbang, saldo berjalan, saldo buku, dan selisih koran dihitung server.
//   GET /finance/buku/jurnal[/:id]   GET /finance/buku/akun   GET /finance/buku/akun/:id/mutasi   GET /finance/buku/rekon[/:id]
//   POST /finance/bank-lines/:id/match | unmatch   (FINANCE_POST; Idempotency-Key + step-up; tanpa antrean offline)
// Jurnal manual, reversal, edit jurnal, tutup periode, dan koreksi saldo TIDAK ada di aplikasi (hanya web).

export const LIMIT_BUKU = 20;
const NADA: NadaTx[] = ["success", "warning", "danger", "info", "neutral"];
export const NORMALISASI_BUKU = {
  uang: [],
  hitungan: ["total", "page", "limit", "jumlahBaris", "jumlah", "no", "belumCocok", "cocokBaris", "diabaikan", "tidakSeimbang", "mutasiBukuBelumDipasangkan", "POSTED", "REVERSED", "DRAFT", "VOID"],
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const teks = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const angka = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const uang = (v: unknown): Money | null => (typeof v === "string" && isMoneyString(v) ? (v as Money) : null);
const NOL: Money = toMoney("0.00");
const nada = (v: unknown): NadaTx => (NADA.includes(v as NadaTx) ? (v as NadaTx) : "neutral");
const orang = (v: unknown) => { const o = obj(v); return o && typeof o.id === "string" ? { id: o.id, name: teks(o.name) ?? "—" } : null; };

const MODUL_DOK: (ModulTx | "pembayaran")[] = ["pengeluaran", "pembelian", "kasbon", "pemasukan", "piutang", "refund", "supplier", "tagihan", "pembayaran-supplier", "pembayaran"];

function petaDokumen(v: unknown): DokumenJurnal | null {
  const o = obj(v);
  return o && typeof o.id === "string" && MODUL_DOK.includes(o.modul as ModulTx) ? { modul: o.modul as ModulTx | "pembayaran", id: o.id, nomor: teks(o.nomor) ?? "—" } : null;
}
const tautanJurnal = (v: unknown) => { const o = obj(v); return o && typeof o.id === "string" ? { id: o.id, nomor: teks(o.nomor) ?? "—" } : null; };

export function mapJurnalItem(raw: unknown): JurnalItem | null {
  const o = obj(raw);
  const d = uang(o?.totalDebit);
  const k = uang(o?.totalKredit);
  if (!o || typeof o.id !== "string" || !d || !k) return null;
  return {
    id: o.id, nomor: teks(o.nomor) ?? "—", tanggal: teks(o.tanggal) ?? "", keterangan: teks(o.keterangan) ?? "(tanpa keterangan)", sumber: teks(o.sumber) ?? "", sumberLabel: teks(o.sumberLabel) ?? teks(o.sumber) ?? "",
    status: teks(o.status) ?? "", statusLabel: teks(o.statusLabel) ?? "—", nada: nada(o.nada), totalDebit: d, totalKredit: k,
    // Fail-closed: bila server tidak menyatakan seimbang secara eksplisit, jangan dianggap seimbang.
    seimbang: o.seimbang === true, selisih: uang(o.selisih) ?? NOL, jumlahBaris: angka(o.jumlahBaris) ?? 0,
    membalik: tautanJurnal(o.membalik), dibalikOleh: tautanJurnal(o.dibalikOleh), dokumen: petaDokumen(o.dokumen), dibuatOleh: orang(o.dibuatOleh),
  };
}

export function mapHalamanJurnal(raw: unknown): HalamanJurnal {
  const o = obj(raw) ?? {};
  const h = obj(o.hitung) ?? {};
  return {
    items: (Array.isArray(o.items) ? o.items : []).map(mapJurnalItem).filter((x): x is JurnalItem => x != null), page: angka(o.page) ?? 1, total: angka(o.total) ?? 0,
    adaLagi: o.adaLagi === true, hitung: Object.fromEntries(Object.entries(h).flatMap(([k, x]) => (typeof x === "number" ? [[k, x]] : []))),
    tidakSeimbang: angka(o.tidakSeimbang) ?? 0, diperbaruiPada: teks(o.diperbaruiPada),
  };
}

export function mapDetailJurnal(raw: unknown): DetailJurnal | null {
  const item = mapJurnalItem(raw);
  const o = obj(raw);
  if (!item || !o) return null;
  const baris = (Array.isArray(o.baris) ? o.baris : []).flatMap((b): BarisJurnal[] => {
    const x = obj(b);
    const debit = uang(x?.debit);
    const kredit = uang(x?.kredit);
    if (!x || !debit || !kredit || typeof x.akunId !== "string") return [];
    const ord = obj(x.order);
    return [{
      no: angka(x.no) ?? 0, akunId: x.akunId, kodeAkun: teks(x.kodeAkun) ?? "", namaAkun: teks(x.namaAkun) ?? "—", debit, kredit, keterangan: teks(x.keterangan),
      order: ord && typeof ord.id === "string" ? { id: ord.id, nomor: teks(ord.nomor) } : null, pelanggan: teks(x.pelanggan), supplier: teks(x.supplier), rekening: teks(x.rekening),
    }];
  });
  const dp = obj(o.diposting);
  return { ...item, baris, diposting: { pada: teks(dp?.pada), oleh: orang(dp?.oleh) }, alasanBalik: teks(o.alasanBalik), riwayat: petaRiwayat(o.riwayat), catatan: teks(o.catatan) };
}

export function mapAkun(raw: unknown): AkunPilihan[] {
  const o = obj(raw);
  return (Array.isArray(o?.akun) ? o.akun : []).flatMap((a): AkunPilihan[] => {
    const x = obj(a);
    return x && typeof x.id === "string" ? [{ id: x.id, code: teks(x.code) ?? "", name: teks(x.name) ?? "—", type: teks(x.type) ?? "", normalBalance: teks(x.normalBalance) ?? "", active: x.active !== false }] : [];
  });
}

export function mapBuku(raw: unknown): BukuBesarHalaman | null {
  const o = obj(raw);
  const a = obj(o?.akun);
  const p = obj(o?.periode);
  const awal = uang(o?.saldoAwal);
  const akhir = uang(o?.saldoAkhir);
  if (!o || !a || typeof a.id !== "string" || !awal || !akhir) return null;
  const baris = (Array.isArray(o.baris) ? o.baris : []).flatMap((b): BarisBuku[] => {
    const x = obj(b);
    const debit = uang(x?.debit);
    const kredit = uang(x?.kredit);
    const saldo = uang(x?.saldo);
    if (!x || typeof x.lineId !== "string" || !debit || !kredit || !saldo) return [];
    return [{ lineId: x.lineId, jurnalId: teks(x.jurnalId) ?? "", nomor: teks(x.nomor) ?? "—", tanggal: teks(x.tanggal) ?? "", keterangan: teks(x.keterangan) ?? "", sumber: teks(x.sumber) ?? "", sumberLabel: teks(x.sumberLabel) ?? "", status: teks(x.status) ?? "", debit, kredit, saldo, penanda: teks(x.penanda) }];
  });
  return {
    akun: { id: a.id, kode: teks(a.kode) ?? "", nama: teks(a.nama) ?? "—", tipe: teks(a.tipe) ?? "", saldoNormal: teks(a.saldoNormal) ?? "" }, periode: { from: teks(p?.from) ?? "", to: teks(p?.to) ?? "" },
    saldoAwal: awal, totalDebit: uang(o.totalDebit) ?? NOL, totalKredit: uang(o.totalKredit) ?? NOL, saldoAkhir: akhir, total: angka(o.total) ?? baris.length, page: angka(o.page) ?? 1,
    adaLagi: o.adaLagi === true, baris, diperbaruiPada: teks(o.diperbaruiPada),
  };
}

const AWAL_PATH_REKON = /^\/finance\/bank-lines\/[^/]+\/(match|unmatch)$/;
function petaAksi(v: unknown): AksiTx {
  const o = obj(v);
  const path = teks(o?.path) ?? "";
  const ok = o?.boleh === true && AWAL_PATH_REKON.test(path);
  return { boleh: ok, alasan: teks(o?.alasan) ?? (ok ? null : "Tidak tersedia."), path, metode: "POST", perlu: [], tetap: null };
}

export function mapRekonItem(raw: unknown): RekonItem | null {
  const o = obj(raw);
  const r = obj(o?.rekening);
  const p = obj(o?.periode);
  const koran = uang(o?.saldoKoran);
  const buku = uang(o?.saldoBuku);
  if (!o || typeof o.id !== "string" || !r || typeof r.id !== "string" || !koran || !buku) return null;
  return {
    id: o.id, rekening: { id: r.id, name: teks(r.name) ?? "—" }, periode: { from: teks(p?.from) ?? "", to: teks(p?.to) ?? "" }, status: teks(o.status) ?? "", statusLabel: teks(o.statusLabel) ?? "—", nada: nada(o.nada),
    saldoKoran: koran, saldoBuku: buku, selisih: uang(o.selisih) ?? NOL, cocok: o.cocok === true, jumlahBaris: angka(o.jumlahBaris) ?? 0, belumCocok: angka(o.belumCocok) ?? 0,
    cocokBaris: angka(o.cocokBaris) ?? 0, diabaikan: angka(o.diabaikan) ?? 0,
  };
}

function petaKandidat(v: unknown): KandidatRekon[] {
  return (Array.isArray(v) ? v : []).flatMap((k): KandidatRekon[] => {
    const x = obj(k);
    const nilai = uang(x?.nilai);
    return x && typeof x.lineId === "string" && nilai ? [{ lineId: x.lineId, jurnalId: teks(x.jurnalId) ?? "", nomor: teks(x.nomor) ?? "—", tanggal: teks(x.tanggal) ?? "", keterangan: teks(x.keterangan) ?? "", sumber: teks(x.sumber) ?? "", nilai }] : [];
  });
}

export function mapRekonDetail(raw: unknown): RekonDetail | null {
  const item = mapRekonItem({ ...(obj(raw) ?? {}), jumlahBaris: 0 });
  const o = obj(raw);
  if (!item || !o) return null;
  const rg = obj(o.ringkasan);
  const baris = (Array.isArray(o.baris) ? o.baris : []).flatMap((b): BarisRekon[] => {
    const x = obj(b);
    const nominal = uang(x?.nominal);
    if (!x || typeof x.id !== "string" || !nominal) return [];
    const cd = obj(x.cocokDengan);
    const cdNilai = uang(cd?.nilai);
    const dc = obj(x.dicocokkan);
    const aksi = obj(x.aksi);
    return [{
      id: x.id, tanggal: teks(x.tanggal) ?? "", keterangan: teks(x.keterangan) ?? "", referensi: teks(x.referensi), nominal, status: teks(x.status) ?? "", statusLabel: teks(x.statusLabel) ?? "—", nada: nada(x.nada), catatan: teks(x.catatan),
      cocokDengan: cd && typeof cd.lineId === "string" && cdNilai ? { lineId: cd.lineId, jurnalId: teks(cd.jurnalId) ?? "", nomor: teks(cd.nomor) ?? "—", tanggal: teks(cd.tanggal) ?? "", keterangan: teks(cd.keterangan) ?? "", nilai: cdNilai } : null,
      dicocokkan: dc ? { oleh: orang(dc.oleh), pada: teks(dc.pada) } : null, kandidat: petaKandidat(x.kandidat), aksi: { cocokkan: petaAksi(aksi?.cocokkan), lepas: petaAksi(aksi?.lepas) },
    }];
  });
  const pn = obj(o.penutup);
  return {
    id: item.id, rekening: item.rekening, periode: item.periode, status: item.status, statusLabel: item.statusLabel, nada: item.nada, catatan: teks(o.catatan),
    saldoAwalKoran: uang(o.saldoAwalKoran) ?? NOL, saldoKoran: item.saldoKoran, saldoBuku: item.saldoBuku, selisih: item.selisih, cocok: item.cocok,
    ringkasan: { jumlahBaris: angka(rg?.jumlahBaris) ?? baris.length, belumCocok: angka(rg?.belumCocok) ?? 0, cocokBaris: angka(rg?.cocokBaris) ?? 0, diabaikan: angka(rg?.diabaikan) ?? 0, mutasiBukuBelumDipasangkan: angka(rg?.mutasiBukuBelumDipasangkan) ?? 0 },
    baris, terpotong: o.terpotong === true, riwayat: petaRiwayat(o.riwayat), diperbaruiPada: teks(o.diperbaruiPada), penutup: pn ? { pada: teks(pn.pada), oleh: orang(pn.oleh) } : null,
  };
}

// ── Bacaan ──────────────────────────────────────────────────────────────────────────────────────────────────
export async function fetchJurnal(f: FilterJurnal, page: number): Promise<HalamanJurnal> {
  if (ENV.useMocks) return mockDaftarJurnal(f, page);
  return mapHalamanJurnal(await api.get<unknown>("/finance/buku/jurnal", {
    query: { from: f.from ?? undefined, to: f.to ?? undefined, q: f.q.trim() || undefined, source: f.source ?? undefined, status: f.status ?? undefined, akunId: f.akunId ?? undefined, page, limit: LIMIT_BUKU },
    normalisasi: NORMALISASI_BUKU,
  }));
}

export async function fetchDetailJurnal(id: string): Promise<DetailJurnal> {
  if (ENV.useMocks) return mockDetailJurnal(id);
  const d = mapDetailJurnal(await api.get<unknown>(`/finance/buku/jurnal/${encodeURIComponent(id)}`, { normalisasi: NORMALISASI_BUKU }));
  if (!d) throw new ApiError({ status: 502, code: "PARSE", message: "Respons server tidak bisa dibaca" });
  return d;
}

export async function fetchAkun(q: string): Promise<AkunPilihan[]> {
  if (ENV.useMocks) return mockDaftarAkun(q);
  return mapAkun(await api.get<unknown>("/finance/buku/akun", { query: { q: q.trim() || undefined, limit: 100 } }));
}

export async function fetchBukuBesar(akunId: string, from: string, to: string, page: number): Promise<BukuBesarHalaman> {
  if (ENV.useMocks) return mockMutasiAkun(akunId, from, to, page);
  const b = mapBuku(await api.get<unknown>(`/finance/buku/akun/${encodeURIComponent(akunId)}/mutasi`, { query: { from, to, page, limit: 30 }, normalisasi: NORMALISASI_BUKU }));
  if (!b) throw new ApiError({ status: 502, code: "PARSE", message: "Respons server tidak bisa dibaca" });
  return b;
}

export async function fetchRekon(): Promise<RekonItem[]> {
  if (ENV.useMocks) return mockDaftarRekon();
  const o = obj(await api.get<unknown>("/finance/buku/rekon", { normalisasi: NORMALISASI_BUKU }));
  return (Array.isArray(o?.items) ? o.items : []).map(mapRekonItem).filter((x): x is RekonItem => x != null);
}

export async function fetchRekonDetail(id: string): Promise<RekonDetail> {
  if (ENV.useMocks) return mockDetailRekon(id);
  const d = mapRekonDetail(await api.get<unknown>(`/finance/buku/rekon/${encodeURIComponent(id)}`, { normalisasi: NORMALISASI_BUKU }));
  if (!d) throw new ApiError({ status: 502, code: "PARSE", message: "Respons server tidak bisa dibaca" });
  return d;
}

// ── Perintah: cocokkan / lepas ──────────────────────────────────────────────────────────────────────────────
/** Wajib: izin financePost (guard klien; server memeriksa ulang), step-up PIN/biometrik, Idempotency-Key. Tanpa koneksi perintah TIDAK dikirim dan TIDAK diantre. */
export async function cocokkanBaris(opsi: { aksi: AksiTx; journalLineId: string; kunci: string }): Promise<void> {
  if (!opsi.aksi.boleh) throw new ApiError({ status: 403, code: "FORBIDDEN", message: opsi.aksi.alasan ?? "Tindakan ini tidak tersedia." });
  await jalankanPerintah({
    need: "financePost", stepUp: true, kunci: opsi.kunci,
    run: async (k) => {
      if (ENV.useMocks) return mockCocokkan(opsi.aksi.path, opsi.journalLineId);
      await api.command("POST", opsi.aksi.path, k, { body: { journalLineId: opsi.journalLineId } });
      return undefined;
    },
  });
}

export async function lepasBaris(opsi: { aksi: AksiTx; kunci: string }): Promise<void> {
  if (!opsi.aksi.boleh) throw new ApiError({ status: 403, code: "FORBIDDEN", message: opsi.aksi.alasan ?? "Tindakan ini tidak tersedia." });
  await jalankanPerintah({
    need: "financePost", stepUp: true, kunci: opsi.kunci,
    run: async (k) => {
      if (ENV.useMocks) return mockLepas(opsi.aksi.path);
      await api.command("POST", opsi.aksi.path, k, { body: {} });
      return undefined;
    },
  });
}
