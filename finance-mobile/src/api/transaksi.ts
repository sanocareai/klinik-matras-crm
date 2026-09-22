import { randomUUID } from "expo-crypto";
import { api } from "@/auth/session";
import { ApiError } from "@/api/errors";
import { jalankanPerintah } from "@/api/command";
import { petaLampiran, petaRiwayat } from "@/api/approvals";
import type { Need, NeedMode } from "@/auth/capabilities";
import { isMoneyString, toMoney, type Money } from "@/lib/money";
import { ENV } from "@/lib/env";
import {
  mockCariOrderRefund, mockDaftarTx, mockDetailTx, mockDpEligible, mockKirimTx, mockOpsiForm, mockRingkasanModul, mockUnggahFoto,
} from "@/mocks/transaksi";
import type {
  AksiTx, BagianTx, BarisTx, DetailTx, DpEligible, DpEligibleItem, FilterTx, HalamanTx, HasilUnggah, ItemTx, JenisApproval, KategoriTx, ModulTx, NadaTx, OpsiForm,
  OrderRefund, PembayaranPiutang, RingkasanModul, RingkasanTx, RiwayatDp, SupplierInfo,
} from "./types";

// TRANSAKSI (S6–S8) — HANYA memetakan bentuk dari server. Status, izin/aksi, jatuh tempo, umur, sisa utang/piutang, dan uang yang boleh direfund
// semuanya dihitung server; klien tidak membuat ledger, status, atau sumber data tandingan.
//   GET  /finance/transaksi/:modul           daftar terpaginasi + hitungan per tab + ringkasan   GET /finance/transaksi/:modul/:id  detail
//   GET  /finance/transaksi/ringkasan        jumlah per modul (kartu)                            GET /finance/transaksi/opsi       pilihan formulir
//   POST/PATCH  endpoint milik tiap dokumen  (Idempotency-Key + step-up PIN/biometrik; TANPA antrean offline)

export const MODUL_LIST: ModulTx[] = ["pengeluaran", "pembelian", "kasbon", "pemasukan", "piutang", "refund", "supplier", "tagihan", "pembayaran-supplier"];
const NADA: NadaTx[] = ["success", "warning", "danger", "info", "neutral"];
export const LIMIT_TX = 20;

