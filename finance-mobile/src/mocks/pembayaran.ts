// SERVER PEMBAYARAN PALSU (mode contoh saja — tidak pernah aktif di production). Meniru kontrak GET /finance/pembayaran beserta
// verifikasi/penolakan: status dan `aksi` dihitung "server" (izin paymentWrite khusus FINANCE), keputusan mengubah data di memori
// sehingga daftar/detail berikutnya mencerminkan status resmi. Skenario `konflik` / `izin` / `putus` mensimulasikan 409 / 403 / hasil tidak pasti.

import { ApiError } from "@/api/errors";
import { DEFAULT_LIMIT as LIMIT_BAYAR } from "@/api/approvalConst";
import { toMoney } from "@/lib/money";
import { useSession } from "@/auth/session";
import { has } from "@/auth/capabilities";
import { getSkenario, simulasiBaca, versiSkenario } from "./skenario";
import type {
  AksiPembayaran, FilterPembayaran, JenisBayar, MetodeBayar, OpsiBayar, PembayaranDetail, PembayaranHalaman, RingkasanBayar, StatusBayar,
} from "@/api/types";

const FOTO_CONTOH = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const LABEL_STATUS: Record<StatusBayar, string> = { MENUNGGU: "Menunggu verifikasi", TERVERIFIKASI: "Terverifikasi", DITOLAK: "Ditolak", DIBATALKAN: "Dibatalkan" };
const LABEL_METODE: Record<MetodeBayar, string> = { CASH: "Tunai", TRANSFER: "Transfer", QRIS: "QRIS", CARD: "Kartu" };
const HARI = 86400000;
const iso = (d: Date) => d.toISOString();
const hariWIB = (d: Date) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

const ORANG = {
  sales1: { id: "u-risel", name: "Risel" },
  sales2: { id: "u-farhan", name: "Farhan" },
  driver: { id: "u-apriansyah", name: "Apriansyah" },
  penyetuju: { id: "u-finance-lain", name: "Finance Lain" },
};
const REKENING = {
  bank1: { id: "rek-bank-kemal", name: "SANOBANK Kemal" },
  bank2: { id: "rek-pt-sano", name: "PT Sano" },
  kas: { id: "rek-kas", name: "Kas Kantor" },
};

type Seed = {
  status: StatusBayar; hariLalu: number; nominal: string; metode: MetodeBayar; jenis: JenisBayar; pelanggan: string; nilaiOrder: string;
  rekening?: keyof typeof REKENING | null; pencatat?: keyof typeof ORANG; bukti?: "gambar" | "pdf" | null; pengiriman?: boolean;
  alokasi?: { nomor: string; nominal: string }[]; peringatan?: { kode: string; pesan: string }[]; alasan?: string; invoice?: boolean;
};

