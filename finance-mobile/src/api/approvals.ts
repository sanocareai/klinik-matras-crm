import { randomUUID } from "expo-crypto";
import { api, useSession } from "@/auth/session";
import { ApiError } from "@/api/errors";
import { jalankanPerintah } from "@/api/command";
import { isMoneyString, type Money } from "@/lib/money";
import { ENV } from "@/lib/env";
import { DEFAULT_LIMIT } from "./approvalConst";
import { mockPutuskan } from "@/mocks/approvals";
import type {
  AksiKeputusan, ApprovalDetail, ApprovalHalaman, ApprovalItem, FilterApproval, HitungTab, JenisApproval, LampiranApproval, RiwayatApproval, TahapApproval,
} from "./types";

// INBOX PERSETUJUAN (S4) — HANYA memetakan bentuk dari server. Status, tab, izin, pemisahan tugas, dan syarat bukti semuanya
// datang dari server (`tahap`, `aksi`, `syarat`); klien tidak menghitung ulang atau membuat status sendiri.
//   GET  /finance/approvals                    daftar terpaginasi + jumlah per tab
//   GET  /finance/approvals/ringkasan          jumlah menunggu (lencana tab)
//   GET  /finance/approvals/pemohon            pilihan filter pemohon
//   GET  /finance/approvals/:jenis/:id         detail + lampiran bertanda-tangan + riwayat
//   POST item.aksi.setujui.path | tolak.path   keputusan (endpoint milik tiap jenis dokumen; Idempotency-Key + step-up)

const JENIS: JenisApproval[] = ["expense", "purchase", "bill", "refund"];
const TAHAP: TahapApproval[] = ["MENUNGGU", "DIPROSES", "DISETUJUI", "DITOLAK"];

