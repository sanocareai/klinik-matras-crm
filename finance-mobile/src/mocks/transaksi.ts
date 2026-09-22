// SERVER TRANSAKSI PALSU (mode contoh saja — tidak pernah aktif di production). Meniru kontrak GET /finance/transaksi/* dan perintah dokumen:
// status & `aksi` dihitung "server" dari capabilities, perintah mengubah data di memori sehingga daftar/detail berikutnya mencerminkan status resmi.
// Skenario `konflik` / `izin` / `putus` mensimulasikan 409 / 403 / hasil tidak pasti; `kosong` / `panjang` / `negatif` mengubah isi data.

import { ApiError } from "@/api/errors";
import { LIMIT_TX } from "@/api/transaksi";
import { bandingMoney, jumlahMoney, kurangMoney, toMoney, type Money } from "@/lib/money";
import { useSession } from "@/auth/session";
import { has } from "@/auth/capabilities";
import { getSkenario, simulasiBaca, versiSkenario } from "./skenario";
import type { AksiTx, DetailTx, DpEligible, FilterTx, HalamanTx, HasilUnggah, ItemTx, JenisApproval, ModulTx, NadaTx, OpsiForm, OrderRefund, RingkasanModul, RingkasanTx, RiwayatDp } from "@/api/types";

const m = toMoney;
const NOL = m("0.00");
const HARI = 86400000;
const hariWIB = (d: Date) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const tanggalLalu = (n: number) => hariWIB(new Date(Date.now() - n * HARI));
const tunda = (ms: number) => new Promise<void>((r) => setTimeout(r, getSkenario() === "lambat" ? 4000 : ms));

type Riwayat = { waktu: string; peristiwa: string; label: string; oleh: string | null; catatan: string | null };
type Doc = {
  modul: ModulTx; id: string; nomor: string; tanggal: string; nominal: string; judul: string; sub: string; pihak: string | null; rekening: string | null; status: string;
  jatuhTempo?: string | null; terbayar?: string; ember?: string; lampiran?: boolean; notaWajib?: boolean; mode?: string; sudahDibayar?: boolean;
  bagian?: { judul: string; baris: { label: string; nilai: string; jenis?: "teks" | "uang" | "tanggal" | "waktu"; tautan?: { modul: ModulTx; id: string } }[] }[];
  riwayat: Riwayat[]; pembayaran?: { id: string; nominal: string; status: string; alokasi: { orderId: string; nomor: string | null; nominal: string }[]; asalOrderId: string }[];
  catatan?: string | null;
  supplierId?: string; kategoriKode?: string;
};

type DpApp = {
  id: string; advanceId: string; targetId: string; amount: Money; status: "ACTIVE" | "REVERSED";
  journal: string; reversalJournal: string | null; createdAt: string; createdBy: string;
  reversedAt: string | null; reversedBy: string | null; reverseReason: string | null;
};
let dpApps: DpApp[] = [];
const dpDiterapkanUntuk = (id: string): Money => jumlahMoney(dpApps.filter((a) => a.targetId === id && a.status === "ACTIVE").map((a) => a.amount));
const dpDipakaiDari = (id: string): Money => jumlahMoney(dpApps.filter((a) => a.advanceId === id && a.status === "ACTIVE").map((a) => a.amount));

const STATUS: Record<string, [string, NadaTx]> = {
  DRAFT: ["Draf", "neutral"], MENUNGGU_APPROVAL: ["Menunggu persetujuan", "warning"], DISETUJUI: ["Disetujui", "info"], DIBAYAR: ["Dibayar", "success"],
  DIBAYAR_SEBAGIAN: ["Dibayar sebagian", "info"], LUNAS: ["Lunas", "success"], DITOLAK: ["Ditolak", "danger"], DIBATALKAN: ["Dibatalkan", "neutral"],
  AKTIF: ["Aktif", "info"], NONAKTIF: ["Nonaktif", "neutral"], LEWAT_TEMPO: ["Lewat tempo", "danger"], BERJALAN: ["Belum jatuh tempo", "info"],
};

const TAB_STATUS: Record<ModulTx, Record<string, (d: Doc) => boolean>> = {
  pengeluaran: { SEMUA: () => true, DRAF: (d) => d.status === "DRAFT", MENUNGGU: (d) => d.status === "MENUNGGU_APPROVAL", DIPROSES: (d) => d.status === "DISETUJUI", SELESAI: (d) => d.status === "DIBAYAR", DITOLAK: (d) => ["DITOLAK", "DIBATALKAN"].includes(d.status) },
  pembelian: { SEMUA: () => true, DRAF: (d) => d.status === "DRAFT", MENUNGGU: (d) => d.status === "MENUNGGU_APPROVAL", DIPROSES: (d) => d.status === "DISETUJUI", SELESAI: (d) => d.status === "DIBAYAR", DITOLAK: (d) => ["DITOLAK", "DIBATALKAN"].includes(d.status) },
  kasbon: { AKTIF: (d) => d.status === "AKTIF", LUNAS: (d) => d.status === "LUNAS", DIBATALKAN: (d) => d.status === "DIBATALKAN", SEMUA: () => true },
  pemasukan: { AKTIF: (d) => d.status === "AKTIF", DIBATALKAN: (d) => d.status === "DIBATALKAN", SEMUA: () => true },
  refund: { MENUNGGU: (d) => d.status === "MENUNGGU_APPROVAL", DISETUJUI: (d) => d.status === "DISETUJUI", DITOLAK: (d) => d.status === "DITOLAK", SEMUA: () => true },
  supplier: { AKTIF: (d) => d.status === "AKTIF", NONAKTIF: (d) => d.status === "NONAKTIF", SEMUA: () => true },
  tagihan: { MENUNGGU: (d) => d.status === "MENUNGGU_APPROVAL", TERBUKA: (d) => ["DISETUJUI", "DIBAYAR_SEBAGIAN"].includes(d.status), LUNAS: (d) => d.status === "LUNAS", DITOLAK: (d) => d.status === "DITOLAK", SEMUA: () => true },
  "pembayaran-supplier": { AKTIF: (d) => d.status === "AKTIF", DIBATALKAN: (d) => d.status === "DIBATALKAN", SEMUA: () => true },
  piutang: { SEMUA: () => true, LEWAT: (d) => (d.status === "LEWAT_TEMPO"), BERJALAN: (d) => d.status === "BERJALAN" },
};