const SEED: Seed[] = [
  { status: "MENUNGGU", hariLalu: 0, nominal: "1500000", metode: "TRANSFER", jenis: "DP", pelanggan: "Ibu Erni", nilaiOrder: "5000000", rekening: "bank1", bukti: "gambar", invoice: true },
  { status: "MENUNGGU", hariLalu: 1, nominal: "2500000", metode: "TRANSFER", jenis: "CICILAN", pelanggan: "Pak Budi", nilaiOrder: "8000000", rekening: "bank2", bukti: "pdf" },
  { status: "MENUNGGU", hariLalu: 1, nominal: "3000000", metode: "CASH", jenis: "PELUNASAN", pelanggan: "Ibu Sari", nilaiOrder: "3000000", rekening: "kas", pencatat: "driver", pengiriman: true },
  { status: "MENUNGGU", hariLalu: 2, nominal: "750000", metode: "TRANSFER", jenis: "DP", pelanggan: "Pak Andi", nilaiOrder: "4500000", rekening: "bank1", peringatan: [{ kode: "TANPA_BUKTI", pesan: "Belum ada bukti pembayaran terlampir." }] },
  {
    status: "MENUNGGU", hariLalu: 2, nominal: "6000000", metode: "TRANSFER", jenis: "PELUNASAN", pelanggan: "Ibu Wulan", nilaiOrder: "5500000", rekening: "bank2", bukti: "gambar",
    peringatan: [
      { kode: "NOMINAL_MELEBIHI_ORDER", pesan: "Nominal lebih besar dari nilai order." },
      { kode: "KELEBIHAN_BAYAR", pesan: "Bersama pembayaran lain, total melebihi nilai order (kelebihan bayar). Sistem tidak punya aturan khusus; periksa manual." },
    ],
  },
  { status: "MENUNGGU", hariLalu: 3, nominal: "1000000", metode: "QRIS", jenis: "CICILAN", pelanggan: "Toko Kasur Makmur", nilaiOrder: "9000000", rekening: "bank1", bukti: "gambar", peringatan: [{ kode: "KEMUNGKINAN_GANDA", pesan: "Ada 1 pembayaran lain untuk order yang sama dengan nominal & cara bayar yang sama dalam 24 jam." }] },
  { status: "MENUNGGU", hariLalu: 4, nominal: "700000", metode: "TRANSFER", jenis: "CICILAN", pelanggan: "Ibu Erni", nilaiOrder: "1000000", rekening: "bank1", bukti: "gambar", alokasi: [{ nomor: "SAN-S5-0001", nominal: "500000" }, { nomor: "SAN-S5-0002", nominal: "200000" }] },
  { status: "MENUNGGU", hariLalu: 5, nominal: "98765432109876.54", metode: "TRANSFER", jenis: "PELUNASAN", pelanggan: "PT Sinar Abadi Sejahtera Bersama Nusantara Raya Indonesia", nilaiOrder: "98765432109876.54", rekening: "bank2", bukti: "gambar" },
  { status: "TERVERIFIKASI", hariLalu: 6, nominal: "2000000", metode: "TRANSFER", jenis: "DP", pelanggan: "Pak Hendra", nilaiOrder: "6000000", rekening: "bank1", bukti: "gambar" },
  { status: "TERVERIFIKASI", hariLalu: 9, nominal: "4200000", metode: "TRANSFER", jenis: "PELUNASAN", pelanggan: "Ibu Maya", nilaiOrder: "4200000", rekening: "bank2", bukti: "pdf" },
  { status: "TERVERIFIKASI", hariLalu: 12, nominal: "1250000", metode: "CASH", jenis: "DP", pelanggan: "Pak Joko", nilaiOrder: "3000000", rekening: "kas", pencatat: "driver", pengiriman: true },
  { status: "DITOLAK", hariLalu: 7, nominal: "800000", metode: "TRANSFER", jenis: "DP", pelanggan: "Pak Rudi", nilaiOrder: "3200000", rekening: "bank1", bukti: "gambar", alasan: "Uang belum masuk di mutasi rekening" },
  { status: "DITOLAK", hariLalu: 10, nominal: "3500000", metode: "TRANSFER", jenis: "CICILAN", pelanggan: "Ibu Tini", nilaiOrder: "7000000", rekening: "bank2", alasan: "Salah catat: nominal seharusnya 350.000" },
  { status: "DIBATALKAN", hariLalu: 14, nominal: "500000", metode: "CASH", jenis: "DP", pelanggan: "Pak Yusuf", nilaiOrder: "2500000", rekening: "kas", alasan: "Dibatalkan admin di CRM" },
];

/** 14 pembayaran menunggu tambahan supaya paginasi (20 per halaman) bisa diuji: total menunggu = 8 + 14 = 22. */
function seedTambahan(): Seed[] {
  return Array.from({ length: 14 }, (_, i): Seed => ({
    status: "MENUNGGU", hariLalu: 3 + (i % 8), nominal: String(250000 + i * 50000), metode: (["TRANSFER", "QRIS", "CASH"] as MetodeBayar[])[i % 3] as MetodeBayar,
    jenis: (["DP", "CICILAN", "PELUNASAN"] as JenisBayar[])[i % 3] as JenisBayar, pelanggan: `Pelanggan Contoh ${i + 1}`, nilaiOrder: String(1000000 + i * 200000),
    rekening: i % 2 === 0 ? "bank1" : "bank2", bukti: i % 3 === 2 ? null : "gambar",
  }));
}

let db: PembayaranDetail[] = [];
let nomor = 0;

