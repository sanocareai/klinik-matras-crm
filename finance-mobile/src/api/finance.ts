import { api } from "@/auth/session";
import { isMoneyString, type Money } from "@/lib/money";
import type {
  AntreanRingkas, BagianDashboard, CashAccountKind, CatatanPembukuan, DashboardData, Ember, JurnalRingkas,
  KasBankItem, LabaRugiRingkas,
} from "./types";

// ENDPOINT FINANCE yang sudah tersambung ke backend SANSS (PRD §16). Kontrak DIAUDIT dari respons asli
// GET /api/finance/dashboard (Sep 2026) — bukan ditebak:
//   • uang = angka JSON (mis. -175967591, 3000000); dibaca lossless (normalize.ts) → string desimal
//   • persen margin = angka desimal BUKAN uang → dipaksa `hitungan`
//   • kasBank/totalKas/piutang/utang = posisi SAAT INI (as-of hari ini), hanya labaRugi mengikuti ?from&to
//   • ringkasan umur = { belum_jatuh_tempo, 1_30, 31_60, 61_90, 90_plus } (hanya total, tanpa jumlah dokumen)
//   • antrean.pembayaranBelumVerifikasi memuat nama pelanggan → SENGAJA dibuang, hanya hitungannya dipakai
// Angka SELALU dari server — di sini hanya pemetaan bentuk, tanpa aritmetika uang.

const KUNCI_EMBER = ["belum_jatuh_tempo", "1_30", "31_60", "61_90", "90_plus"] as const;
const LABEL_EMBER: Record<string, string> = {
  belum_jatuh_tempo: "Belum jatuh tempo",
  "1_30": "1–30 hari",
  "31_60": "31–60 hari",
  "61_90": "61–90 hari",
  "90_plus": "> 90 hari",
};
const JENIS_KAS: CashAccountKind[] = ["KAS", "BANK", "EWALLET"];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const uang = (v: unknown): Money | null => (typeof v === "string" && isMoneyString(v) ? (v as Money) : null);
const angka = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const teks = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function ember(ringkasan: Obj | null): Ember[] {
  if (!ringkasan) return [];
  return KUNCI_EMBER.map((k) => ({ label: LABEL_EMBER[k] ?? k, total: uang(ringkasan[k]) ?? ("0.00" as Money), jumlah: null }));
}

function petaLabaRugi(v: unknown): LabaRugiRingkas | null {
  const o = obj(v);
  const labaBersih = uang(o?.labaBersih);
  if (!o || !labaBersih) return null;
  const nol = "0.00" as Money;
  return {
    pendapatanBruto: uang(o.pendapatanBruto) ?? nol,
    retur: uang(o.retur) ?? nol,
    pendapatanBersih: uang(o.pendapatanBersih) ?? nol,
    bebanPokok: uang(o.bebanPokok) ?? nol,
    labaKotor: uang(o.labaKotor) ?? nol,
    bebanOperasional: uang(o.bebanOperasional) ?? nol,
    labaBersih,
    marginKotor: angka(o.marginKotor),
    marginBersih: angka(o.marginBersih),
  };
}

function petaAntrean(v: unknown): AntreanRingkas | null {
  const o = obj(v);
  if (!o) return null;
  const lunas = obj(o.lunasBelumDicatat);
  const sub = (x: unknown) => {
    const s = obj(x);
    const jumlah = angka(s?.jumlah);
    const total = uang(s?.total);
    return s && jumlah != null && total ? { jumlah, total } : null;
  };
  return {
    // Angka hitungan: pakai jumlahPembayaranBelumVerifikasi (server), bukan panjang array yang dipotong 50 baris.
    jumlahPembayaranBelumVerifikasi: angka(o.jumlahPembayaranBelumVerifikasi) ?? 0,
    lunasBelumDicatat: {
      jumlah: angka(lunas?.jumlah) ?? 0,
      total: uang(lunas?.total) ?? ("0.00" as Money),
      baru: sub(lunas?.baru),
      lama: sub(lunas?.lama),
    },
    pengeluaranMenunggu: angka(o.pengeluaranMenunggu) ?? 0,
    pembelianMenunggu: angka(o.pembelianMenunggu) ?? 0,
    tagihanMenunggu: angka(o.tagihanMenunggu) ?? 0,
    refundMenunggu: angka(o.refundMenunggu) ?? 0,
  };
}