const R = (label: string, nilai: string, jenis: "teks" | "uang" | "tanggal" | "waktu" = "teks", tautan?: { modul: ModulTx; id: string }) => ({ label, nilai, jenis, ...(tautan ? { tautan } : {}) });
const rw = (label: string, oleh = "Natasha", catatan: string | null = null): Riwayat => ({ waktu: new Date(Date.now() - 2 * HARI).toISOString(), peristiwa: "DOCUMENT", label, oleh, catatan });

let db: Doc[] = [];
let versiDb = -1;
let urut = 100;

function seed(): Doc[] {
  dpApps = [];
  const k = getSkenario();
  if (k === "kosong") return [];
  const panjang = k === "panjang";
  const d: Doc[] = [];
  const add = (x: Omit<Doc, "riwayat"> & { riwayat?: Riwayat[] }) => d.push({ riwayat: [rw("Diajukan")], ...x });
  add({ modul: "pengeluaran", id: "e1", nomor: "EXP-19092026-241", tanggal: tanggalLalu(2), nominal: panjang ? "98765432109876.54" : "150000.00", judul: panjang ? "Servis kendaraan operasional pengiriman wilayah Bekasi Barat dan sekitarnya" : "Servis truk pengiriman", sub: "Servis Kendaraan · Bayar langsung", pihak: "Bengkel Jaya", rekening: "KEM - Sano Bank", status: "MENUNGGU_APPROVAL", mode: "LANGSUNG", lampiran: true });
  add({ modul: "pengeluaran", id: "e2", nomor: "EXP-20092026-263", tanggal: tanggalLalu(1), nominal: "980000.00", judul: "Ganti ban truk", sub: "Servis Kendaraan · Bayar langsung", pihak: "Toko Ban", rekening: "PT Sano", status: "MENUNGGU_APPROVAL", mode: "LANGSUNG", notaWajib: true });
  add({ modul: "pengeluaran", id: "e3", nomor: "EXP-18092026-245", tanggal: tanggalLalu(3), nominal: "300000.00", judul: "Reimburse bensin", sub: "BBM · Reimbursement", pihak: "Agung", rekening: null, status: "DISETUJUI", mode: "REIMBURSEMENT", lampiran: true });
  add({ modul: "pengeluaran", id: "e4", nomor: "EXP-17092026-252", tanggal: tanggalLalu(4), nominal: "45000.00", judul: "Air mineral kantor", sub: "Operasional · Bayar langsung", pihak: null, rekening: "Uang Kas Sano", status: "DIBAYAR", mode: "LANGSUNG" });
  add({ modul: "pengeluaran", id: "e5", nomor: "EXP-16092026-230", tanggal: tanggalLalu(5), nominal: "20000.00", judul: "Parkir", sub: "Operasional · Bayar langsung", pihak: null, rekening: "Uang Kas Sano", status: "DRAFT", mode: "LANGSUNG" });
  add({ modul: "pengeluaran", id: "e6", nomor: "EXP-15092026-220", tanggal: tanggalLalu(6), nominal: "500000.00", judul: "Pembelian ATK", sub: "Perlengkapan · Bayar langsung", pihak: null, rekening: "PT Sano", status: "DITOLAK", mode: "LANGSUNG", riwayat: [rw("Diajukan"), rw("Ditolak", "Kemal", "Nota tidak terbaca")] });
  for (let i = 0; i < 22; i++) add({ modul: "pengeluaran", id: `ex${i}`, nomor: `EXP-1409${2026}-${300 + i}`, tanggal: tanggalLalu(7 + i), nominal: `${(10 + i) * 1000}.00`, judul: `Operasional ${i + 1}`, sub: "Operasional · Bayar langsung", pihak: null, rekening: "Uang Kas Sano", status: "DIBAYAR", mode: "LANGSUNG" });
  add({ modul: "pembelian", id: "p1", nomor: "PUR-18092026-026", tanggal: tanggalLalu(3), nominal: "1250000.00", judul: "Kain oscar 20 meter", sub: "Bahan Baku · Bayar langsung", pihak: "Toko Kain", rekening: "PT Sano", status: "MENUNGGU_APPROVAL", mode: "LANGSUNG", notaWajib: true });
  add({ modul: "pembelian", id: "p2", nomor: "PUR-17092026-027", tanggal: tanggalLalu(4), nominal: "12000.00", judul: "Lem kasur", sub: "Bahan Baku · Reimbursement", pihak: "Agung", rekening: null, status: "DISETUJUI", mode: "REIMBURSEMENT", lampiran: true });
  add({ modul: "pembelian", id: "p3", nomor: "PUR-15092026-028", tanggal: tanggalLalu(6), nominal: "2100000.00", judul: "Rangka kayu jati 10 unit", sub: "Bahan Baku · Utang", pihak: "Toko Kain", rekening: null, status: "DISETUJUI", mode: "UTANG", supplierId: "sup-dp", kategoriKode: "BAHAN_BAKU_MANUAL" });
  add({ modul: "pembelian", id: "p4", nomor: "PUR-01092026-020", tanggal: tanggalLalu(20), nominal: "600000.00", judul: "DP ke Toko Kain", sub: "Uang Muka Pembelian · Bayar langsung", pihak: "Toko Kain", rekening: "PT Sano", status: "DIBAYAR", mode: "LANGSUNG", supplierId: "sup-dp", kategoriKode: "UANG_MUKA_PEMBELIAN" });
  add({ modul: "pembelian", id: "p5", nomor: "PUR-28082026-018", tanggal: tanggalLalu(24), nominal: "300000.00", judul: "DP kedua ke Toko Kain", sub: "Uang Muka Pembelian · Bayar langsung", pihak: "Toko Kain", rekening: "PT Sano", status: "DIBAYAR", mode: "LANGSUNG", supplierId: "sup-dp", kategoriKode: "UANG_MUKA_PEMBELIAN" });
  add({ modul: "kasbon", id: "k1", nomor: "KSB-19092026-001", tanggal: tanggalLalu(2), nominal: "1000000.00", judul: "Agung", sub: "Keperluan keluarga mendesak", pihak: "Agung", rekening: "KEM - Sano Bank", status: "AKTIF", terbayar: "400000.00", riwayat: [rw("Dibukukan")] });
  add({ modul: "kasbon", id: "k2", nomor: "KSB-10092026-002", tanggal: tanggalLalu(11), nominal: "500000.00", judul: "Imam", sub: "Biaya berobat anak", pihak: "Imam", rekening: "Uang Kas Sano", status: "LUNAS", terbayar: "500000.00", riwayat: [rw("Dibukukan")] });
  add({ modul: "pemasukan", id: "i1", nomor: "INC-19092026-001", tanggal: tanggalLalu(2), nominal: "75000.50", judul: "Bunga bank", sub: "4-9000 Pendapatan Lain-lain", pihak: null, rekening: "KEM - Sano Bank", status: "AKTIF", riwayat: [rw("Dibukukan")], catatan: "Pemasukan Lain bukan pembayaran order. Uang dari pelanggan dicatat di Pembayaran & Verifikasi." });
  add({ modul: "piutang", id: "o1", nomor: "INV-01092026-004", tanggal: tanggalLalu(20), nominal: "2000000.00", judul: "Ibu Sari", sub: "Order SAN-0001", pihak: "Risel", rekening: null, status: "LEWAT_TEMPO", jatuhTempo: tanggalLalu(20), terbayar: "500000.00", ember: "1_30", riwayat: [], pembayaran: [{ id: "bp1", nominal: "500000.00", status: "TERVERIFIKASI", asalOrderId: "o1", alokasi: [] }] });
  add({ modul: "piutang", id: "o2", nomor: "SAN-0002", tanggal: tanggalLalu(-10), nominal: "3500000.00", judul: "Bapak Budi", sub: "Order SAN-0002", pihak: "Kiki", rekening: null, status: "BERJALAN", jatuhTempo: tanggalLalu(-10), terbayar: "0.00", ember: "belum_jatuh_tempo", riwayat: [] });
  add({ modul: "refund", id: "r1", nomor: "RFD-19092026-001", tanggal: tanggalLalu(2), nominal: "200000.00", judul: "Kasur cacat produksi", sub: "Order SAN-0001", pihak: "Ibu Sari", rekening: "KEM - Sano Bank", status: "MENUNGGU_APPROVAL" });
  add({ modul: "supplier", id: "s1", nomor: "SUP-001", tanggal: tanggalLalu(60), nominal: "1000000.00", judul: "CV Busa Jaya", sub: "0812-3456-7890 · Termin 14 hari", pihak: "CV Busa Jaya", rekening: null, status: "AKTIF", riwayat: [], bagian: [{ judul: "Supplier", baris: [R("Kode", "SUP-001"), R("Nama", "CV Busa Jaya")] }, { judul: "Rekening supplier", baris: [R("Bank", "BCA"), R("Nomor rekening", "1234567")] }] });
  add({ modul: "tagihan", id: "t1", nomor: "BILL-01082026-001", tanggal: tanggalLalu(50), nominal: "1000000.00", judul: "CV Busa Jaya", sub: "Busa 20 lembar", pihak: "CV Busa Jaya", rekening: null, status: "DIBAYAR_SEBAGIAN", jatuhTempo: tanggalLalu(35), terbayar: "400000.00", riwayat: [rw("Diajukan"), rw("Disetujui", "Kemal")] });
  add({ modul: "tagihan", id: "t2", nomor: "BILL-15092026-002", tanggal: tanggalLalu(6), nominal: "750000.00", judul: "CV Busa Jaya", sub: "Per pegas", pihak: "CV Busa Jaya", rekening: null, status: "MENUNGGU_APPROVAL", jatuhTempo: tanggalLalu(-8), terbayar: "0.00" });
  add({ modul: "pembayaran-supplier", id: "ps1", nomor: "PAYOUT-10092026-001", tanggal: tanggalLalu(10), nominal: "400000.00", judul: "CV Busa Jaya", sub: "BILL-01082026-001", pihak: "CV Busa Jaya", rekening: "KEM - Sano Bank", status: "AKTIF", riwayat: [] });
  return d;
}