/** Angka pada payload ini yang HITUNGAN/metadata (bukan uang); uang dari server sudah berupa string desimal. */
export const NORMALISASI_TX = {
  uang: [],
  hitungan: [
    "total", "page", "limit", "jumlah", "umurHari", "jumlahTagihanTerbuka", "terminHari", "paymentTermDays", "refund",
    "SEMUA", "DRAF", "MENUNGGU", "DIPROSES", "SELESAI", "DITOLAK", "AKTIF", "LUNAS", "DIBATALKAN", "NONAKTIF", "TERBUKA", "LEWAT", "BERJALAN",
    "menunggu", "aktif", "terbuka",
  ],
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const teks = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const angka = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const uang = (v: unknown): Money | null => (typeof v === "string" && isMoneyString(v) ? (v as Money) : null);
const NOL: Money = toMoney("0.00");

/** Hanya alamat perintah milik dokumen keuangan yang dipercaya — aksi dengan alamat tak dikenal dimatikan (lebih baik tombol nonaktif). */
const AWAL_PATH = /^\/finance\/(expenses|purchases|kasbon|other-income|refunds|suppliers|bills|supplier-payments|customer-payments)(\/|$)/;

export function petaAksiTx(v: unknown): AksiTx {
  const o = obj(v);
  const path = teks(o?.path) ?? "";
  const ok = o?.boleh === true && AWAL_PATH.test(path);
  const tetap = obj(o?.tetap);
  return {
    boleh: ok, alasan: teks(o?.alasan) ?? (ok ? null : "Tidak tersedia."), path, metode: o?.metode === "PATCH" ? "PATCH" : "POST",
    perlu: (Array.isArray(o?.perlu) ? o.perlu : []).filter((x): x is string => typeof x === "string"),
    tetap: tetap ? Object.fromEntries(Object.entries(tetap).filter(([, x]) => typeof x === "string")) as Record<string, string> : null,
  };
}

const JENIS_APPROVAL: JenisApproval[] = ["expense", "purchase", "bill", "refund"];

export function mapItemTx(raw: unknown): ItemTx | null {
  const o = obj(raw);
  if (!o || typeof o.id !== "string" || !MODUL_LIST.includes(o.modul as ModulTx)) return null;
  const nominal = uang(o.nominal);
  if (!nominal) return null;
  const p = obj(o.persetujuan);
  const aksi: Record<string, AksiTx> = {};
  for (const [k, v] of Object.entries(obj(o.aksi) ?? {})) aksi[k] = petaAksiTx(v);
  return {
    kunci: teks(o.kunci) ?? `${String(o.modul)}:${o.id}`, id: o.id, modul: o.modul as ModulTx, nomor: teks(o.nomor) ?? "—", tanggal: teks(o.tanggal), nominal,
    judul: teks(o.judul) ?? "—", sub: teks(o.sub) ?? "", pihak: teks(o.pihak), rekening: teks(o.rekening),
    status: teks(o.status) ?? "", statusLabel: teks(o.statusLabel) ?? teks(o.status) ?? "—", nada: NADA.includes(o.nada as NadaTx) ? (o.nada as NadaTx) : "neutral",
    jatuhTempo: teks(o.jatuhTempo), umurHari: angka(o.umurHari), sisa: uang(o.sisa), terbayar: uang(o.terbayar),
    adaLampiran: o.adaLampiran === true, notaWajib: o.notaWajib === true, jumlahTagihanTerbuka: angka(o.jumlahTagihanTerbuka), ember: teks(o.ember),
    persetujuan: p && typeof p.id === "string" && JENIS_APPROVAL.includes(p.jenis as JenisApproval) ? { jenis: p.jenis as JenisApproval, id: p.id } : null,
    aksi,
  };
}

function petaRingkasan(v: unknown): RingkasanTx {
  const o = obj(v) ?? {};
  const lt = obj(o.lewatTempo);
  const mv = obj(o.menungguVerifikasi);
  const umur = obj(o.umur);
  return {
    total: uang(o.total), totalSemua: uang(o.totalSemua), sisaAktif: uang(o.sisaAktif), utangTerbuka: uang(o.utangTerbuka),
    lewatTempo: lt ? { jumlah: angka(lt.jumlah) ?? 0, total: uang(lt.total) ?? NOL } : null,
    menungguVerifikasi: mv ? { jumlah: angka(mv.jumlah) ?? 0, total: uang(mv.total) ?? NOL } : null,
    umur: umur ? Object.fromEntries(Object.entries(umur).flatMap(([k, x]) => (uang(x) ? [[k, uang(x) as Money]] : []))) : null,
  };
}

export function mapHalamanTx(raw: unknown): HalamanTx {
  const o = obj(raw) ?? {};
  const h = obj(o.hitung) ?? {};
  return {
    items: (Array.isArray(o.items) ? o.items : []).map(mapItemTx).filter((x): x is ItemTx => x != null),
    tab: teks(o.tab) ?? "", page: angka(o.page) ?? 1, total: angka(o.total) ?? 0, adaLagi: o.adaLagi === true,
    hitung: Object.fromEntries(Object.entries(h).flatMap(([k, x]) => (typeof x === "number" ? [[k, x]] : []))),
    ringkasan: petaRingkasan(o.ringkasan), diperbaruiPada: teks(o.diperbaruiPada),
  };
}

function petaBagian(v: unknown): BagianTx[] {
  return (Array.isArray(v) ? v : []).flatMap((b): BagianTx[] => {
    const o = obj(b);
    if (!o || !teks(o.judul)) return [];
    const baris = (Array.isArray(o.baris) ? o.baris : []).flatMap((r): BarisTx[] => {
      const x = obj(r);
      if (!x || !teks(x.label) || typeof x.nilai !== "string") return [];
      const jenis = x.jenis === "uang" || x.jenis === "tanggal" || x.jenis === "waktu" ? x.jenis : "teks";
      if (jenis === "uang" && !uang(x.nilai)) return [];
      const t = obj(x.tautan);
      return [{
        label: x.label as string, nilai: x.nilai, jenis,
        tautan: t && typeof t.id === "string" && MODUL_LIST.includes(t.modul as ModulTx) ? { modul: t.modul as ModulTx, id: t.id } : null,
      }];
    });
    return [{ judul: o.judul as string, baris }];
  });
}

function petaPembayaran(v: unknown): PembayaranPiutang[] {
  return (Array.isArray(v) ? v : []).flatMap((p): PembayaranPiutang[] => {
    const o = obj(p);
    const nominal = uang(o?.nominal);
    if (!o || typeof o.id !== "string" || !nominal) return [];
    return [{
      id: o.id, nominal, metode: teks(o.metode) ?? "—", tanggal: teks(o.tanggal) ?? "", status: teks(o.status) ?? "", statusLabel: teks(o.statusLabel) ?? "—",
      asalOrderId: teks(o.asalOrderId) ?? "",
      alokasi: (Array.isArray(o.alokasi) ? o.alokasi : []).flatMap((a) => {
        const x = obj(a);
        const n = uang(x?.nominal);
        return x && typeof x.orderId === "string" && n ? [{ orderId: x.orderId, nomor: teks(x.nomor), nominal: n }] : [];
      }),
      aksiAlokasi: petaAksiTx(o.aksiAlokasi),
    }];
  });
}

function petaSupplier(v: unknown): SupplierInfo | null {
  const o = obj(v);
  if (!o) return null;
  return {
    telepon: teks(o.telepon), email: teks(o.email), alamat: teks(o.alamat), terminHari: angka(o.terminHari), bank: teks(o.bank), rekeningBank: teks(o.rekeningBank),
    atasNama: teks(o.atasNama), catatan: teks(o.catatan), aktif: o.aktif !== false,
  };
}

function petaOrang(v: unknown): { id: string; name: string } | null {
  const o = obj(v);
  return o && typeof o.id === "string" ? { id: o.id, name: teks(o.name) ?? "—" } : null;
}

function petaRiwayatDp(v: unknown): RiwayatDp[] {
  return (Array.isArray(v) ? v : []).flatMap((r): RiwayatDp[] => {
    const o = obj(r);
    const nominal = uang(o?.nominal);
    if (!o || typeof o.id !== "string" || !nominal || (o.sisi !== "sumber" && o.sisi !== "tujuan")) return [];
    const pas = obj(o.pasangan);
    return [{
      id: o.id, sisi: o.sisi, nominal, status: teks(o.status) ?? "", statusLabel: teks(o.statusLabel) ?? "—", tanggal: teks(o.tanggal), dibuatOleh: petaOrang(o.dibuatOleh),
      jurnal: teks(o.jurnal), jurnalPembalik: teks(o.jurnalPembalik), dibatalkanPada: teks(o.dibatalkanPada), dibatalkanOleh: petaOrang(o.dibatalkanOleh), alasanBatal: teks(o.alasanBatal),
      pasangan: pas && typeof pas.id === "string" ? { id: pas.id, nomor: teks(pas.nomor) ?? "—" } : null,
      aksiBatalkan: o.aksiBatalkan ? petaAksiTx(o.aksiBatalkan) : null,
    }];
  });
}

export function mapDetailTx(raw: unknown): DetailTx | null {
  const item = mapItemTx(raw);
  const o = obj(raw);
  if (!item || !o) return null;
  return {
    ...item, bagian: petaBagian(o.bagian), lampiran: petaLampiran(o.lampiran), riwayat: petaRiwayat(o.riwayat), catatan: teks(o.catatan), syarat: teks(o.syarat),
    pembayaran: petaPembayaran(o.pembayaran),
    orderPelanggan: (Array.isArray(o.orderPelanggan) ? o.orderPelanggan : []).flatMap((x) => { const y = obj(x); return y && typeof y.id === "string" ? [{ id: y.id, nomor: teks(y.nomor) }] : []; }),
    supplier: petaSupplier(o.supplier),
    ...(o.riwayatDp !== undefined ? { riwayatDp: petaRiwayatDp(o.riwayatDp) } : {}),
  };
}

export function mapDpEligible(raw: unknown): DpEligible {
  const o = obj(raw) ?? {};
  const eligible = (Array.isArray(o.eligible) ? o.eligible : []).flatMap((x): DpEligibleItem[] => {
    const y = obj(x);
    const nilaiAwal = uang(y?.nilaiAwal);
    const sudahDigunakan = uang(y?.sudahDigunakan);
    const saldoTersedia = uang(y?.saldoTersedia);
    return y && typeof y.id === "string" && nilaiAwal && sudahDigunakan && saldoTersedia
      ? [{ id: y.id, purchaseNumber: teks(y.purchaseNumber) ?? "—", date: teks(y.date) ?? "", nilaiAwal, sudahDigunakan, saldoTersedia }]
      : [];
  });
  return {
    eligible, bisaMenerapkan: o.bisaMenerapkan === true,
    alasan: Array.isArray(o.alasan) ? o.alasan.filter((x): x is string => typeof x === "string") : undefined,
    sisaUtang: uang(o.sisaUtang) ?? undefined, totalPembelian: uang(o.totalPembelian) ?? undefined,
  };
}

export function mapOpsiForm(raw: unknown): OpsiForm {
  const o = obj(raw) ?? {};
  const daftar = <T>(v: unknown, pilih: (x: Obj) => T | null): T[] => (Array.isArray(v) ? v : []).flatMap((x) => { const y = obj(x); const r = y ? pilih(y) : null; return r ? [r] : []; });
  const kat = (x: Obj): KategoriTx | null => (typeof x.id === "string" ? { id: x.id, code: teks(x.code) ?? "", name: teks(x.name) ?? "—", division: teks(x.division) } : null);
  return {
    kategoriPengeluaran: daftar(o.kategoriPengeluaran, kat), kategoriPembelian: daftar(o.kategoriPembelian, kat),
    rekening: daftar(o.rekening, (x) => (typeof x.id === "string" ? { id: x.id, name: teks(x.name) ?? "—", kind: teks(x.kind) ?? "", saldo: uang(x.saldo) ?? NOL } : null)),
    supplier: daftar(o.supplier, (x) => (typeof x.id === "string" ? { id: x.id, code: teks(x.code) ?? "", name: teks(x.name) ?? "—", paymentTermDays: angka(x.paymentTermDays) } : null)),
    akunPemasukanLain: daftar(o.akunPemasukanLain, (x) => (typeof x.id === "string" ? { id: x.id, code: teks(x.code) ?? "", name: teks(x.name) ?? "—" } : null)),
    karyawan: daftar(o.karyawan, (x) => (typeof x.id === "string" ? { id: x.id, name: teks(x.name) ?? "—" } : null)),
    mode: daftar(o.mode, (x) => (typeof x.id === "string" ? { id: x.id, label: teks(x.label) ?? x.id } : null)),
    hanyaReimbursement: o.hanyaReimbursement === true, ambangNotaRupiah: uang(o.ambangNotaRupiah) ?? NOL,
  };
}

// ── Bacaan ──────────────────────────────────────────────────────────────────────────────────────────────────
export async function fetchDaftarTx(f: FilterTx, page: number): Promise<HalamanTx> {
  if (ENV.useMocks) return mockDaftarTx(f, page);
  const raw = await api.get<unknown>(`/finance/transaksi/${f.modul}`, {
    query: {
      tab: f.tab, q: f.q.trim() || undefined, from: f.from ?? undefined, to: f.to ?? undefined, page, limit: LIMIT_TX,
      supplierId: f.supplierId ?? undefined, jatuhTempo: f.jatuhTempoLewat ? "lewat" : undefined,
    },
    normalisasi: NORMALISASI_TX,
  });
  return mapHalamanTx(raw);
}

export async function fetchDetailTx(modul: ModulTx, id: string): Promise<DetailTx> {
  if (ENV.useMocks) return mockDetailTx(modul, id);
  const raw = await api.get<unknown>(`/finance/transaksi/${modul}/${encodeURIComponent(id)}`, { normalisasi: NORMALISASI_TX });
  const d = mapDetailTx(raw);
  if (!d) throw new ApiError({ status: 502, code: "PARSE", message: "Respons server tidak bisa dibaca" });
  return d;
}

export async function fetchRingkasanModul(): Promise<RingkasanModul> {
  if (ENV.useMocks) return mockRingkasanModul();
  const o = obj(await api.get<unknown>("/finance/transaksi/ringkasan", { normalisasi: NORMALISASI_TX })) ?? {};
  return Object.fromEntries(Object.entries(o).flatMap(([k, v]) => {
    const x = obj(v);
    return x ? [[k, Object.fromEntries(Object.entries(x).filter(([, n]) => typeof n === "number"))]] : [];
  })) as RingkasanModul;
}

export async function fetchOpsiForm(): Promise<OpsiForm> {
  if (ENV.useMocks) return mockOpsiForm();
  return mapOpsiForm(await api.get<unknown>("/finance/transaksi/opsi", { normalisasi: NORMALISASI_TX }));
}

export async function fetchDpEligible(purchaseId: string): Promise<DpEligible> {
  if (ENV.useMocks) return mockDpEligible(purchaseId);
  return mapDpEligible(await api.get<unknown>(`/finance/transaksi/pembelian/${encodeURIComponent(purchaseId)}/advance-eligible`, { normalisasi: NORMALISASI_TX }));
}

export async function cariOrderRefund(q: string): Promise<OrderRefund[]> {
  if (ENV.useMocks) return mockCariOrderRefund(q);
  const o = obj(await api.get<unknown>("/finance/transaksi/opsi/order", { query: { q } })) ?? {};
  return (Array.isArray(o.orders) ? o.orders : []).flatMap((x): OrderRefund[] => {
    const y = obj(x);
    const nilai = uang(y?.nilai);
    const sisa = uang(y?.sisaBisaDirefund);
    return y && typeof y.id === "string" && nilai && sisa ? [{ id: y.id, nomor: teks(y.nomor) ?? "—", pelanggan: teks(y.pelanggan) ?? "—", nilai, sisaBisaDirefund: sisa }] : [];
  });
}

// ── Perintah ────────────────────────────────────────────────────────────────────────────────────────────────
export type IsianAksi = {
  alasan?: string; rekeningId?: string; tanggal?: string; nominal?: Money; receiptUrl?: string | null;
  alokasi?: { orderId: string; amount: Money }[]; perubahan?: Record<string, unknown>; advancePurchaseId?: string;
};

export const bikinKunciTx = () => randomUUID();

type Perintah = { need: Need | Need[]; mode?: NeedMode; path: string; metode: "POST" | "PATCH"; body: unknown; kunci: string };

/** Satu-satunya jalur perintah uang untuk modul transaksi: guard capability + step-up + Idempotency-Key. Tanpa antrean offline. */
async function kirimTx(p: Perintah): Promise<unknown> {
  if (!AWAL_PATH.test(p.path)) throw new ApiError({ status: 403, code: "FORBIDDEN", message: "Tindakan ini tidak tersedia." });
  return jalankanPerintah({
    need: p.need, mode: p.mode, stepUp: true, kunci: p.kunci,
    run: async (k) => {
      if (ENV.useMocks) return mockKirimTx(p.path, p.metode, p.body);
      return api.command(p.metode, p.path, k, { body: p.body });
    },
  });
}

const NEED_AKSI: Record<string, { need: Need | Need[]; mode?: NeedMode }> = {
  ajukan: { need: ["financePost", "expenseSubmit"], mode: "any" }, bayar: { need: "financePost" }, potongGaji: { need: "financePost" }, alokasi: { need: "financePost" },
  batalkan: { need: "financeAdmin" }, ubah: { need: "financeAdmin" }, lampiran: { need: ["financePost", "expenseSubmit"], mode: "any" },
  terapkanDp: { need: "financePost" }, batalkanDp: { need: "financeAdmin" },
};

/** Susun isi permintaan dari `aksi` (alamat & nilai tetap dari server) + isian pengguna. Uang selalu string desimal. */
export function bodyAksi(kode: string, aksi: AksiTx, i: IsianAksi): unknown {
  const alasan = i.alasan?.trim();
  switch (kode) {
    case "ajukan": return {};
    case "bayar":
      if (aksi.tetap?.billId) {
        return { supplierId: aksi.tetap.supplierId, cashAccountId: i.rekeningId, date: i.tanggal, allocations: [{ billId: aksi.tetap.billId, amount: i.nominal }] };
      }
      return { cashAccountId: i.rekeningId, ...(i.tanggal ? { paidAt: i.tanggal } : {}) };
    case "potongGaji": return { ...(aksi.tetap ?? {}), amount: i.nominal, date: i.tanggal };
    case "batalkan": return { reason: alasan };
    case "ubah": return { ...(i.perubahan ?? {}), reason: alasan };
    case "lampiran": return { receiptUrl: i.receiptUrl ?? null, ...(alasan ? { reason: alasan } : {}) };
    case "alokasi": return { allocations: (i.alokasi ?? []).map((a) => ({ orderId: a.orderId, amount: a.amount })) };
    case "terapkanDp": return { advancePurchaseId: i.advancePurchaseId, targetPurchaseId: aksi.tetap?.targetPurchaseId, amount: i.nominal };
    case "batalkanDp": return { reason: alasan };
    default: return {};
  }
}

export async function jalankanAksiTx(kode: string, aksi: AksiTx, isian: IsianAksi, kunci: string): Promise<unknown> {
  if (!aksi.boleh) throw new ApiError({ status: 403, code: "FORBIDDEN", message: aksi.alasan ?? "Tindakan ini tidak tersedia." });
  const need = NEED_AKSI[kode] ?? { need: "financePost" as Need };
  return kirimTx({ ...need, path: aksi.path, metode: aksi.metode, body: bodyAksi(kode, aksi, isian), kunci });
}

// ── Buat dokumen baru ───────────────────────────────────────────────────────────────────────────────────────
export type FormDokumen = {
  modul: Exclude<ModulTx, "piutang" | "pembayaran-supplier">;
  tanggal?: string; nominal?: Money | null; keterangan?: string; kategoriId?: string; mode?: string; rekeningId?: string; supplierId?: string; penerima?: string;
  catatan?: string; receiptUrl?: string | null; karyawan?: string; alasan?: string; akunId?: string; orderId?: string; ajukan?: boolean;
  nomorFaktur?: string; jatuhTempo?: string; kategoriBiayaId?: string;
  supplierBaru?: { nama: string; telepon?: string; terminHari?: string; bank?: string; rekening?: string; atasNama?: string; catatan?: string };
};

const JALUR_BUAT: Record<FormDokumen["modul"], string> = {
  pengeluaran: "/finance/expenses", pembelian: "/finance/purchases", kasbon: "/finance/kasbon", pemasukan: "/finance/other-income",
  refund: "/finance/refunds", tagihan: "/finance/bills", supplier: "/finance/suppliers",
};

export function bodyBuat(f: FormDokumen): unknown {
  const d = (x?: string) => x?.trim() || undefined;
  switch (f.modul) {
    case "pengeluaran": case "pembelian":
      return {
        date: f.tanggal, amount: f.nominal, description: d(f.keterangan), categoryId: f.kategoriId, mode: f.mode, cashAccountId: f.rekeningId || undefined, supplierId: f.supplierId || undefined,
        payeeName: d(f.penerima), notes: d(f.catatan), receiptUrl: f.receiptUrl || undefined, langsungAjukan: f.ajukan !== false,
        ...(f.modul === "pengeluaran" && f.orderId ? { orderId: f.orderId } : {}),
      };
    case "kasbon": return { date: f.tanggal, amount: f.nominal, employeeName: d(f.karyawan), urgency: d(f.alasan), cashAccountId: f.rekeningId, notes: d(f.catatan), receiptUrl: f.receiptUrl || undefined };
    case "pemasukan": return { date: f.tanggal, amount: f.nominal, description: d(f.keterangan), accountId: f.akunId, cashAccountId: f.rekeningId, notes: d(f.catatan), attachmentUrl: f.receiptUrl || undefined };
    case "refund": return { orderId: f.orderId, date: f.tanggal, amount: f.nominal, reason: d(f.alasan), cashAccountId: f.rekeningId, attachmentUrl: f.receiptUrl || undefined };
    case "tagihan":
      return {
        supplierId: f.supplierId, supplierRef: d(f.nomorFaktur), billDate: f.tanggal, dueDate: d(f.jatuhTempo), amount: f.nominal, description: d(f.keterangan),
        expenseCategoryId: f.kategoriBiayaId, attachmentUrl: f.receiptUrl || undefined,
      };
    case "supplier": {
      const s = f.supplierBaru;
      return { name: d(s?.nama), phone: d(s?.telepon), paymentTermDays: d(s?.terminHari), bankName: d(s?.bank), bankAccount: d(s?.rekening), bankHolder: d(s?.atasNama), notes: d(s?.catatan) };
    }
  }
}

export function needBuat(modul: FormDokumen["modul"]): { need: Need | Need[]; mode?: NeedMode } {
  return modul === "pengeluaran" || modul === "pembelian" ? { need: ["financePost", "expenseSubmit"], mode: "any" } : { need: "financePost" };
}

export async function buatDokumen(f: FormDokumen, kunci: string): Promise<{ id: string | null }> {
  const hasil = obj(await kirimTx({ ...needBuat(f.modul), path: JALUR_BUAT[f.modul], metode: "POST", body: bodyBuat(f), kunci }));
  return { id: typeof hasil?.id === "string" ? hasil.id : null };
}

// ── Foto nota ───────────────────────────────────────────────────────────────────────────────────────────────
/** Unggah foto nota (server memperkecil & memberi nama dari hash isi, jadi aman diulang). Mengembalikan alamat berkas + dokumen lain yang memakai foto yang sama. */
export async function unggahFoto(foto: { uri: string; nama: string }): Promise<HasilUnggah> {
  if (ENV.useMocks) return mockUnggahFoto(foto);
  const form = new FormData();
  // Bentuk berkas khas React Native (uri/name/type); bukan Blob.
  form.append("receipt", { uri: foto.uri, name: foto.nama || "nota.jpg", type: "image/jpeg" } as unknown as Blob);
  const o = obj(await api.upload<unknown>("/finance/receipts/upload", form));
  const url = teks(o?.url);
  if (!url) throw new ApiError({ status: 502, code: "PARSE", message: "Respons unggah tidak bisa dibaca" });
  return { url, dipakaiDi: (Array.isArray(o?.dipakaiDi) ? o.dipakaiDi : []).map((x) => (typeof x === "string" ? x : teks(obj(x)?.nomor) ?? "")).filter(Boolean) };
}
