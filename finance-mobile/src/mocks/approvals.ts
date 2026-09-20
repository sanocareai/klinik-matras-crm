// SERVER PERSETUJUAN PALSU (mode contoh saja — tidak pernah aktif di production). Meniru kontrak GET /finance/approvals
// beserta keputusan (approve/reject): tab dihitung "server", `aksi` mengikuti izin + pemisahan tugas, keputusan mengubah data
// di memori sehingga daftar/detail berikutnya mencerminkan status resmi. Skenario `konflik` / `izin` mensimulasikan 409 / 403.

import { ApiError } from "@/api/errors";
import { DEFAULT_LIMIT } from "@/api/approvalConst";
import { toMoney } from "@/lib/money";
import { useSession } from "@/auth/session";
import { has } from "@/auth/capabilities";
import { getSkenario, simulasiBaca, versiSkenario } from "./skenario";
import type { ApprovalDetail, ApprovalHalaman, FilterApproval, JenisApproval, TahapApproval } from "@/api/types";

const FOTO_CONTOH = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const LABEL_JENIS: Record<JenisApproval, string> = { expense: "Pengeluaran", purchase: "Pembelian", bill: "Tagihan supplier", refund: "Refund" };
const PREFIKS: Record<JenisApproval, string> = { expense: "EXP", purchase: "PUR", bill: "BILL", refund: "RFD" };
const PATH_JENIS: Record<JenisApproval, string> = { expense: "expenses", purchase: "purchases", bill: "bills", refund: "refunds" };

const ORANG = {
  natasha: { id: "contoh-finance", name: "Natasha (contoh)" },
  imam: { id: "u-imam", name: "Imam" },
  ferdy: { id: "u-ferdy", name: "Ferdy" },
  kemal: { id: "u-kemal", name: "Kemal" },
  penyetuju: { id: "u-penyetuju-lain", name: "Penyetuju Lain" },
};

const HARI = 86400000;
const iso = (d: Date) => d.toISOString();

type Seed = {
  jenis: JenisApproval; tahap: TahapApproval; hariLalu: number; pemohon: keyof typeof ORANG; nominal: string; keterangan: string;
  kategori?: string | null; rekening?: string | null; pihak?: string | null; mode?: string | null; lampiran?: boolean; alasan?: string; tanpaNota?: boolean;
};

const SEED: Seed[] = [
  { jenis: "expense", tahap: "MENUNGGU", hariLalu: 6, pemohon: "imam", nominal: "1250000", keterangan: "Upah lembur tukang finishing", kategori: "Upah produksi", rekening: "SANOBANK Kemal", pihak: "Tukang harian", mode: "REIMBURSEMENT", tanpaNota: true },
  { jenis: "purchase", tahap: "MENUNGGU", hariLalu: 3, pemohon: "ferdy", nominal: "14800000", keterangan: "Busa HD density 26 — 40 lembar", kategori: "Bahan Baku (input manual)", rekening: "PT Sano", pihak: "CV Foam Nusantara", mode: "LANGSUNG", lampiran: true },
  { jenis: "bill", tahap: "MENUNGGU", hariLalu: 2, pemohon: "kemal", nominal: "18450000", keterangan: "Tagihan kain Sept minggu 3", pihak: "CV Tekstil Jaya", lampiran: true },
  { jenis: "refund", tahap: "MENUNGGU", hariLalu: 1, pemohon: "kemal", nominal: "850000", keterangan: "Kasur tidak sesuai ukuran", rekening: "SANOBANK Kemal", pihak: "Ibu Erni" },
  { jenis: "expense", tahap: "MENUNGGU", hariLalu: 0, pemohon: "natasha", nominal: "2500000", keterangan: "Sewa forklift bongkar kain (2 hari)", kategori: "Sewa alat", rekening: "Kas Kantor", pihak: "PT Angkat Jaya", mode: "LANGSUNG", lampiran: true },
  { jenis: "expense", tahap: "DIPROSES", hariLalu: 8, pemohon: "ferdy", nominal: "725000", keterangan: "Bensin kendaraan operasional", kategori: "BBM", rekening: "Kas Kantor", mode: "REIMBURSEMENT", lampiran: true },
  { jenis: "bill", tahap: "DIPROSES", hariLalu: 12, pemohon: "kemal", nominal: "9200000", keterangan: "Tagihan busa Agustus", pihak: "CV Foam Nusantara", lampiran: true },
  { jenis: "expense", tahap: "DISETUJUI", hariLalu: 15, pemohon: "imam", nominal: "385000", keterangan: "Bensin kendaraan (Apriansyah)", kategori: "BBM", rekening: "Kas Kantor", mode: "LANGSUNG", lampiran: true },
  { jenis: "refund", tahap: "DISETUJUI", hariLalu: 20, pemohon: "kemal", nominal: "500000", keterangan: "Pembatalan order sebagian", rekening: "SANOBANK Kemal", pihak: "Pak Budi" },
  { jenis: "purchase", tahap: "DITOLAK", hariLalu: 9, pemohon: "ferdy", nominal: "3300000", keterangan: "Kain sample warna", kategori: "Bahan Baku (input manual)", pihak: "Toko Kain Sukses", alasan: "Sudah ada stok di gudang" },
];