function pastikanDb() {
  if (versiDb !== versiSkenario()) { db = seed(); versiDb = versiSkenario(); }
}

const caps = () => useSession.getState().capabilities;
const orangSaya = () => useSession.getState().user?.name ?? "Anda";
const ok = (b: boolean, alasan: string, path: string, extra: Partial<AksiTx> = {}): AksiTx => ({ boleh: b, alasan: b ? null : alasan, path, metode: "POST", perlu: [], tetap: null, ...extra });

const JALUR_DOK: Partial<Record<ModulTx, string>> = { pengeluaran: "expenses", pembelian: "purchases" };
const JENIS_PUTUS: Partial<Record<ModulTx, JenisApproval>> = { pengeluaran: "expense", pembelian: "purchase", tagihan: "bill", refund: "refund" };

function sisaDari(d: Doc): Money | null {
  if (d.modul === "kasbon" || d.modul === "tagihan") {
    const n = (s: string) => BigInt(s.replace(".", ""));
    return m(`${(n(d.nominal) - n(d.terbayar ?? "0.00")) / 100n}.${((n(d.nominal) - n(d.terbayar ?? "0.00")) % 100n).toString().padStart(2, "0")}`);
  }
  if (d.modul === "piutang") {
    const n = (s: string) => BigInt(s.replace(".", ""));
    const s = n(d.nominal) - n(d.terbayar ?? "0.00");
    return m(`${s / 100n}.${(s % 100n).toString().padStart(2, "0")}`);
  }
  if (d.modul === "supplier") return m(d.nominal);
  if (d.modul === "pembelian" && d.mode === "UTANG" && d.status !== "DIBAYAR" && d.kategoriKode !== "UANG_MUKA_PEMBELIAN") {
    return kurangMoney(m(d.nominal), dpDiterapkanUntuk(d.id));
  }
  return null;
}