/** Kunci angka pada payload ini yang HITUNGAN (bukan uang), walau namanya mirip uang (`total`). */
export const NORMALISASI_APPROVAL = {
  uang: ["nominal"],
  hitungan: ["total", "page", "limit", "umurHari", "menunggu", "MENUNGGU", "DIPROSES", "DISETUJUI", "DITOLAK", "expense", "purchase", "bill", "refund"],
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const teks = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const angka = (v: unknown, dasar = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : dasar);

function pilihOrang(v: unknown): { id: string; name: string } | null {
  const o = obj(v);
  return o && typeof o.id === "string" ? { id: o.id, name: teks(o.name) ?? "—" } : null;
}

function petaAksi(v: unknown): AksiKeputusan {
  const o = obj(v);
  const path = teks(o?.path);
  // Tanpa path yang jelas, aksi TIDAK boleh (fail-closed): lebih baik tombol nonaktif daripada memanggil alamat tak dikenal.
  const boleh = o?.boleh === true && !!path && path.startsWith("/finance/");
  return { boleh, alasan: teks(o?.alasan) ?? (boleh ? null : "Tidak tersedia."), path: path ?? "", alasanWajib: o?.alasanWajib === true };
}

export function mapItem(raw: unknown): ApprovalItem | null {
  const o = obj(raw);
  if (!o || typeof o.id !== "string" || !JENIS.includes(o.jenis as JenisApproval) || !TAHAP.includes(o.tahap as TahapApproval)) return null;
  const nominal = typeof o.nominal === "string" && isMoneyString(o.nominal) ? (o.nominal as Money) : null;
  if (!nominal) return null;
  const aksi = obj(o.aksi);
  const syarat = obj(o.syarat);
  return {
    kunci: teks(o.kunci) ?? `${o.jenis}:${o.id}`,
    id: o.id,
    jenis: o.jenis as JenisApproval,
    jenisLabel: teks(o.jenisLabel) ?? String(o.jenis),
    nomor: teks(o.nomor) ?? "—",
    tanggal: teks(o.tanggal) ?? "",
    diajukanPada: teks(o.diajukanPada) ?? "",
    umurHari: angka(o.umurHari),
    pemohon: pilihOrang(o.pemohon),
    nominal,
    keterangan: typeof o.keterangan === "string" ? o.keterangan : "",
    kategori: teks(o.kategori),
    rekening: teks(o.rekening),
    pihak: teks(o.pihak),
    nomorOrder: teks(o.nomorOrder),
    mode: teks(o.mode),
    status: teks(o.status) ?? "",
    statusLabel: teks(o.statusLabel) ?? teks(o.status) ?? "",
    tahap: o.tahap as TahapApproval,
    adaLampiran: o.adaLampiran === true,
    alasanTolak: teks(o.alasanTolak),
    diputuskanOleh: pilihOrang(o.diputuskanOleh),
    diputuskanPada: teks(o.diputuskanPada),
    syarat: syarat && syarat.terpenuhi === false ? { terpenuhi: false, pesan: teks(syarat.pesan) ?? "Syarat belum terpenuhi." } : null,
    aksi: { setujui: petaAksi(aksi?.setujui), tolak: petaAksi(aksi?.tolak) },
  };
}

function petaHitung(v: unknown): HitungTab {
  const o = obj(v);
  return { MENUNGGU: angka(o?.MENUNGGU), DIPROSES: angka(o?.DIPROSES), DISETUJUI: angka(o?.DISETUJUI), DITOLAK: angka(o?.DITOLAK) };
}

export function mapHalaman(raw: unknown): ApprovalHalaman {
  const o = obj(raw) ?? {};
  const items = (Array.isArray(o.items) ? o.items : []).map(mapItem).filter((x): x is ApprovalItem => x != null);
  const tab = TAHAP.includes(o.tab as TahapApproval) ? (o.tab as TahapApproval) : "MENUNGGU";
  return { items, tab, page: angka(o.page, 1), limit: angka(o.limit, 20), total: angka(o.total), adaLagi: o.adaLagi === true, hitung: petaHitung(o.hitung) };
}

function petaLampiran(v: unknown): LampiranApproval[] {
  return (Array.isArray(v) ? v : []).flatMap((x) => {
    const o = obj(x);
    if (!o || typeof o.id !== "string") return [];
    return [{
      id: o.id, jenis: o.jenis === "foto" ? "foto" : "tautan",
      // Hanya jalur relatif milik server (bertanda-tangan) yang dipercaya; URL luar dibuang.
      url: typeof o.url === "string" && o.url.startsWith("/media/") ? o.url : null,
      thumbUrl: typeof o.thumbUrl === "string" && o.thumbUrl.startsWith("/media/") ? o.thumbUrl : null,
      kedaluwarsa: teks(o.kedaluwarsa),
    }];
  });
}

function petaRiwayat(v: unknown): RiwayatApproval[] {
  return (Array.isArray(v) ? v : []).flatMap((x) => {
    const o = obj(x);
    return o && typeof o.waktu === "string" ? [{ waktu: o.waktu, peristiwa: teks(o.peristiwa) ?? "", label: teks(o.label) ?? "Aktivitas", oleh: teks(o.oleh), catatan: teks(o.catatan) }] : [];
  });
}

export function mapDetail(raw: unknown): ApprovalDetail | null {
  const item = mapItem(raw);
  const o = obj(raw);
  if (!item || !o) return null;
  const rincian: Record<string, string | boolean | null> = {};
  for (const [k, v] of Object.entries(obj(o.rincian) ?? {})) {
    if (typeof v === "string" || typeof v === "boolean" || v === null) rincian[k] = v;
  }
  return { ...item, rincian, lampiran: petaLampiran(o.lampiran), riwayat: petaRiwayat(o.riwayat) };
}

/** Alamat absolut untuk jalur media bertanda-tangan milik server (mis. /media/finance-receipts/…?exp&sig). */
export function urlMedia(jalur: string): string {
  return `${ENV.apiUrl.replace(/\/api\/?$/, "")}${jalur}`;
}

export async function fetchApprovals(filter: FilterApproval, page: number): Promise<ApprovalHalaman> {
  const raw = await api.get<unknown>("/finance/approvals", {
    query: {
      tab: filter.tab, jenis: filter.jenis.length > 0 ? filter.jenis.join(",") : undefined,
      from: filter.from ?? undefined, to: filter.to ?? undefined, pemohonId: filter.pemohonId ?? undefined,
      q: filter.q.trim() || undefined, page, limit: DEFAULT_LIMIT,
    },
    normalisasi: NORMALISASI_APPROVAL,
  });
  return mapHalaman(raw);
}

export async function fetchApprovalDetail(jenis: string, id: string): Promise<ApprovalDetail> {
  const raw = await api.get<unknown>(`/finance/approvals/${encodeURIComponent(jenis)}/${encodeURIComponent(id)}`, { normalisasi: NORMALISASI_APPROVAL });
  const d = mapDetail(raw);
  if (!d) throw new ApiError({ status: 502, code: "PARSE", message: "Respons server tidak bisa dibaca" });
  return d;
}

export async function fetchApprovalBadge(): Promise<number> {
  const raw = obj(await api.get<unknown>("/finance/approvals/ringkasan", { normalisasi: NORMALISASI_APPROVAL }));
  return angka(raw?.menunggu);
}

export async function fetchPemohon(): Promise<{ id: string; name: string }[]> {
  const raw = obj(await api.get<unknown>("/finance/approvals/pemohon"));
  return (Array.isArray(raw?.pemohon) ? raw.pemohon : []).map(pilihOrang).filter((x): x is { id: string; name: string } => x != null);
}

/**
 * Keputusan lewat endpoint milik dokumen (path dari server). Wajib: izin financeApprove (guard klien, server tetap memeriksa),
 * step-up PIN/biometrik, dan Idempotency-Key. `kunci` dipakai ulang saat mengulang perintah yang hasilnya tidak pasti.
 */
export async function putuskan(opsi: { aksi: AksiKeputusan; alasan?: string; kunci: string }): Promise<void> {
  if (!opsi.aksi.boleh) throw new ApiError({ status: 403, code: "FORBIDDEN", message: opsi.aksi.alasan ?? "Keputusan ini tidak tersedia." });
  await jalankanPerintah({
    need: "financeApprove",
    stepUp: true,
    kunci: opsi.kunci,
    run: async (k) => {
      const body = opsi.alasan != null ? { reason: opsi.alasan.trim() } : {};
      if (ENV.useMocks) { await mockPutuskan(opsi.aksi.path, body); return; }
      await api.command("POST", opsi.aksi.path, k, { body });
    },
  });
}

export const bikinKunci = () => randomUUID();
export const izinBerubah = () => void useSession.getState().refreshMe();