/** Tambahan 24 pengajuan menunggu supaya paginasi (20 per halaman) bisa diuji. */
function seedTambahan(): Seed[] {
  return Array.from({ length: 24 }, (_, i): Seed => ({
    jenis: (["expense", "purchase", "bill", "refund"] as JenisApproval[])[i % 4] as JenisApproval,
    tahap: "MENUNGGU", hariLalu: 1 + (i % 9), pemohon: (["imam", "ferdy", "kemal"] as const)[i % 3] as keyof typeof ORANG,
    nominal: String(100000 + i * 37500), keterangan: `Pengajuan contoh #${i + 1}`, kategori: "Perlengkapan kantor", rekening: "Kas Kantor", pihak: "Toko Contoh", mode: "LANGSUNG", lampiran: i % 2 === 0,
  }));
}

let db: ApprovalDetail[] = [];
let nomor = 0;

function bangun(seed: Seed): ApprovalDetail {
  nomor += 1;
  const diajukan = new Date(Date.now() - seed.hariLalu * HARI);
  const id = `mock-${nomor}`;
  const pemohon = ORANG[seed.pemohon];
  const statusPerTahap: Record<TahapApproval, string> = { MENUNGGU: "MENUNGGU_APPROVAL", DIPROSES: "DISETUJUI", DISETUJUI: seed.jenis === "bill" ? "LUNAS" : "DIBAYAR", DITOLAK: "DITOLAK" };
  const status = statusPerTahap[seed.tahap];
  const label: Record<string, string> = { MENUNGGU_APPROVAL: "Menunggu persetujuan", DISETUJUI: "Disetujui", DIBAYAR: "Dibayar", LUNAS: "Lunas", DITOLAK: "Ditolak" };
  const diputuskan = seed.tahap === "MENUNGGU" ? null : ORANG.penyetuju;
  const riwayat = [{ waktu: iso(diajukan), peristiwa: "DIAJUKAN", label: "Diajukan", oleh: pemohon.name, catatan: null as string | null }];
  if (seed.tahap !== "MENUNGGU") {
    riwayat.push({
      waktu: iso(new Date(diajukan.getTime() + HARI / 2)), peristiwa: seed.tahap === "DITOLAK" ? "DOCUMENT_REJECTED" : "DOCUMENT_APPROVED",
      label: seed.tahap === "DITOLAK" ? "Ditolak" : "Disetujui", oleh: ORANG.penyetuju.name, catatan: seed.alasan ?? null,
    });
  }
  const item: ApprovalDetail = {
    kunci: `${seed.jenis}:${id}`, id, jenis: seed.jenis, jenisLabel: LABEL_JENIS[seed.jenis],
    nomor: `${PREFIKS[seed.jenis]}-${String(diajukan.getUTCDate()).padStart(2, "0")}092026-${String(nomor).padStart(3, "0")}`,
    tanggal: iso(diajukan).slice(0, 10), diajukanPada: iso(diajukan), umurHari: seed.hariLalu,
    pemohon, nominal: toMoney(seed.nominal), keterangan: seed.keterangan, kategori: seed.kategori ?? null, rekening: seed.rekening ?? null,
    pihak: seed.pihak ?? null, nomorOrder: seed.jenis === "refund" ? "RES-05092026-027" : null, mode: seed.mode ?? null,
    status, statusLabel: label[status] ?? status, tahap: seed.tahap, adaLampiran: !!seed.lampiran, alasanTolak: seed.alasan ?? null,
    diputuskanOleh: diputuskan, diputuskanPada: diputuskan ? iso(new Date(diajukan.getTime() + HARI / 2)) : null,
    syarat: seed.tanpaNota ? { terpenuhi: false, pesan: "Pengeluaran ini wajib punya foto nota sebelum disetujui." } : null,
    aksi: { setujui: { boleh: false, alasan: null, path: "" }, tolak: { boleh: false, alasan: null, path: "", alasanWajib: true } },
    rincian: {
      ...(seed.mode ? { divisi: "PRODUKSI" } : {}),
      ...(seed.jenis === "bill" ? { nomorFakturSupplier: "INV-778", jatuhTempo: iso(new Date(Date.now() + 14 * HARI)).slice(0, 10) } : {}),
      ...(seed.mode === "REIMBURSEMENT" ? { diganti: pemohon.name } : {}),
      catatan: "Catatan contoh untuk pengajuan ini.",
    },
    lampiran: seed.lampiran ? [{ id: `foto-${id}`, jenis: "foto", url: FOTO_CONTOH, thumbUrl: FOTO_CONTOH, kedaluwarsa: iso(new Date(Date.now() + 600000)) }] : [],
    riwayat,
  };
  return item;
}