function aksiUntuk(d: Doc): Record<string, AksiTx> {
  const c = caps();
  const post = has(c, "financePost");
  const admin = has(c, "financeAdmin");
  const catat = has(c, ["financePost", "expenseSubmit"], "any");
  const a: Record<string, AksiTx> = {};
  if (d.modul === "pengeluaran" || d.modul === "pembelian") {
    const base = `/finance/${JALUR_DOK[d.modul]}/${d.id}`;
    a.ajukan = ok(catat && d.status === "DRAFT", d.status !== "DRAFT" ? "Hanya draf yang bisa diajukan." : "Akun Anda tidak boleh mengajukan.", `${base}/submit`);
    a.bayar = ok(post && d.status === "DISETUJUI", d.status !== "DISETUJUI" ? "Hanya dokumen berstatus Disetujui yang bisa dibayar." : "Akun Anda tidak boleh membayar.", `${base}/pay`, { perlu: ["rekening", "tanggal"] });
    a.batalkan = ok(admin && ["DISETUJUI", "DIBAYAR"].includes(d.status), admin ? "Hanya dokumen yang sudah dibukukan yang bisa dibatalkan." : "Pembatalan hanya untuk admin keuangan.", `${base}/cancel`, { perlu: ["alasan"] });
    a.ubah = ok(admin && ["DRAFT", "MENUNGGU_APPROVAL"].includes(d.status), admin ? "Dokumen yang sudah dibukukan hanya bisa dikoreksi di web." : "Mengubah dokumen hanya untuk admin keuangan. Buat dokumen baru bila perlu.", base, { metode: "PATCH", perlu: ["form", "alasan"] });
    a.lampiran = ok(d.status !== "DIBATALKAN" && catat, "Dokumen yang dibatalkan tidak bisa diubah buktinya.", `${base}/bukti`, { perlu: ["foto"] });
    if (d.modul === "pembelian") {
      const alasanTidak =
        d.kategoriKode === "UANG_MUKA_PEMBELIAN" ? "Pembelian ini sendiri berkategori Uang Muka Pembelian — tidak bisa menerima penerapan DP lain"
        : d.mode !== "UTANG" ? "Hanya pembelian mode Utang yang punya Utang Usaha untuk dikurangi DP"
        : d.status !== "DISETUJUI" ? `Status pembelian ini ${d.status} — hanya status Disetujui (belum dibayar) yang bisa menerima penerapan DP`
        : !d.supplierId ? "Pembelian ini belum punya supplier — DP hanya bisa diterapkan antar dokumen supplier yang sama"
        : null;
      a.terapkanDp = ok(post && !alasanTidak, !post ? "Akun Anda tidak boleh menerapkan uang muka." : alasanTidak ?? "", "/finance/purchases/advance-applications", { perlu: ["advancePurchaseId", "nominal"], tetap: { targetPurchaseId: d.id } });
      if (d.mode === "UTANG" && d.status === "DISETUJUI" && d.kategoriKode !== "UANG_MUKA_PEMBELIAN" && bandingMoney(kurangMoney(m(d.nominal), dpDiterapkanUntuk(d.id)), "0.00") <= 0) {
        a.bayar = { ...a.bayar, perlu: a.bayar.perlu.filter((p) => p !== "rekening") };
      }
    }
  } else if (d.modul === "kasbon") {
    const s = sisaDari(d);
    a.potongGaji = ok(post && d.status === "AKTIF" && !!s && s !== NOL && s !== "0.00", "Kasbon ini sudah tidak punya sisa yang bisa dipotong.", `/finance/kasbon/${d.id}/pelunasan`, { perlu: ["nominal", "tanggal"], tetap: { method: "POTONG_GAJI" } });
    a.batalkan = ok(admin && d.status !== "DIBATALKAN" && (d.terbayar ?? "0.00") === "0.00", admin ? "Kasbon ini sudah ada pelunasannya — batalkan pelunasannya di web dulu." : "Pembatalan hanya untuk admin keuangan.", `/finance/kasbon/${d.id}/batal`, { perlu: ["alasan"] });
  } else if (d.modul === "pemasukan") {
    a.batalkan = ok(admin && d.status !== "DIBATALKAN", admin ? "Pemasukan ini sudah dibatalkan." : "Pembatalan hanya untuk admin keuangan.", `/finance/other-income/${d.id}/cancel`, { perlu: ["alasan"] });
  } else if (d.modul === "tagihan") {
    const s = sisaDari(d);
    a.bayar = ok(post && ["DISETUJUI", "DIBAYAR_SEBAGIAN"].includes(d.status) && !!s && s !== "0.00", "Hanya tagihan yang sudah disetujui dan masih punya sisa yang bisa dibayar.", "/finance/supplier-payments", { perlu: ["rekening", "nominal", "tanggal"], tetap: { supplierId: "s1", billId: d.id } });
  } else if (d.modul === "pembayaran-supplier") {
    a.batalkan = ok(admin && d.status !== "DIBATALKAN", admin ? "Pembayaran ini sudah dibatalkan." : "Pembatalan hanya untuk admin keuangan.", `/finance/supplier-payments/${d.id}/cancel`, { perlu: ["alasan"] });
  } else if (d.modul === "supplier") {
    a.ubah = ok(post, "Akun Anda tidak boleh mengubah data supplier.", `/finance/suppliers/${d.id}`, { metode: "PATCH", perlu: ["form"] });
  }
  return a;
}

function keItem(d: Doc): ItemTx {
  const [statusLabel, nada] = STATUS[d.status] ?? [d.status, "neutral" as NadaTx];
  const putus = JENIS_PUTUS[d.modul];
  const menunggu = d.status === "MENUNGGU_APPROVAL";
  const umur = d.jatuhTempo ? Math.floor((Date.now() - Date.parse(d.jatuhTempo)) / HARI) : null;
  return {
    kunci: `${d.modul}:${d.id}`, id: d.id, modul: d.modul, nomor: d.nomor, tanggal: d.tanggal, nominal: m(d.nominal), judul: d.judul, sub: d.sub, pihak: d.pihak, rekening: d.rekening,
    status: d.status, statusLabel, nada, jatuhTempo: d.jatuhTempo ?? null, umurHari: d.modul === "tagihan" && !["DISETUJUI", "DIBAYAR_SEBAGIAN"].includes(d.status) ? null : umur,
    sisa: sisaDari(d),
    terbayar: d.modul === "pembelian" && d.mode === "UTANG" && d.status !== "DIBAYAR" && d.kategoriKode !== "UANG_MUKA_PEMBELIAN" ? dpDiterapkanUntuk(d.id) : d.terbayar ? m(d.terbayar) : null,
    adaLampiran: !!d.lampiran, notaWajib: !!d.notaWajib && !d.lampiran && menunggu,
    jumlahTagihanTerbuka: d.modul === "supplier" ? 1 : null, ember: d.ember ?? null,
    persetujuan: putus && menunggu && has(caps(), "financeApprove") ? { jenis: putus, id: d.id } : null, aksi: aksiUntuk(d),
  };
}

const cocok = (d: Doc, q: string) => {
  const kata = q.trim().toLowerCase().split(/\s+/).filter(Boolean).map((k) => (/^[\d.]+$/.test(k) ? k.replace(/\./g, "") : k));
  const gudang = [d.nomor, d.judul, d.sub, d.pihak ?? "", d.nominal.replace(/\.\d+$/, "")].join(" ").toLowerCase();
  return kata.every((k) => gudang.includes(k));
};