function bangun(seed: Seed): PembayaranDetail {
  nomor += 1;
  const dicatat = new Date(Date.now() - seed.hariLalu * HARI);
  const id = `bayar-${nomor}`;
  const pencatat = ORANG[seed.pencatat ?? (nomor % 2 ? "sales1" : "sales2")];
  const rekening = seed.rekening ? REKENING[seed.rekening] : null;
  const nomorOrder = `SAN-S5-${String(nomor).padStart(4, "0")}`;
  const riwayat: PembayaranDetail["riwayat"] = [{ waktu: iso(dicatat), peristiwa: "DICATAT", label: "Dicatat", oleh: pencatat.name, catatan: null }];
  const diputus = new Date(dicatat.getTime() + HARI / 2);
  if (seed.status === "TERVERIFIKASI") riwayat.push({ waktu: iso(diputus), peristiwa: "DOCUMENT_APPROVED", label: "Diverifikasi", oleh: ORANG.penyetuju.name, catatan: null });
  if (seed.status === "DITOLAK") riwayat.push({ waktu: iso(diputus), peristiwa: "DOCUMENT_REJECTED", label: "Ditolak", oleh: ORANG.penyetuju.name, catatan: seed.alasan ?? null });
  if (seed.status === "DIBATALKAN") riwayat.push({ waktu: iso(diputus), peristiwa: "DIBATALKAN", label: "Dibatalkan", oleh: ORANG.penyetuju.name, catatan: seed.alasan ?? null });
  const menunggu = seed.status === "MENUNGGU";
  const nilai = toMoney(seed.nilaiOrder);
  return {
    id, status: seed.status, statusLabel: LABEL_STATUS[seed.status], nominal: toMoney(seed.nominal), metode: seed.metode, metodeLabel: LABEL_METODE[seed.metode],
    jenis: seed.status === "DITOLAK" || seed.status === "DIBATALKAN" ? null : seed.jenis, dicatatPada: iso(dicatat), tanggal: hariWIB(dicatat),
    order: { id: `order-${nomor}`, nomor: nomorOrder, nilai, statusBayar: seed.status === "TERVERIFIKASI" && seed.jenis === "PELUNASAN" ? "LUNAS" : menunggu ? "BELUM_BAYAR" : "DP" },
    pelanggan: { id: `cust-${nomor}`, name: seed.pelanggan }, rekening, pencatat, sumber: seed.pengiriman ? "PENGIRIMAN" : "CRM",
    adaBukti: !!seed.bukti, adaAlokasi: !!seed.alokasi?.length,
    verifikasi: seed.status === "TERVERIFIKASI" ? { oleh: ORANG.penyetuju, pada: iso(diputus) } : null,
    pembatalan: seed.status === "DITOLAK" || seed.status === "DIBATALKAN" ? { oleh: ORANG.penyetuju, pada: iso(diputus), alasan: seed.alasan ?? null } : null,
    aksi: { verifikasi: { boleh: false, alasan: null, path: "" }, tolak: { boleh: false, alasan: null, path: "", alasanWajib: true } },
    tagihan: {
      nilaiOrder: nilai, terbayarTerhitung: toMoney("0.00"), sisa: nilai, sisaSetelahIni: nilai, gerbangVerifikasi: true, terhitungSebelumVerifikasi: false,
    },
    invoice: seed.invoice ? { nomor: `INV-${hariWIB(dicatat).replace(/-/g, "").slice(6)}092026-${String(nomor).padStart(3, "0")}`, status: "SENT", jatuhTempo: hariWIB(new Date(Date.now() + 14 * HARI)) } : null,
    statusOrder: "DELIVERED",
    alokasi: (seed.alokasi ?? []).map((a, i) => ({ orderId: `order-a${nomor}-${i}`, nomor: a.nomor, nominal: toMoney(a.nominal), catatan: null })),
    jurnal: seed.status === "TERVERIFIKASI" || menunggu ? { nomor: `JU-${String(nomor).padStart(5, "0")}`, status: "POSTED", tanggal: hariWIB(dicatat) } : null,
    belumDibukukan: null,
    bukti: seed.bukti === "pdf"
      ? { jenis: "pdf", url: `/media/bukti-pembayaran/bukti-${nomor}.pdf?exp=1&sig=contoh`, thumbUrl: null, kedaluwarsa: iso(new Date(Date.now() + 600000)) }
      : seed.bukti === "gambar" ? { jenis: "gambar", url: FOTO_CONTOH, thumbUrl: FOTO_CONTOH, kedaluwarsa: iso(new Date(Date.now() + 600000)) } : null,
    tidakTercatat: ["referensi", "pengirim", "catatan"],
    peringatan: seed.peringatan ?? [],
    riwayat,
  };
}

let versiDb = -1;
export function resetPembayaranContoh() {
  nomor = 0;
  db = [...SEED, ...seedTambahan()].map(bangun);
  versiDb = versiSkenario();
}
/** Data contoh dimuat ulang tiap login contoh (versi skenario berubah), jadi keputusan tes sebelumnya tidak terbawa. */
function pastikan() {
  if (db.length === 0 || versiDb !== versiSkenario()) resetPembayaranContoh();
}