let versiDb = -1;
export function resetApprovalContoh() {
  nomor = 0;
  db = [...SEED, ...seedTambahan()].map(bangun);
  versiDb = versiSkenario();
}
/** Data contoh dimuat ulang tiap login contoh (versi skenario berubah), jadi keputusan tes sebelumnya tidak terbawa. */
function pastikan() {
  if (db.length === 0 || versiDb !== versiSkenario()) resetApprovalContoh();
}

/** `aksi` menurut pengguna yang sedang masuk — meniru hitungAksi() server (izin + pemisahan tugas + syarat bukti). */
function aksiUntuk(d: ApprovalDetail) {
  const s = useSession.getState();
  const punya = has(s.capabilities, "financeApprove");
  const admin = has(s.capabilities, "financeAdmin");
  const menunggu = d.tahap === "MENUNGGU";
  const sendiri = (d.jenis === "expense" || d.jenis === "purchase") && d.pemohon?.id === s.user?.id && !admin;
  let setuju = punya && menunggu;
  let alasanSetuju: string | null = !punya ? "Akun Anda tidak punya izin memutuskan persetujuan." : !menunggu ? "Dokumen ini sudah diputuskan." : null;
  if (setuju && sendiri) { setuju = false; alasanSetuju = "Pengajuan Anda sendiri harus disetujui orang lain."; }
  if (setuju && d.syarat) { setuju = false; alasanSetuju = d.syarat.pesan; }
  const tolak = punya && menunggu;
  const p = (a: string) => `/finance/${PATH_JENIS[d.jenis]}/${d.id}/${a}`;
  return {
    setujui: { boleh: setuju, alasan: setuju ? null : alasanSetuju, path: p("approve") },
    tolak: { boleh: tolak, alasan: tolak ? null : (alasanSetuju ?? "Dokumen ini sudah diputuskan."), path: p("reject"), alasanWajib: true },
  };
}

const denganAksi = <T extends ApprovalDetail>(d: T): T => ({ ...d, aksi: aksiUntuk(d) });

function cocokCari(d: ApprovalDetail, q: string): boolean {
  const kata = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const gudang = [d.nomor, d.keterangan, d.pihak, d.kategori, d.pemohon?.name, d.rekening, d.nominal.split(".")[0]].join(" ").toLowerCase();
  return kata.every((k) => gudang.includes(k.replace(/\./g, "")) || gudang.includes(k));
}

function terfilter(filter: FilterApproval, denganTab: boolean): ApprovalDetail[] {
  return db.filter((d) =>
    (!denganTab || d.tahap === filter.tab)
    && (filter.jenis.length === 0 || filter.jenis.includes(d.jenis))
    && (!filter.pemohonId || d.pemohon?.id === filter.pemohonId)
    && (!filter.from || !filter.to || (d.tanggal >= filter.from && d.tanggal <= filter.to))
    && (!filter.q.trim() || cocokCari(d, filter.q)));
}

export async function mockDaftar(filter: FilterApproval, page: number): Promise<ApprovalHalaman> {
  await simulasiBaca("daftar");
  pastikan();
  if (getSkenario() === "kosong") return { items: [], tab: filter.tab, page: 1, limit: DEFAULT_LIMIT, total: 0, adaLagi: false, hitung: { MENUNGGU: 0, DIPROSES: 0, DISETUJUI: 0, DITOLAK: 0 } };
  const semua = terfilter(filter, true).sort((a, b) => (filter.tab === "MENUNGGU" ? 1 : -1) * (Date.parse(a.diajukanPada) - Date.parse(b.diajukanPada)));
  const awal = (page - 1) * DEFAULT_LIMIT;
  const tanpaTab = terfilter(filter, false);
  const hitung = { MENUNGGU: 0, DIPROSES: 0, DISETUJUI: 0, DITOLAK: 0 } as Record<TahapApproval, number>;
  for (const d of tanpaTab) hitung[d.tahap] += 1;
  const items = semua.slice(awal, awal + DEFAULT_LIMIT).map(denganAksi);
  return { items, tab: filter.tab, page, limit: DEFAULT_LIMIT, total: semua.length, adaLagi: awal + items.length < semua.length, hitung };
}