function ringkasan(modul: ModulTx, pilih: Doc[]): RingkasanTx {
  const jumlah = (xs: Doc[]) => { let t = 0n; for (const x of xs) t += BigInt(x.nominal.replace(".", "")); return m(`${t / 100n}.${(t % 100n).toString().padStart(2, "0")}`); };
  const dasar: RingkasanTx = { total: null, totalSemua: null, sisaAktif: null, utangTerbuka: null, lewatTempo: null, umur: null, menungguVerifikasi: null };
  if (modul === "piutang") return { ...dasar, total: jumlah(pilih), totalSemua: jumlah(pilih), umur: { belum_jatuh_tempo: NOL, "1_30": NOL }, menungguVerifikasi: { jumlah: 0, total: NOL } };
  if (modul === "tagihan") return { ...dasar, utangTerbuka: m("600000.00"), lewatTempo: { jumlah: 1, total: m("600000.00") } };
  if (modul === "supplier") return { ...dasar, utangTerbuka: m("600000.00") };
  if (modul === "kasbon") return { ...dasar, sisaAktif: m("600000.00"), total: jumlah(pilih) };
  return { ...dasar, total: pilih.length ? jumlah(pilih) : NOL };
}

export async function mockDaftarTx(f: FilterTx, page: number): Promise<HalamanTx> {
  await simulasiBaca(`tx:${f.modul}`);
  pastikanDb();
  const semua = db.filter((d) => d.modul === f.modul && (!f.q.trim() || cocok(d, f.q)));
  const tabs = TAB_STATUS[f.modul];
  const tab = tabs[f.tab] ? f.tab : Object.keys(tabs)[0] ?? "SEMUA";
  const pilih = semua.filter((d) => tabs[tab]?.(d)).filter((d) => (f.jatuhTempoLewat ? d.jatuhTempo && Date.parse(d.jatuhTempo) < Date.now() : true));
  const hitung = Object.fromEntries(Object.entries(tabs).map(([id, fn]) => [id, semua.filter(fn).length]));
  const awal = (page - 1) * LIMIT_TX;
  const items = pilih.slice(awal, awal + LIMIT_TX).map(keItem);
  return { items, tab, page, total: pilih.length, adaLagi: awal + items.length < pilih.length, hitung, ringkasan: ringkasan(f.modul, pilih), diperbaruiPada: new Date().toISOString() };
}

function riwayatDpUntuk(d: Doc): RiwayatDp[] {
  const admin = has(caps(), "financeAdmin");
  const baris = (app: DpApp, sisi: "sumber" | "tujuan"): RiwayatDp => {
    const lawan = db.find((x) => x.id === (sisi === "sumber" ? app.targetId : app.advanceId));
    const bolehBatal = sisi === "tujuan" && admin && app.status === "ACTIVE" && d.status !== "DIBAYAR";
    return {
      id: app.id, sisi, nominal: m(app.amount), status: app.status, statusLabel: app.status === "REVERSED" ? "Dibatalkan" : "Aktif",
      tanggal: app.createdAt, dibuatOleh: { id: "u", name: app.createdBy }, jurnal: app.journal, jurnalPembalik: app.reversalJournal,
      dibatalkanPada: app.reversedAt, dibatalkanOleh: app.reversedBy ? { id: "u", name: app.reversedBy } : null, alasanBatal: app.reverseReason,
      pasangan: lawan ? { id: lawan.id, nomor: lawan.nomor } : null,
      aksiBatalkan: sisi !== "tujuan" ? null : ok(
        bolehBatal,
        !admin ? "Pembatalan penerapan DP hanya untuk admin keuangan." : app.status !== "ACTIVE" ? "Penerapan ini sudah dibatalkan sebelumnya." : "Pembelian ini sudah lunas — batalkan/koreksi pelunasannya dulu sebelum membatalkan penerapan DP ini.",
        `/finance/purchases/advance-applications/${app.id}/cancel`, { perlu: ["alasan"] }
      ),
    };
  };
  return [
    ...dpApps.filter((a) => a.advanceId === d.id).map((a) => baris(a, "sumber")),
    ...dpApps.filter((a) => a.targetId === d.id).map((a) => baris(a, "tujuan")),
  ];
}

export async function mockDpEligible(id: string): Promise<DpEligible> {
  await simulasiBaca(`tx:dp-eligible:${id}`);
  pastikanDb();
  const target = db.find((x) => x.modul === "pembelian" && x.id === id);
  if (!target) throw new ApiError({ status: 404, code: "NOT_FOUND", message: "Pembelian tidak ditemukan" });
  const alasan: string[] = [];
  if (target.kategoriKode === "UANG_MUKA_PEMBELIAN") alasan.push("Pembelian ini sendiri berkategori Uang Muka Pembelian — tidak bisa menerima penerapan DP lain");
  if (target.mode !== "UTANG") alasan.push("Hanya pembelian mode Utang yang punya Utang Usaha untuk dikurangi DP");
  if (target.status !== "DISETUJUI") alasan.push(`Status pembelian ini ${target.status} — hanya status Disetujui (belum dibayar) yang bisa menerima penerapan DP`);
  if (!target.supplierId) alasan.push("Pembelian ini belum punya supplier — DP hanya bisa diterapkan antar dokumen supplier yang sama");
  if (alasan.length > 0) return { eligible: [], bisaMenerapkan: false, alasan };
  const kandidat = db.filter((x) => x.modul === "pembelian" && x.kategoriKode === "UANG_MUKA_PEMBELIAN" && x.status === "DIBAYAR" && x.supplierId === target.supplierId);
  const eligible = kandidat
    .map((k) => ({ id: k.id, purchaseNumber: k.nomor, date: k.tanggal, nilaiAwal: m(k.nominal), sudahDigunakan: dpDipakaiDari(k.id), saldoTersedia: kurangMoney(m(k.nominal), dpDipakaiDari(k.id)) }))
    .filter((k) => bandingMoney(k.saldoTersedia, "0.00") > 0);
  return { eligible, bisaMenerapkan: true, sisaUtang: kurangMoney(m(target.nominal), dpDiterapkanUntuk(target.id)), totalPembelian: m(target.nominal) };
}