/** `aksi` menurut pengguna yang sedang masuk — meniru hitungAksi() server: hanya paymentWrite (khusus FINANCE) pada pembayaran MENUNGGU. */
function aksiUntuk(d: PembayaranDetail): PembayaranDetail["aksi"] {
  const punya = has(useSession.getState().capabilities, "paymentWrite");
  const alasan = !punya ? "Akun Anda tidak punya izin memverifikasi pembayaran."
    : d.status === "TERVERIFIKASI" ? "Pembayaran ini sudah diverifikasi."
    : d.status !== "MENUNGGU" ? "Pembayaran ini sudah dibatalkan." : null;
  const p = (a: string): AksiPembayaran => ({ boleh: !alasan, alasan, path: `/finance/pembayaran/${d.id}/${a}` });
  return { verifikasi: p("verifikasi"), tolak: { ...p("tolak"), alasanWajib: true } };
}
const denganAksi = <T extends PembayaranDetail>(d: T): T => ({ ...d, aksi: aksiUntuk(d) });

function cocokCari(d: PembayaranDetail, q: string): boolean {
  const kata = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const gudang = [d.order?.nomor, d.pelanggan?.name, d.pencatat?.name, d.rekening?.name, d.nominal.split(".")[0]].join(" ").toLowerCase();
  return kata.every((k) => gudang.includes(k.replace(/\./g, "")) || gudang.includes(k));
}

function terfilter(f: FilterPembayaran): PembayaranDetail[] {
  return db.filter((d) =>
    (!f.metode || d.metode === f.metode)
    && (!f.rekeningId || d.rekening?.id === f.rekeningId)
    && (!f.from || !f.to || (d.tanggal >= f.from && d.tanggal <= f.to))
    && (!f.q.trim() || cocokCari(d, f.q)));
}

function ringkasan(from: string | null, to: string | null): RingkasanBayar {
  const dalam = db.filter((d) => !from || !to || (d.tanggal >= from && d.tanggal <= to));
  const per = (s: StatusBayar) => {
    const baris = dalam.filter((d) => d.status === s);
    // Penjumlahan hanya untuk data contoh (bukan logika uang produksi): nominal contoh bulat, dijumlah sebagai teks lewat BigInt.
    const total = baris.reduce((acc, d) => acc + BigInt(d.nominal.split(".")[0] ?? "0"), BigInt(0));
    return { jumlah: baris.length, nominal: toMoney(`${total.toString()}.00`) };
  };
  const menunggu = per("MENUNGGU");
  const terverifikasi = per("TERVERIFIKASI");
  const masuk = BigInt(menunggu.nominal.split(".")[0] ?? "0") + BigInt(terverifikasi.nominal.split(".")[0] ?? "0");
  return { menunggu, terverifikasi, ditolak: per("DITOLAK"), dibatalkan: per("DIBATALKAN"), totalMasuk: toMoney(`${masuk.toString()}.00`) };
}

export async function mockDaftarBayar(filter: FilterPembayaran, cursor: string | null): Promise<PembayaranHalaman> {
  await simulasiBaca("daftar-bayar");
  pastikan();
  const kosong = getSkenario() === "kosong";
  const dasar = kosong ? [] : terfilter(filter);
  const hitung = { MENUNGGU: 0, TERVERIFIKASI: 0, DITOLAK: 0, DIBATALKAN: 0 } as Record<StatusBayar, number>;
  for (const d of dasar) hitung[d.status] += 1;
  const semua = dasar.filter((d) => d.status === filter.tab).sort((a, b) => Date.parse(b.dicatatPada) - Date.parse(a.dicatatPada));
  const awal = cursor ? Number(cursor.replace(/^o:/, "")) || 0 : 0;
  const potong = semua.slice(awal, awal + LIMIT_BAYAR);
  const berikut = awal + potong.length < semua.length ? `o:${awal + potong.length}` : null;
  return {
    items: potong.map(denganAksi), nextCursor: berikut, hitung,
    ringkasan: kosong ? { menunggu: { jumlah: 0, nominal: toMoney("0.00") }, terverifikasi: { jumlah: 0, nominal: toMoney("0.00") }, ditolak: { jumlah: 0, nominal: toMoney("0.00") }, dibatalkan: { jumlah: 0, nominal: toMoney("0.00") }, totalMasuk: toMoney("0.00") } : ringkasan(filter.from, filter.to),
    diperbaruiPada: iso(new Date()),
  };
}

export async function mockDetailBayar(id: string): Promise<PembayaranDetail> {
  await simulasiBaca("detail-bayar");
  pastikan();
  const d = db.find((x) => x.id === id);
  if (!d) throw new ApiError({ status: 404, code: "NOT_FOUND", message: "Pembayaran tidak ditemukan" });
  return denganAksi(d);
}