function petaCatatan(v: unknown): CatatanPembukuan | null {
  const o = obj(v);
  if (!o) return null;
  return {
    gapTerbuka: angka(o.gapTerbuka) ?? 0,
    saldoAwalTerisi: o.saldoAwalTerisi === true,
    mulaiPembukuan: teks(o.mulaiPembukuan),
    periodeTerbuka: angka(o.periodeTerbuka),
    pesan: Array.isArray(o.pesan) ? o.pesan.filter((p): p is string => typeof p === "string" && p !== "") : [],
  };
}

function petaJurnal(v: unknown): JurnalRingkas[] | null {
  if (!Array.isArray(v)) return null;
  return v.flatMap((x) => {
    const o = obj(x);
    const total = uang(o?.total);
    if (!o || !total || typeof o.id !== "string") return [];
    return [{
      id: o.id, entryNumber: teks(o.entryNumber) ?? "—", date: teks(o.date) ?? "", description: teks(o.description) ?? "(tanpa keterangan)",
      source: teks(o.source) ?? "", status: teks(o.status) ?? "", total,
    }];
  });
}

function petaKasBank(v: unknown): KasBankItem[] | null {
  if (!Array.isArray(v)) return null;
  return v.flatMap((x) => {
    const o = obj(x);
    const saldo = uang(o?.saldo);
    if (!o || !saldo || typeof o.id !== "string") return [];
    const kind = JENIS_KAS.includes(o.kind as CashAccountKind) ? (o.kind as CashAccountKind) : "KAS";
    // Nomor rekening tidak dipakai di layar (PRD §13).
    return [{ id: o.id, name: teks(o.name) ?? "Rekening", kind, bankName: teks(o.bankName), saldo }];
  });
}

/** Payload dashboard (SUDAH dinormalkan: uang = string desimal) → bentuk yang dipakai layar. Tidak melempar untuk bagian yang hilang. */
export function mapDashboard(raw: unknown): DashboardData {
  const r = obj(raw) ?? {};
  const hilang: BagianDashboard[] = [];

  const kasBank = petaKasBank(r.kasBank);
  if (!kasBank) hilang.push("kasBank");
  const labaRugi = petaLabaRugi(r.labaRugi);
  if (!labaRugi) hilang.push("labaRugi");

  const p = obj(r.piutang);
  const piutangTotal = uang(p?.total);
  const piutang = p && piutangTotal ? {
    total: piutangTotal,
    ember: ember(obj(p.ringkasan)),
    menungguVerifikasi: (() => {
      const m = obj(p.menungguVerifikasi);
      const jumlah = angka(m?.jumlah);
      const total = uang(m?.total);
      return jumlah != null && total ? { jumlah, total } : null;
    })(),
  } : null;
  if (!piutang) hilang.push("piutang");

  const u = obj(r.utang);
  const utangTotal = uang(u?.total);
  const utang = u && utangTotal ? { total: utangTotal, ember: ember(obj(u.ringkasan)) } : null;
  if (!utang) hilang.push("utang");

  const antrean = petaAntrean(r.antrean);
  if (!antrean) hilang.push("antrean");
  const jurnal = petaJurnal(r.jurnalTerakhir);
  if (!jurnal) hilang.push("jurnal");
  const catatan = petaCatatan(r.catatan);
  if (!catatan) hilang.push("catatan");

  const g = obj(r.gate);
  const per = obj(r.periode);
  return {
    periode: { from: teks(per?.from) ?? "", to: teks(per?.to) ?? "" },
    kasBank: kasBank ?? [],
    totalKas: uang(r.totalKas),
    labaRugi,
    piutang,
    utang,
    antrean,
    gate: g ? { aktif: g.enabled === true, sejak: teks(g.since) } : null,
    jurnalTerakhir: jurnal ?? [],
    catatan,
    bagianHilang: hilang,
  };
}

/** Aturan baca respons dashboard (dipakai fetchDashboard dan tes kontrak). */
export const NORMALISASI_DASHBOARD = { uang: [...KUNCI_EMBER], hitungan: ["marginKotor", "marginBersih"] };

/** GET /api/finance/dashboard?from&to (izin FINANCE_READ). */
export async function fetchDashboard(periode: { from: string; to: string }): Promise<DashboardData> {
  const raw = await api.get<unknown>("/finance/dashboard", {
    query: periode,
    normalisasi: NORMALISASI_DASHBOARD,
  });
  return mapDashboard(raw);
}