export async function mockDetail(jenis: string, id: string): Promise<ApprovalDetail> {
  await simulasiBaca("detail");
  pastikan();
  const d = db.find((x) => x.id === id && x.jenis === jenis);
  if (!d) throw new ApiError({ status: 404, code: "NOT_FOUND", message: "Dokumen tidak ditemukan di inbox persetujuan" });
  return denganAksi(d);
}

export async function mockBadge(): Promise<number> {
  await simulasiBaca("badge");
  pastikan();
  return getSkenario() === "kosong" ? 0 : db.filter((d) => d.tahap === "MENUNGGU").length;
}

export async function mockPemohon() {
  pastikan();
  const peta = new Map(db.map((d) => [d.pemohon?.id ?? "", d.pemohon?.name ?? ""]));
  return [...peta.entries()].filter(([id]) => id).map(([id, name]) => ({ id, name }));
}

/** Meniru POST /finance/{jenis}/:id/approve|reject — termasuk 409 (sudah diputuskan), 400 (alasan kosong), 403, 422. */
export async function mockPutuskan(path: string, body: { reason?: string }): Promise<void> {
  await new Promise((r) => setTimeout(r, getSkenario() === "lambat" ? 4000 : 450));
  const m = /^\/finance\/(expenses|purchases|bills|refunds)\/([^/]+)\/(approve|reject)$/.exec(path);
  if (!m) throw new ApiError({ status: 404, code: "NOT_FOUND", message: "Alamat tidak dikenal" });
  const [, , id, aksi] = m;
  const d = db.find((x) => x.id === id);
  if (!d) throw new ApiError({ status: 404, code: "NOT_FOUND", message: "Dokumen tidak ditemukan" });
  const skenario = getSkenario();
  if (skenario === "izin") throw new ApiError({ status: 403, code: "FORBIDDEN", message: "Anda tidak punya izin untuk tindakan ini" });
  if (skenario === "offline" || skenario === "putus") throw new ApiError({ status: 0, code: "NETWORK", message: "Status belum pasti — koneksi terputus setelah perintah terkirim. Cek daftar dulu sebelum mencoba lagi.", tidakPasti: true });
  if (skenario === "galat") throw new ApiError({ status: 500, code: "INTERNAL", message: "boom" });
  if (skenario === "konflik" && d.tahap === "MENUNGGU") {
    // Orang lain memutuskan tepat sebelum permintaan ini sampai.
    d.tahap = "DISETUJUI"; d.status = "DIBAYAR"; d.statusLabel = "Dibayar"; d.diputuskanOleh = ORANG.penyetuju; d.diputuskanPada = iso(new Date());
    d.riwayat.push({ waktu: iso(new Date()), peristiwa: "DOCUMENT_APPROVED", label: "Disetujui", oleh: ORANG.penyetuju.name, catatan: null });
  }
  if (d.tahap !== "MENUNGGU") throw new ApiError({ status: 409, code: "CONFLICT", message: `Dokumen ini sudah berstatus ${d.status}` });
  if (aksi === "reject" && !body.reason?.trim()) throw new ApiError({ status: 400, code: "BAD_REQUEST", message: "Alasan penolakan wajib diisi" });
  if (aksi === "approve" && d.syarat) throw new ApiError({ status: 422, code: "UNPROCESSABLE", message: d.syarat.pesan });

  const s = useSession.getState();
  const oleh = { id: s.user?.id ?? "u", name: s.user?.name ?? "Anda" };
  const waktu = iso(new Date());
  if (aksi === "approve") {
    d.tahap = "DISETUJUI"; d.status = d.jenis === "bill" ? "DISETUJUI" : "DIBAYAR";
    if (d.jenis === "bill") d.tahap = "DIPROSES";
    d.statusLabel = d.status === "DIBAYAR" ? "Dibayar" : "Disetujui";
  } else {
    d.tahap = "DITOLAK"; d.status = "DITOLAK"; d.statusLabel = "Ditolak"; d.alasanTolak = body.reason?.trim() ?? null;
  }
  d.diputuskanOleh = oleh; d.diputuskanPada = waktu;
  d.riwayat.push({ waktu, peristiwa: aksi === "approve" ? "DOCUMENT_APPROVED" : "DOCUMENT_REJECTED", label: aksi === "approve" ? "Disetujui" : "Ditolak", oleh: oleh.name, catatan: aksi === "reject" ? d.alasanTolak : null });
}