export async function mockLencanaBayar(): Promise<number> {
  await simulasiBaca("lencana-bayar");
  pastikan();
  return getSkenario() === "kosong" ? 0 : db.filter((d) => d.status === "MENUNGGU").length;
}

export async function mockOpsiBayar(): Promise<OpsiBayar> {
  pastikan();
  return {
    rekening: [
      { id: REKENING.bank1.id, name: REKENING.bank1.name, kind: "BANK" }, { id: REKENING.bank2.id, name: REKENING.bank2.name, kind: "BANK" }, { id: REKENING.kas.id, name: REKENING.kas.name, kind: "KAS" },
    ],
    metode: (Object.keys(LABEL_METODE) as MetodeBayar[]).map((m) => ({ id: m, label: LABEL_METODE[m] })),
  };
}

/** Meniru POST /finance/pembayaran/:id/verifikasi|tolak — termasuk 409 (sudah diproses), 400 (alasan kosong), 403, dan hasil tidak pasti. */
export async function mockPutuskanBayar(path: string, body: { reason?: string }): Promise<void> {
  await new Promise((r) => setTimeout(r, getSkenario() === "lambat" ? 4000 : 450));
  const m = /^\/finance\/pembayaran\/([^/]+)\/(verifikasi|tolak)$/.exec(path);
  if (!m) throw new ApiError({ status: 404, code: "NOT_FOUND", message: "Alamat tidak dikenal" });
  const [, id, aksi] = m;
  const d = db.find((x) => x.id === id);
  if (!d) throw new ApiError({ status: 404, code: "NOT_FOUND", message: "Pembayaran tidak ditemukan" });
  const skenario = getSkenario();
  if (skenario === "izin") throw new ApiError({ status: 403, code: "FORBIDDEN", message: "Anda tidak punya izin untuk tindakan ini" });
  if (skenario === "offline" || skenario === "putus") throw new ApiError({ status: 0, code: "NETWORK", message: "Status belum pasti — koneksi terputus setelah perintah terkirim.", tidakPasti: true });
  if (skenario === "galat") throw new ApiError({ status: 500, code: "INTERNAL", message: "boom" });
  if (skenario === "konflik" && d.status === "MENUNGGU") {
    // Finance lain memverifikasi tepat sebelum permintaan ini sampai.
    d.status = "TERVERIFIKASI"; d.statusLabel = LABEL_STATUS.TERVERIFIKASI; d.verifikasi = { oleh: ORANG.penyetuju, pada: iso(new Date()) };
    d.riwayat.push({ waktu: iso(new Date()), peristiwa: "DOCUMENT_APPROVED", label: "Diverifikasi", oleh: ORANG.penyetuju.name, catatan: null });
  }
  if (d.status === "TERVERIFIKASI") {
    throw new ApiError({ status: 409, code: "SUDAH_DIPROSES", message: `Pembayaran ini sudah diverifikasi oleh ${d.verifikasi?.oleh?.name ?? "pengguna lain"}.` });
  }
  if (d.status !== "MENUNGGU") throw new ApiError({ status: 409, code: "SUDAH_DIBATALKAN", message: "Pembayaran ini sudah dibatalkan." });
  if (aksi === "tolak" && !body.reason?.trim()) throw new ApiError({ status: 400, code: "ALASAN_WAJIB", message: "Alasan penolakan wajib diisi." });

  const s = useSession.getState();
  const oleh = { id: s.user?.id ?? "u", name: s.user?.name ?? "Anda" };
  const waktu = iso(new Date());
  if (aksi === "verifikasi") {
    d.status = "TERVERIFIKASI"; d.statusLabel = LABEL_STATUS.TERVERIFIKASI; d.verifikasi = { oleh, pada: waktu };
    if (d.order) d.order = { ...d.order, statusBayar: d.jenis === "PELUNASAN" ? "LUNAS" : "DP" };
    d.riwayat.push({ waktu, peristiwa: "DOCUMENT_APPROVED", label: "Diverifikasi", oleh: oleh.name, catatan: null });
  } else {
    d.status = "DITOLAK"; d.statusLabel = LABEL_STATUS.DITOLAK; d.jenis = null; d.jurnal = null;
    d.pembatalan = { oleh, pada: waktu, alasan: body.reason?.trim() ?? null };
    d.riwayat.push({ waktu, peristiwa: "DOCUMENT_REJECTED", label: "Ditolak", oleh: oleh.name, catatan: d.pembatalan.alasan });
  }
}
