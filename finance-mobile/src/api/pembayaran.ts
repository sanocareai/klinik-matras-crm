import { api } from "@/auth/session";
import { ApiError } from "@/api/errors";
import { jalankanPerintah } from "@/api/command";
import { isMoneyString, toMoney, type Money } from "@/lib/money";
import { ENV } from "@/lib/env";
import { DEFAULT_LIMIT } from "./approvalConst";
import { mockPutuskanBayar } from "@/mocks/pembayaran";
import type {
  AksiPembayaran, BuktiBayar, FilterPembayaran, JenisBayar, OpsiBayar, Orang, PembayaranDetail, PembayaranHalaman, PembayaranItem,
  PeringatanBayar, RingkasanBayar, RiwayatApproval, StatusBayar,
} from "./types";

// PEMBAYARAN PELANGGAN (S5) — HANYA memetakan bentuk dari server. Status (Menunggu/Terverifikasi/Ditolak), jenis (DP/cicilan/pelunasan),
// tagihan, peringatan, dan izin (`aksi`) semuanya datang dari server; klien tidak menghitung ulang uang atau status.
//   GET  /finance/pembayaran                    daftar (cursor) + hitungan per status + ringkasan periode
//   GET  /finance/pembayaran/ringkasan          jumlah menunggu (lencana)
//   GET  /finance/pembayaran/opsi               pilihan filter (rekening, metode)
//   GET  /finance/pembayaran/:id                detail + bukti bertanda-tangan + audit trail
//   POST item.aksi.verifikasi.path | tolak.path keputusan (PAYMENT_WRITE — khusus FINANCE; Idempotency-Key + step-up)
// TIDAK ADA pencatatan pembayaran baru dari aplikasi: workflow backend hanya mencatat pembayaran lewat sales/driver/CRM (gap terdokumentasi).

const LIMIT_BAYAR = DEFAULT_LIMIT;
const STATUS: StatusBayar[] = ["MENUNGGU", "TERVERIFIKASI", "DITOLAK", "DIBATALKAN"];
const JENIS: JenisBayar[] = ["DP", "CICILAN", "PELUNASAN"];
const AWAL_PATH = "/finance/pembayaran/";