export async function mockDetailTx(modul: ModulTx, id: string): Promise<DetailTx> {
  await simulasiBaca(`tx:${modul}:${id}`);
  pastikanDb();
  const d = db.find((x) => x.modul === modul && x.id === id);
  if (!d) throw new ApiError({ status: 404, code: "NOT_FOUND", message: "Data tidak ditemukan" });
  const item = keItem(d);
  const bagianDp: { judul: string; baris: { label: string; nilai: string; jenis?: "teks" | "uang" | "tanggal" | "waktu" }[] }[] =
    d.modul === "pembelian"
      ? [d.kategoriKode === "UANG_MUKA_PEMBELIAN"
          ? { judul: "Sebagai Uang Muka", baris: [R("Nilai awal", d.nominal, "uang"), R("Sudah digunakan", dpDipakaiDari(d.id), "uang"), R("Saldo tersedia", kurangMoney(m(d.nominal), dpDipakaiDari(d.id)), "uang")] }
          : { judul: "Uang Muka", baris: [R("Total pembelian", d.nominal, "uang"), R("DP diterapkan", dpDiterapkanUntuk(d.id), "uang"), R("Sisa pembayaran", kurangMoney(m(d.nominal), dpDiterapkanUntuk(d.id)), "uang")] }]
      : [];
  const bagian = d.bagian ?? [
    { judul: "Dokumen", baris: [R("Nomor", d.nomor), R("Tanggal", d.tanggal, "tanggal"), R("Status", item.statusLabel)] },
    { judul: "Dana", baris: [R("Nominal", d.nominal, "uang"), ...(d.rekening ? [R("Rekening", d.rekening)] : []), ...(d.pihak ? [R("Pihak", d.pihak)] : [])] },
    ...(item.sisa ? [{ judul: "Sisa", baris: [R("Sisa", item.sisa, "uang")] }] : []),
    ...bagianDp,
  ];
  return {
    ...item, bagian: bagian.map((b) => ({ judul: b.judul, baris: b.baris.map((r) => ({ label: r.label, nilai: r.nilai, jenis: r.jenis ?? "teks", tautan: (r as { tautan?: { modul: ModulTx; id: string } }).tautan ?? null })) })),
    lampiran: [], riwayat: d.riwayat, catatan: d.catatan ?? null, syarat: item.notaWajib ? "Nota wajib sebelum disetujui." : null,
    pembayaran: (d.pembayaran ?? []).map((p) => ({
      id: p.id, nominal: m(p.nominal), metode: "TRANSFER", tanggal: tanggalLalu(10), status: p.status, statusLabel: p.status === "TERVERIFIKASI" ? "Terverifikasi" : "Menunggu verifikasi", asalOrderId: p.asalOrderId,
      alokasi: p.alokasi.map((a) => ({ orderId: a.orderId, nomor: a.nomor, nominal: m(a.nominal) })),
      aksiAlokasi: ok(has(caps(), "financePost"), "Akun Anda tidak boleh mengatur alokasi pembayaran.", `/finance/customer-payments/${p.id}/allocations`, { perlu: ["alokasi"] }),
    })),
    orderPelanggan: d.modul === "piutang" ? [{ id: "o1", nomor: "SAN-0001" }, { id: "o2", nomor: "SAN-0002" }] : [], supplier: null,
    ...(d.modul === "pembelian" ? { riwayatDp: riwayatDpUntuk(d) } : {}),
  };
}

export async function mockRingkasanModul(): Promise<RingkasanModul> {
  await simulasiBaca("tx:ringkasan");
  pastikanDb();
  const n = (mm: ModulTx, st: string) => db.filter((d) => d.modul === mm && d.status === st).length;
  return { pengeluaran: { menunggu: n("pengeluaran", "MENUNGGU_APPROVAL") }, pembelian: { menunggu: n("pembelian", "MENUNGGU_APPROVAL") }, kasbon: { aktif: n("kasbon", "AKTIF") }, refund: { menunggu: n("refund", "MENUNGGU_APPROVAL") }, tagihan: { menunggu: n("tagihan", "MENUNGGU_APPROVAL"), terbuka: n("tagihan", "DIBAYAR_SEBAGIAN") } };
}

export async function mockOpsiForm(): Promise<OpsiForm> {
  await simulasiBaca("tx:opsi");
  const negatif = getSkenario() === "negatif";
  return {
    kategoriPengeluaran: [{ id: "kp1", code: "SERVIS_KENDARAAN", name: "Servis Kendaraan" }, { id: "kp2", code: "BBM", name: "BBM" }, { id: "kp3", code: "OPERASIONAL", name: "Operasional" }],
    kategoriPembelian: [{ id: "kb1", code: "BAHAN_BAKU_MANUAL", name: "Bahan Baku" }, { id: "kb2", code: "ASET_PERALATAN", name: "Aset Peralatan" }],
    rekening: [{ id: "r1", name: "KEM - Sano Bank", kind: "BANK", saldo: negatif ? m("-175967591.00") : m("6716507.00") }, { id: "r2", name: "PT Sano", kind: "BANK", saldo: m("29870615.00") }, { id: "r3", name: "Uang Kas Sano", kind: "KAS", saldo: m("104500.00") }],
    supplier: [{ id: "s1", code: "SUP-001", name: "CV Busa Jaya", paymentTermDays: 14 }],
    akunPemasukanLain: [{ id: "a1", code: "4-9000", name: "Pendapatan Lain-lain" }],
    karyawan: [{ id: "u1", name: "Agung" }, { id: "u2", name: "Imam" }, { id: "u3", name: "Kiki" }],
    mode: [{ id: "LANGSUNG", label: "Bayar langsung" }, { id: "REIMBURSEMENT", label: "Reimbursement" }, { id: "UTANG", label: "Utang" }],
    hanyaReimbursement: !has(caps(), "financePost"), ambangNotaRupiah: m("500000.00"),
  };
}

export async function mockCariOrderRefund(q: string): Promise<OrderRefund[]> {
  await simulasiBaca("tx:order");
  if (q.trim().length < 2) return [];
  return [{ id: "o1", nomor: "SAN-0001", pelanggan: "Ibu Sari", nilai: m("2000000.00"), sisaBisaDirefund: m("500000.00") }].filter((o) => `${o.nomor} ${o.pelanggan}`.toLowerCase().includes(q.trim().toLowerCase()));
}

export async function mockUnggahFoto(foto: { uri: string; nama: string }): Promise<HasilUnggah> {
  await tunda(700);
  if (getSkenario() === "offline") throw new ApiError({ status: 0, code: "NETWORK", message: "Tidak bisa terhubung ke server. Periksa koneksi internet Anda." });
  return { url: `/media/finance-receipts/${foto.nama.replace(/\W/g, "") || "nota"}.jpg`, dipakaiDi: [] };
}

function galat(kode: string, status: number, pesan: string, tidakPasti = false) { return new ApiError({ status, code: kode, message: pesan, tidakPasti }); }

/** Meniru perintah dokumen (buat, ajukan, bayar, batalkan, ubah, lampiran, potong gaji, alokasi) — termasuk 409, 403, 400, dan hasil tidak pasti. */
export async function mockKirimTx(path: string, metode: string, body: unknown): Promise<unknown> {
  await tunda(450);
  pastikanDb();
  const skenario = getSkenario();
  if (skenario === "izin") throw galat("FORBIDDEN", 403, "Anda tidak punya izin untuk tindakan ini");
  if (skenario === "offline" || skenario === "putus") throw galat("NETWORK", 0, "Status belum pasti — koneksi terputus setelah perintah terkirim.", true);
  if (skenario === "galat") throw galat("INTERNAL", 500, "boom");
  const b = (body ?? {}) as Record<string, unknown>;
  const waktu = new Date().toISOString();
  const oleh = orangSaya();

  const buat = /^\/finance\/(expenses|purchases|kasbon|other-income|refunds|bills|suppliers)$/.exec(path);
  if (buat && metode === "POST") {
    const peta: Record<string, ModulTx> = { expenses: "pengeluaran", purchases: "pembelian", kasbon: "kasbon", "other-income": "pemasukan", refunds: "refund", bills: "tagihan", suppliers: "supplier" };
    const modul = peta[buat[1] as string] as ModulTx;
    const nominal = typeof b.amount === "string" ? b.amount : "0.00";
    if (modul !== "supplier" && (!/^\d+(\.\d+)?$/.test(nominal) || /^0+(\.0+)?$/.test(nominal))) throw galat("VALIDASI", 400, "Nominal harus lebih dari 0");
    if ((modul === "pengeluaran" || modul === "pembelian") && !b.description) throw galat("VALIDASI", 400, "Keterangan wajib diisi");
    if (modul === "kasbon" && String(b.employeeName ?? "").toLowerCase().includes("owner")) throw galat("VALIDASI", 400, "Kasbon tidak bisa diberikan ke OWNER (Admin): akun bersama owner, bukan karyawan.");
    urut += 1;
    const draf = b.langsungAjukan === false;
    const status = modul === "pengeluaran" || modul === "pembelian" ? (draf ? "DRAFT" : "MENUNGGU_APPROVAL") : modul === "refund" || modul === "tagihan" ? "MENUNGGU_APPROVAL" : modul === "supplier" ? "AKTIF" : modul === "kasbon" ? "AKTIF" : "AKTIF";
    const id = `baru${urut}`;
    db.unshift({
      modul, id, nomor: `${modul.slice(0, 3).toUpperCase()}-${urut}`, tanggal: hariWIB(new Date()), nominal: modul === "supplier" ? "0.00" : nominal,
      judul: String(b.description ?? b.employeeName ?? b.name ?? b.reason ?? "Dokumen baru"), sub: "Baru", pihak: null, rekening: null, status, lampiran: !!(b.receiptUrl ?? b.attachmentUrl),
      riwayat: [{ waktu, peristiwa: "DIAJUKAN", label: modul === "kasbon" || modul === "pemasukan" ? "Dibukukan" : "Diajukan", oleh, catatan: null }],
      ...(modul === "kasbon" ? { terbayar: "0.00" } : {}), ...(modul === "tagihan" ? { terbayar: "0.00", jatuhTempo: typeof b.dueDate === "string" ? b.dueDate : null } : {}),
    });
    return { id };
  }

  const dok = /^\/finance\/(expenses|purchases)\/([^/]+)\/(submit|pay|cancel|bukti)$/.exec(path)
    ?? /^\/finance\/(kasbon)\/([^/]+)\/(pelunasan|batal)$/.exec(path)
    ?? /^\/finance\/(other-income)\/([^/]+)\/(cancel)$/.exec(path)
    ?? /^\/finance\/(supplier-payments)\/([^/]+)\/(cancel)$/.exec(path);
  if (dok) {
    const [, jalur, id, aksi] = dok;
    const d = db.find((x) => x.id === id);
    if (!d) throw galat("NOT_FOUND", 404, "Data tidak ditemukan");
    if (skenario === "konflik" && (aksi === "submit" || aksi === "pay" || aksi === "cancel")) { d.status = aksi === "submit" ? "MENUNGGU_APPROVAL" : d.status; throw galat("KONFLIK", 409, `Dokumen ini sudah diproses oleh Finance Lain.`); }
    const sudah = (kondisi: boolean, pesan: string) => { if (kondisi) throw galat("KONFLIK", 409, pesan); };
    const alasan = String(b.reason ?? "").trim();
    if (aksi === "submit") { sudah(d.status !== "DRAFT", "Hanya draf yang bisa diajukan"); d.status = "MENUNGGU_APPROVAL"; d.riwayat.push({ waktu, peristiwa: "DIAJUKAN", label: "Diajukan", oleh, catatan: null }); }
    else if (aksi === "pay") {
      sudah(d.status !== "DISETUJUI", "Hanya dokumen berstatus Disetujui yang bisa dibayar");
      if (!b.cashAccountId) throw galat("VALIDASI", 400, "Rekening sumber pembayaran wajib dipilih");
      d.status = "DIBAYAR"; d.riwayat.push({ waktu, peristiwa: "DIBAYAR", label: "Dibayar", oleh, catatan: null });
    } else if (aksi === "bukti") { d.lampiran = !!b.receiptUrl; }
    else if (aksi === "pelunasan") {
      const nominal = String(b.amount ?? "");
      if (!/^\d+(\.\d+)?$/.test(nominal)) throw galat("VALIDASI", 400, "Nominal pelunasan harus lebih dari 0");
      const s = sisaDari(d);
      const x = BigInt(nominal.replace(".", "").padEnd(nominal.includes(".") ? 0 : nominal.length + 2, "0"));
      void x;
      if (s && BigInt(nominal.split(".")[0] ?? "0") > BigInt(s.split(".")[0] ?? "0")) throw galat("VALIDASI", 400, "Nominal melebihi kasbon yang belum dipotong");
      d.terbayar = m(nominal); if (s && d.terbayar === d.nominal) d.status = "LUNAS";
      d.riwayat.push({ waktu, peristiwa: "DOCUMENT_POSTED", label: "Dipotong dari gaji", oleh, catatan: null });
    } else {
      if (!alasan) throw galat("VALIDASI", 400, "Alasan pembatalan wajib diisi");
      sudah(d.status === "DIBATALKAN", "Sudah dibatalkan");
      d.status = "DIBATALKAN"; d.riwayat.push({ waktu, peristiwa: "DOCUMENT_CANCELLED", label: "Dibatalkan", oleh, catatan: alasan });
    }
    void jalur;
    return { ok: true };
  }

  if (path === "/finance/purchases/advance-applications" && metode === "POST") {
    const advanceId = String(b.advancePurchaseId ?? "");
    const targetId = String(b.targetPurchaseId ?? "");
    const nominal = String(b.amount ?? "");
    const advance = db.find((x) => x.id === advanceId);
    const target = db.find((x) => x.id === targetId);
    if (!advance) throw galat("NOT_FOUND", 404, "Pembelian sumber (uang muka) tidak ditemukan");
    if (!target) throw galat("NOT_FOUND", 404, "Pembelian tujuan tidak ditemukan");
    if (!/^\d+(\.\d+)?$/.test(nominal) || bandingMoney(m(nominal), "0.00") <= 0) throw galat("VALIDASI", 400, "Nominal penerapan harus lebih dari 0");
    const tersedia = kurangMoney(m(advance.nominal), dpDipakaiDari(advanceId));
    if (bandingMoney(m(nominal), tersedia) > 0) throw galat("VALIDASI", 400, `Nominal (${nominal}) melebihi saldo uang muka tersedia (${tersedia})`);
    const sisaUtang = kurangMoney(m(target.nominal), dpDiterapkanUntuk(targetId));
    if (bandingMoney(m(nominal), sisaUtang) > 0) throw galat("VALIDASI", 400, `Nominal (${nominal}) melebihi sisa utang pembelian tujuan (${sisaUtang})`);
    urut += 1;
    const appId = `dp${urut}`;
    dpApps.push({ id: appId, advanceId, targetId, amount: m(nominal), status: "ACTIVE", journal: `JV-${urut}`, reversalJournal: null, createdAt: waktu, createdBy: oleh, reversedAt: null, reversedBy: null, reverseReason: null });
    return { id: appId };
  }

  const batalDp = /^\/finance\/purchases\/advance-applications\/([^/]+)\/cancel$/.exec(path);
  if (batalDp) {
    const app = dpApps.find((a) => a.id === batalDp[1]);
    if (!app) throw galat("NOT_FOUND", 404, "Penerapan uang muka tidak ditemukan");
    if (app.status === "REVERSED") throw galat("KONFLIK", 409, "Penerapan ini sudah dibatalkan sebelumnya");
    const target = db.find((x) => x.id === app.targetId);
    if (target?.status === "DIBAYAR") throw galat("KONFLIK", 409, `${target.nomor} sudah lunas — batalkan/koreksi pelunasannya dulu sebelum membatalkan penerapan DP ini`);
    const alasan = String(b.reason ?? "").trim();
    if (!alasan) throw galat("VALIDASI", 400, "Alasan pembatalan wajib diisi");
    app.status = "REVERSED"; app.reversalJournal = `JV-${++urut}`; app.reversedAt = waktu; app.reversedBy = oleh; app.reverseReason = alasan;
    return { ok: true };
  }

  if (path === "/finance/supplier-payments" && metode === "POST") {
    const alo = (b.allocations as { billId: string; amount: string }[] | undefined)?.[0];
    const t = db.find((x) => x.id === alo?.billId);
    if (!t || !alo) throw galat("NOT_FOUND", 404, "Tagihan tidak ditemukan");
    if (!b.cashAccountId) throw galat("VALIDASI", 400, "Rekening sumber pembayaran wajib dipilih");
    const s = sisaDari(t);
    if (!/^\d+(\.\d+)?$/.test(alo.amount) || (s && BigInt(alo.amount.split(".")[0] ?? "0") > BigInt(s.split(".")[0] ?? "0"))) throw galat("VALIDASI", 400, `Pembayaran untuk tagihan ${t.nomor} melebihi sisa utangnya (${s ?? "0.00"})`);
    const baru = m(alo.amount);
    const total = BigInt((t.terbayar ?? "0.00").replace(".", "")) + BigInt(baru.replace(".", ""));
    t.terbayar = `${total / 100n}.${(total % 100n).toString().padStart(2, "0")}`;
    t.status = t.terbayar === t.nominal ? "LUNAS" : "DIBAYAR_SEBAGIAN";
    urut += 1;
    db.unshift({ modul: "pembayaran-supplier", id: `bs${urut}`, nomor: `PAYOUT-${urut}`, tanggal: hariWIB(new Date()), nominal: baru, judul: t.judul, sub: t.nomor, pihak: t.pihak, rekening: "KEM - Sano Bank", status: "AKTIF", riwayat: [] });
    return { ok: true };
  }

  if (/^\/finance\/suppliers\/[^/]+$/.test(path) && metode === "PATCH") {
    const d = db.find((x) => path.endsWith(x.id));
    if (!d) throw galat("NOT_FOUND", 404, "Data tidak ditemukan");
    if (typeof b.name === "string" && b.name.trim()) d.judul = b.name.trim();
    if (typeof b.active === "boolean") d.status = b.active ? "AKTIF" : "NONAKTIF";
    return { ok: true };
  }

  if (/^\/finance\/(expenses|purchases)\/[^/]+$/.test(path) && metode === "PATCH") {
    const d = db.find((x) => path.endsWith(x.id));
    if (!d) throw galat("NOT_FOUND", 404, "Data tidak ditemukan");
    if (!String(b.reason ?? "").trim()) throw galat("VALIDASI", 400, "Alasan perubahan wajib diisi");
    if (typeof b.description === "string") d.judul = b.description;
    if (typeof b.amount === "string") d.nominal = b.amount;
    return { ok: true };
  }

  const alokasi = /^\/finance\/customer-payments\/([^/]+)\/allocations$/.exec(path);
  if (alokasi) {
    const daftar = (b.allocations as { orderId: string; amount: string }[] | undefined) ?? [];
    const jumlah = daftar.reduce((s, a) => s + BigInt(a.amount.replace(".", "")), 0n);
    const dok2 = db.find((x) => x.pembayaran?.some((p) => p.id === alokasi[1]));
    const pay = dok2?.pembayaran?.find((p) => p.id === alokasi[1]);
    if (!pay || jumlah !== BigInt(pay.nominal.replace(".", ""))) throw galat("VALIDASI", 400, "Total alokasi tidak sama dengan nominal pembayaran. Seluruh nominal pembayaran wajib teralokasi.");
    pay.alokasi = daftar.map((a) => ({ orderId: a.orderId, nomor: a.orderId === "o1" ? "SAN-0001" : "SAN-0002", nominal: a.amount }));
    return { ok: true };
  }
  throw galat("NOT_FOUND", 404, "Alamat tidak dikenal");
}