/** Angka pada payload ini yang HITUNGAN (bukan uang); semua uang dari server sudah berupa string desimal. */
export const NORMALISASI_BAYAR = {
  uang: ["nominal", "nilai", "nilaiOrder", "terbayarTerhitung", "sisa", "sisaSetelahIni", "totalMasuk"],
  hitungan: ["jumlah", "menunggu", "lunasBelumDicatat", "MENUNGGU", "TERVERIFIKASI", "DITOLAK", "DIBATALKAN"],
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const teks = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const angka = (v: unknown, dasar = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : dasar);
const uang = (v: unknown): Money | null => (typeof v === "string" && isMoneyString(v) ? (v as Money) : null);
const NOL: Money = toMoney("0.00");

function orang(v: unknown): Orang | null {
  const o = obj(v);
  return o && typeof o.id === "string" ? { id: o.id, name: teks(o.name) ?? "—" } : null;
}

function petaAksi(v: unknown): AksiPembayaran {
  const o = obj(v);
  const path = teks(o?.path);
  // Tanpa path yang jelas (dan milik modul pembayaran), aksi TIDAK boleh: lebih baik tombol nonaktif daripada memanggil alamat tak dikenal.
  const boleh = o?.boleh === true && !!path && path.startsWith(AWAL_PATH);
  return { boleh, alasan: teks(o?.alasan) ?? (boleh ? null : "Tidak tersedia."), path: path ?? "", alasanWajib: o?.alasanWajib === true };
}

export function mapItem(raw: unknown): PembayaranItem | null {
  const o = obj(raw);
  if (!o || typeof o.id !== "string" || !STATUS.includes(o.status as StatusBayar)) return null;
  const nominal = uang(o.nominal);
  if (!nominal) return null;
  const ord = obj(o.order);
  const ver = obj(o.verifikasi);
  const bat = obj(o.pembatalan);
  const aksi = obj(o.aksi);
  const nilaiOrder = uang(ord?.nilai);
  return {
    id: o.id,
    status: o.status as StatusBayar,
    statusLabel: teks(o.statusLabel) ?? String(o.status),
    nominal,
    metode: teks(o.metode) ?? "—",
    metodeLabel: teks(o.metodeLabel) ?? teks(o.metode) ?? "—",
    jenis: JENIS.includes(o.jenis as JenisBayar) ? (o.jenis as JenisBayar) : null,
    dicatatPada: teks(o.dicatatPada) ?? "",
    tanggal: teks(o.tanggal) ?? "",
    order: ord && typeof ord.id === "string" && nilaiOrder ? { id: ord.id, nomor: teks(ord.nomor) ?? "—", nilai: nilaiOrder, statusBayar: teks(ord.statusBayar) ?? "" } : null,
    pelanggan: orang(o.pelanggan),
    rekening: orang(o.rekening),
    pencatat: orang(o.pencatat),
    sumber: o.sumber === "PENGIRIMAN" ? "PENGIRIMAN" : "CRM",
    adaBukti: o.adaBukti === true,
    adaAlokasi: o.adaAlokasi === true,
    verifikasi: ver ? { oleh: orang(ver.oleh), pada: teks(ver.pada) } : null,
    pembatalan: bat ? { oleh: orang(bat.oleh), pada: teks(bat.pada), alasan: teks(bat.alasan) } : null,
    aksi: { verifikasi: petaAksi(aksi?.verifikasi), tolak: petaAksi(aksi?.tolak) },
  };
}

function petaRingkasanBaris(v: unknown): { jumlah: number; nominal: Money } {
  const o = obj(v);
  return { jumlah: angka(o?.jumlah), nominal: uang(o?.nominal) ?? NOL };
}

export function petaRingkasan(v: unknown): RingkasanBayar {
  const o = obj(v);
  return {
    menunggu: petaRingkasanBaris(o?.menunggu), terverifikasi: petaRingkasanBaris(o?.terverifikasi), ditolak: petaRingkasanBaris(o?.ditolak),
    dibatalkan: petaRingkasanBaris(o?.dibatalkan), totalMasuk: uang(o?.totalMasuk) ?? NOL,
  };
}

export function mapHalaman(raw: unknown): PembayaranHalaman {
  const o = obj(raw) ?? {};
  const h = obj(o.hitung);
  return {
    items: (Array.isArray(o.items) ? o.items : []).map(mapItem).filter((x): x is PembayaranItem => x != null),
    nextCursor: teks(o.nextCursor),
    hitung: { MENUNGGU: angka(h?.MENUNGGU), TERVERIFIKASI: angka(h?.TERVERIFIKASI), DITOLAK: angka(h?.DITOLAK), DIBATALKAN: angka(h?.DIBATALKAN) },
    ringkasan: petaRingkasan(o.ringkasan),
    diperbaruiPada: teks(o.diperbaruiPada),
  };
}

function petaBukti(v: unknown): BuktiBayar | null {
  const o = obj(v);
  if (!o) return null;
  // Hanya jalur milik server (bertanda-tangan) yang dipercaya; URL luar dibuang.
  const aman = (u: unknown) => (typeof u === "string" && (u.startsWith("/media/") || u.startsWith("/api/finance/media/")) ? u : null);
  const jenis = o.jenis === "pdf" ? "pdf" : o.jenis === "gambar" ? "gambar" : "tautan";
  const url = aman(o.url);
  return { jenis: url ? jenis : "tautan", url, thumbUrl: aman(o.thumbUrl), kedaluwarsa: teks(o.kedaluwarsa) };
}

function petaRiwayat(v: unknown): RiwayatApproval[] {
  return (Array.isArray(v) ? v : []).flatMap((x) => {
    const o = obj(x);
    return o && typeof o.waktu === "string" ? [{ waktu: o.waktu, peristiwa: teks(o.peristiwa) ?? "", label: teks(o.label) ?? "Aktivitas", oleh: teks(o.oleh), catatan: teks(o.catatan) }] : [];
  });
}

export function mapDetail(raw: unknown): PembayaranDetail | null {
  const item = mapItem(raw);
  const o = obj(raw);
  if (!item || !o) return null;
  const tg = obj(o.tagihan);
  const nilaiOrder = uang(tg?.nilaiOrder);
  const inv = obj(o.invoice);
  const jr = obj(o.jurnal);
  const bd = obj(o.belumDibukukan);
  return {
    ...item,
    tagihan: tg && nilaiOrder ? {
      nilaiOrder, terbayarTerhitung: uang(tg.terbayarTerhitung) ?? NOL, sisa: uang(tg.sisa) ?? NOL, sisaSetelahIni: uang(tg.sisaSetelahIni) ?? NOL, gerbangVerifikasi: tg.gerbangVerifikasi === true, terhitungSebelumVerifikasi: tg.terhitungSebelumVerifikasi === true,
    } : null,
    invoice: inv && teks(inv.nomor) ? { nomor: inv.nomor as string, status: teks(inv.status) ?? "", jatuhTempo: teks(inv.jatuhTempo) } : null,
    statusOrder: teks(o.statusOrder),
    alokasi: (Array.isArray(o.alokasi) ? o.alokasi : []).flatMap((a) => {
      const x = obj(a);
      const nominal = uang(x?.nominal);
      return x && typeof x.orderId === "string" && nominal ? [{ orderId: x.orderId, nomor: teks(x.nomor), nominal, catatan: teks(x.catatan) }] : [];
    }),
    jurnal: jr ? { nomor: teks(jr.nomor), status: teks(jr.status) ?? "", tanggal: teks(jr.tanggal) } : null,
    belumDibukukan: bd ? { pesan: teks(bd.pesan) ?? "Pembayaran ini belum masuk buku besar." } : null,
    bukti: petaBukti(o.bukti),
    tidakTercatat: (Array.isArray(o.tidakTercatat) ? o.tidakTercatat : []).filter((x): x is string => typeof x === "string"),
    peringatan: (Array.isArray(o.peringatan) ? o.peringatan : []).flatMap((w): PeringatanBayar[] => {
      const x = obj(w);
      return x && teks(x.pesan) ? [{ kode: teks(x.kode) ?? "", pesan: x.pesan as string }] : [];
    }),
    riwayat: petaRiwayat(o.riwayat),
  };
}

export async function fetchPembayaran(filter: FilterPembayaran, cursor: string | null): Promise<PembayaranHalaman> {
  const raw = await api.get<unknown>("/finance/pembayaran", {
    query: {
      status: filter.tab, metode: filter.metode ?? undefined, rekeningId: filter.rekeningId ?? undefined,
      from: filter.from ?? undefined, to: filter.to ?? undefined, q: filter.q.trim() || undefined, limit: LIMIT_BAYAR, cursor: cursor ?? undefined,
    },
    normalisasi: NORMALISASI_BAYAR,
  });
  return mapHalaman(raw);
}

export async function fetchPembayaranDetail(id: string): Promise<PembayaranDetail> {
  const raw = await api.get<unknown>(`/finance/pembayaran/${encodeURIComponent(id)}`, { normalisasi: NORMALISASI_BAYAR });
  const d = mapDetail(raw);
  if (!d) throw new ApiError({ status: 502, code: "PARSE", message: "Respons server tidak bisa dibaca" });
  return d;
}

/** Jumlah pembayaran menunggu verifikasi (lencana). */
export async function fetchLencanaBayar(): Promise<number> {
  const raw = obj(await api.get<unknown>("/finance/pembayaran/ringkasan", { normalisasi: NORMALISASI_BAYAR }));
  return angka(raw?.menunggu);
}

export async function fetchOpsiBayar(): Promise<OpsiBayar> {
  const raw = obj(await api.get<unknown>("/finance/pembayaran/opsi"));
  const rekening = (Array.isArray(raw?.rekening) ? raw.rekening : []).flatMap((r) => {
    const x = obj(r);
    return x && typeof x.id === "string" ? [{ id: x.id, name: teks(x.name) ?? "—", kind: teks(x.kind) ?? "" }] : [];
  });
  const metode = (Array.isArray(raw?.metode) ? raw.metode : []).flatMap((m) => {
    const x = obj(m);
    return x && typeof x.id === "string" ? [{ id: x.id, label: teks(x.label) ?? x.id }] : [];
  });
  return { rekening, metode };
}

/**
 * Verifikasi / penolakan lewat endpoint milik modul pembayaran (path dari server). Wajib: izin paymentWrite (khusus FINANCE; guard
 * klien, server tetap memeriksa), step-up PIN/biometrik, dan Idempotency-Key. Tanpa koneksi perintah TIDAK dikirim dan TIDAK diantre
 * (`api.command` gagal jaringan). `kunci` dipakai ulang bila hasil sebelumnya tidak pasti.
 */
export async function putuskanBayar(opsi: { aksi: AksiPembayaran; alasan?: string; kunci: string }): Promise<void> {
  if (!opsi.aksi.boleh) throw new ApiError({ status: 403, code: "FORBIDDEN", message: opsi.aksi.alasan ?? "Tindakan ini tidak tersedia." });
  await jalankanPerintah({
    need: "paymentWrite",
    stepUp: true,
    kunci: opsi.kunci,
    run: async (k) => {
      const body = opsi.alasan != null ? { reason: opsi.alasan.trim() } : {};
      if (ENV.useMocks) { await mockPutuskanBayar(opsi.aksi.path, body); return; }
      await api.command("POST", opsi.aksi.path, k, { body });
    },
  });
}
