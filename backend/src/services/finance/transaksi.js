// READ-MODEL TRANSAKSI FINANCE MOBILE (S6 Pengeluaran/Pembelian/Kasbon/Pemasukan Lain, S7 Piutang/Refund, S8 Supplier/Tagihan/Pembayaran supplier).
//
// TIDAK punya tabel, ledger, status, atau command sendiri. Semua dibaca dari dokumen yang sudah ada dan dinormalkan menjadi satu bentuk:
//   item   { kunci, id, modul, nomor, tanggal, nominal, judul, sub, pihak, rekening, status, statusLabel, nada, jatuhTempo, umurHari, sisa, terbayar,
//            adaLampiran, notaWajib, aksi }
//   detail item + { bagian:[{judul, baris:[{label, nilai, jenis, tautan?}]}], lampiran, riwayat, ... }
// Uang selalu string desimal ("1500000.00"). `aksi` (boleh/tidak + alasan + path + apa yang perlu diisi) dihitung SERVER dari izin & status dokumen,
// sehingga klien tidak menyalin aturan. Perintah tetap ke endpoint milik tiap dokumen (routes/financeTransactions.js, financeKasbon.js) — satu-satunya
// sumber aturan bisnis, jurnal, dan approval.

import { hasPermission } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";
import { ENTITY_TYPES } from "../../lib/activityLog.js";
import { toMoney, sumMoney, ZERO } from "./money.js";
import { todayBookDateWIB } from "./journal.js";
import { ambangNota, notaWajibDenganAmbang } from "./receipts.js";
import { umurPiutang, saldoKasBank } from "./reports.js";
import { bangunLampiran, bangunRiwayat } from "./approvals.js";
import { daftarKaryawanKasbon } from "./karyawan.js";
import { getVerificationGate } from "./settings.js";
import { paidForOrder } from "./allocation.js";

export const MODUL_LIST = ["pengeluaran", "pembelian", "kasbon", "pemasukan", "piutang", "refund", "supplier", "tagihan", "pembayaran-supplier"];

export class TransaksiError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "TransaksiError";
    this.statusCode = statusCode;
  }
}

const uang = (v) => toMoney(v ?? 0).toFixed(2);
const tgl = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const waktu = (d) => (d ? new Date(d).toISOString() : null);
const orang = (u) => (u ? { id: u.id, name: u.name } : null);
const boleh = (user, izin) => hasPermission(user, izin);
const bisaMencatat = (user) => boleh(user, P.FINANCE_POST) || boleh(user, P.FINANCE_EXPENSE_SUBMIT);

const LABEL_STATUS = {
  DRAFT: ["Draf", "neutral"], MENUNGGU_APPROVAL: ["Menunggu persetujuan", "warning"], DISETUJUI: ["Disetujui", "info"], DIBAYAR: ["Dibayar", "success"],
  DIBAYAR_SEBAGIAN: ["Dibayar sebagian", "info"], LUNAS: ["Lunas", "success"], DITOLAK: ["Ditolak", "danger"], DIBATALKAN: ["Dibatalkan", "neutral"],
  AKTIF: ["Aktif", "info"], NONAKTIF: ["Nonaktif", "neutral"], LEWAT_TEMPO: ["Lewat tempo", "danger"], BERJALAN: ["Belum jatuh tempo", "info"],
};
const statusInfo = (s) => ({ status: s, statusLabel: LABEL_STATUS[s]?.[0] ?? s, nada: LABEL_STATUS[s]?.[1] ?? "neutral" });

const LABEL_MODE = { LANGSUNG: "Bayar langsung", REIMBURSEMENT: "Reimbursement", UTANG: "Utang" };

const orangSel = { select: { id: true, name: true } };
const INC_DOK = {
  category: { select: { id: true, code: true, name: true, account: { select: { code: true, name: true } } } },
  cashAccount: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } }, reimburseTo: orangSel,
  createdBy: orangSel, approvedBy: orangSel, paidBy: orangSel,
};

// ── Konfigurasi per modul ───────────────────────────────────────────────────────────────────────────────────────
const STATUS_DOK_TABS = [
  { id: "SEMUA", label: "Semua", where: {} },
  { id: "DRAF", label: "Draf", where: { status: "DRAFT" } },
  { id: "MENUNGGU", label: "Menunggu", where: { status: "MENUNGGU_APPROVAL" } },
  { id: "DIPROSES", label: "Disetujui", where: { status: "DISETUJUI" } },
  { id: "SELESAI", label: "Dibayar", where: { status: "DIBAYAR" } },
  { id: "DITOLAK", label: "Ditolak/batal", where: { status: { in: ["DITOLAK", "DIBATALKAN"] } } },
];

const CFG = {
  pengeluaran: {
    label: "Pengeluaran", model: "finExpense", tanggal: "date", nomor: "expenseNumber", entity: ENTITY_TYPES.FIN_EXPENSE, include: { ...INC_DOK, order: { select: { orderNumber: true } } },
    tabs: STATUS_DOK_TABS, cari: ["expenseNumber", "description", "payeeName", "notes", "category.name", "supplier.name", "reimburseTo.name"], urut: [{ date: "desc" }, { createdAt: "desc" }],
  },
  pembelian: {
    label: "Pembelian", model: "finPurchase", tanggal: "date", nomor: "purchaseNumber", entity: ENTITY_TYPES.FIN_PURCHASE, include: INC_DOK,
    tabs: STATUS_DOK_TABS, cari: ["purchaseNumber", "description", "payeeName", "notes", "category.name", "supplier.name", "reimburseTo.name"], urut: [{ date: "desc" }, { createdAt: "desc" }],
  },
  kasbon: {
    label: "Kasbon", model: "finKasbon", tanggal: "date", nomor: "kasbonNumber", entity: ENTITY_TYPES.FIN_KASBON,
    include: { cashAccount: { select: { id: true, name: true } }, createdBy: orangSel, repayments: { orderBy: [{ date: "asc" }, { createdAt: "asc" }], include: { createdBy: orangSel } } },
    tabs: [
      { id: "AKTIF", label: "Aktif", where: { status: "AKTIF" } }, { id: "LUNAS", label: "Lunas", where: { status: "LUNAS" } },
      { id: "DIBATALKAN", label: "Dibatalkan", where: { status: "DIBATALKAN" } }, { id: "SEMUA", label: "Semua", where: {} },
    ],
    cari: ["kasbonNumber", "employeeName", "urgency", "notes"], urut: [{ date: "desc" }, { createdAt: "desc" }],
  },
  pemasukan: {
    label: "Pemasukan Lain", model: "finOtherIncome", tanggal: "date", nomor: "incomeNumber", entity: ENTITY_TYPES.FIN_OTHER_INCOME,
    include: { cashAccount: { select: { id: true, name: true } }, createdBy: orangSel },
    tabs: [
      { id: "AKTIF", label: "Aktif", where: { cancelledAt: null } }, { id: "DIBATALKAN", label: "Dibatalkan", where: { cancelledAt: { not: null } } }, { id: "SEMUA", label: "Semua", where: {} },
    ],
    cari: ["incomeNumber", "description", "notes"], urut: [{ date: "desc" }, { createdAt: "desc" }],
  },
  refund: {
    label: "Refund", model: "finRefund", tanggal: "date", nomor: "refundNumber", entity: ENTITY_TYPES.FIN_REFUND,
    include: { cashAccount: { select: { id: true, name: true } }, order: { select: { id: true, orderNumber: true, value: true, customer: { select: { id: true, name: true } } } }, createdBy: orangSel, approvedBy: orangSel },
    tabs: [
      { id: "MENUNGGU", label: "Menunggu", where: { status: "MENUNGGU_APPROVAL" } }, { id: "DISETUJUI", label: "Disetujui", where: { status: "DISETUJUI" } },
      { id: "DITOLAK", label: "Ditolak", where: { status: "DITOLAK" } }, { id: "SEMUA", label: "Semua", where: {} },
    ],
    cari: ["refundNumber", "reason", "order.orderNumber", "order.customer.name"], urut: [{ createdAt: "desc" }],
  },
  supplier: {
    label: "Supplier", model: "finSupplier", tanggal: "createdAt", nomor: "code", entity: null, include: {},
    tabs: [{ id: "AKTIF", label: "Aktif", where: { active: true } }, { id: "NONAKTIF", label: "Nonaktif", where: { active: false } }, { id: "SEMUA", label: "Semua", where: {} }],
    cari: ["code", "name", "phone", "email", "bankName"], urut: [{ name: "asc" }],
  },
  tagihan: {
    label: "Tagihan supplier", model: "finSupplierBill", tanggal: "billDate", nomor: "billNumber", entity: ENTITY_TYPES.FIN_SUPPLIER_BILL,
    include: {
      supplier: { select: { id: true, code: true, name: true, paymentTermDays: true } }, createdBy: orangSel, approvedBy: orangSel,
      goodsReceipt: { select: { receiptNumber: true } },
      allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true, payment: { select: { id: true, paymentNumber: true, date: true } } } },
    },
    tabs: [
      { id: "MENUNGGU", label: "Menunggu", where: { status: { in: ["DRAFT", "MENUNGGU_APPROVAL"] } } },
      { id: "TERBUKA", label: "Belum lunas", where: { status: { in: ["DISETUJUI", "DIBAYAR_SEBAGIAN"] } } },
      { id: "LUNAS", label: "Lunas", where: { status: "LUNAS" } }, { id: "DITOLAK", label: "Ditolak", where: { status: "DITOLAK" } }, { id: "SEMUA", label: "Semua", where: {} },
    ],
    cari: ["billNumber", "supplierRef", "description", "supplier.name"], urut: [{ billDate: "desc" }, { createdAt: "desc" }],
  },
  "pembayaran-supplier": {
    label: "Pembayaran supplier", model: "finSupplierPayment", tanggal: "date", nomor: "paymentNumber", entity: null,
    include: {
      supplier: { select: { id: true, name: true } }, cashAccount: { select: { id: true, name: true } }, createdBy: orangSel,
      allocations: { include: { bill: { select: { id: true, billNumber: true } } } },
    },
    tabs: [{ id: "AKTIF", label: "Aktif", where: { cancelledAt: null } }, { id: "DIBATALKAN", label: "Dibatalkan", where: { cancelledAt: { not: null } } }, { id: "SEMUA", label: "Semua", where: {} }],
    cari: ["paymentNumber", "reference", "notes", "supplier.name"], urut: [{ date: "desc" }, { createdAt: "desc" }],
  },
  piutang: {
    label: "Piutang", model: null, tabs: [
      { id: "SEMUA", label: "Semua" }, { id: "LEWAT", label: "Lewat tempo" }, { id: "BERJALAN", label: "Belum jatuh tempo" },
    ],
  },
};

export const infoModul = (m) => (CFG[m] ? { kunci: m, label: CFG[m].label, tabs: CFG[m].tabs.map((t) => ({ id: t.id, label: t.label })) } : null);

// ── Pencarian & rentang ─────────────────────────────────────────────────────────────────────────────────────────
function klausaCari(q, kolom, { angka = true } = {}) {
  const kata = String(q || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return kata.map((k) => {
    const atau = kolom.map((path) => {
      const bagian = path.split(".");
      return bagian.reduceRight((isi, kunci, i) => (i === bagian.length - 1 ? { [kunci]: { contains: k, mode: "insensitive" } } : { [kunci]: isi }), null);
    });
    const n = k.replace(/\./g, "");
    if (angka && /^\d{3,12}$/.test(n)) atau.push({ amount: Number(n) });
    return { OR: atau };
  });
}

const tanggalKolom = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? new Date(`${v}T00:00:00.000Z`) : null);

function whereDasar(cfg, { from, to, q, supplierId }) {
  const dari = tanggalKolom(from);
  const sampai = tanggalKolom(to);
  return {
    ...(dari && sampai && { [cfg.tanggal]: { gte: dari, lte: sampai } }),
    ...(supplierId && (cfg.model === "finSupplierBill" || cfg.model === "finSupplierPayment") && { supplierId }),
    ...(q && String(q).trim() ? { AND: klausaCari(q, cfg.cari, { angka: cfg.model !== "finSupplier" }) } : {}),
  };
}

const umurDari = (acuan) => {
  const a = todayBookDateWIB().getTime();
  return Math.floor((a - new Date(acuan).getTime()) / 86400000);
};

// ── Normalisasi per modul ───────────────────────────────────────────────────────────────────────────────────────
const DOK_PATH = { pengeluaran: "expenses", pembelian: "purchases" };
const JENIS_APPROVAL = { pengeluaran: "expense", pembelian: "purchase", tagihan: "bill", refund: "refund" };
const MODEL_APPROVAL_LOCK = { pengeluaran: "fin_expenses", pembelian: "fin_purchases" };

const aksi = (ok, alasan, path, extra = {}) => ({ boleh: ok, alasan: ok ? null : alasan, path: path ?? "", metode: extra.metode ?? "POST", perlu: extra.perlu ?? [], ...(extra.tetap && { tetap: extra.tetap }) });

function aksiDokumen(modul, d, user, notaWajib) {
  const base = `/finance/${DOK_PATH[modul]}/${d.id}`;
  const post = boleh(user, P.FINANCE_POST);
  const admin = boleh(user, P.FINANCE_ADMIN);
  const catat = bisaMencatat(user);
  const punyaNota = !!d.receiptUrl;
  return {
    ajukan: aksi(catat && d.status === "DRAFT", d.status !== "DRAFT" ? "Hanya draf yang bisa diajukan." : "Akun Anda tidak boleh mengajukan.", `${base}/submit`),
    bayar: aksi(post && d.status === "DISETUJUI", d.status !== "DISETUJUI" ? "Hanya dokumen berstatus Disetujui yang bisa dibayar." : "Akun Anda tidak boleh membayar.", `${base}/pay`, { perlu: ["rekening", "tanggal"] }),
    batalkan: aksi(admin && ["DISETUJUI", "DIBAYAR"].includes(d.status), !admin ? "Pembatalan hanya untuk admin keuangan." : "Hanya dokumen yang sudah dibukukan yang bisa dibatalkan.", `${base}/cancel`, { perlu: ["alasan"] }),
    ubah: aksi(admin && ["DRAFT", "MENUNGGU_APPROVAL"].includes(d.status), !admin ? "Mengubah dokumen hanya untuk admin keuangan. Buat dokumen baru bila perlu." : "Dokumen yang sudah dibukukan hanya bisa dikoreksi di web.", base, { metode: "PATCH", perlu: ["form", "alasan"] }),
    lampiran: aksi(d.status !== "DIBATALKAN" && catat && (post || d.createdById === user.id), d.status === "DIBATALKAN" ? "Dokumen yang dibatalkan tidak bisa diubah buktinya." : "Anda hanya bisa mengubah bukti pengajuan Anda sendiri.", `${base}/bukti`, { perlu: ["foto"] }),
    ...(notaWajib && !punyaNota && d.status === "MENUNGGU_APPROVAL" && { _catatan: "Nota wajib sebelum disetujui." }),
  };
}

function normalDokumen(modul, d, user, ambang) {
  const jenis = modul === "pengeluaran" ? "expense" : "purchase";
  const wajib = notaWajibDenganAmbang({ jenis, mode: d.mode, amount: d.amount, categoryCode: d.category?.code }, ambang);
  const menunggu = d.status === "MENUNGGU_APPROVAL";
  const bisaPutus = boleh(user, P.FINANCE_APPROVE);
  const aks = aksiDokumen(modul, d, user, wajib);
  delete aks._catatan;
  return {
    kunci: `${modul}:${d.id}`, id: d.id, modul, nomor: d[CFG[modul].nomor], tanggal: tgl(d.date), nominal: uang(d.amount),
    judul: d.description, sub: [d.category?.name, LABEL_MODE[d.mode] ?? d.mode].filter(Boolean).join(" · "),
    pihak: d.supplier?.name ?? d.payeeName ?? d.reimburseTo?.name ?? null, rekening: d.cashAccount?.name ?? null,
    ...statusInfo(d.status), jatuhTempo: null, umurHari: null, sisa: null, terbayar: null, adaLampiran: !!d.receiptUrl, notaWajib: wajib && !d.receiptUrl,
    dibuatOleh: orang(d.createdBy), aksi: aks,
    persetujuan: menunggu && bisaPutus ? { jenis: JENIS_APPROVAL[modul], id: d.id } : null,
  };
}

function sisaKasbon(k) {
  const aktif = (k.repayments ?? []).filter((r) => !r.cancelledAt);
  const dipotong = aktif.length ? sumMoney(aktif.map((r) => r.amount)) : ZERO;
  const sisa = k.status === "AKTIF" ? toMoney(k.amount).minus(dipotong) : ZERO;
  return { dipotong: k.status === "LUNAS" ? toMoney(k.amount) : dipotong, sisa };
}

function normalKasbon(k, user) {
  const { dipotong, sisa } = sisaKasbon(k);
  const post = boleh(user, P.FINANCE_POST);
  const admin = boleh(user, P.FINANCE_ADMIN);
  const adaPelunasan = (k.repayments ?? []).some((r) => !r.cancelledAt);
  return {
    kunci: `kasbon:${k.id}`, id: k.id, modul: "kasbon", nomor: k.kasbonNumber, tanggal: tgl(k.date), nominal: uang(k.amount), judul: k.employeeName, sub: k.urgency ?? "",
    pihak: k.employeeName, rekening: k.cashAccount?.name ?? null, ...statusInfo(k.status), jatuhTempo: null, umurHari: null, sisa: uang(sisa), terbayar: uang(dipotong),
    adaLampiran: !!k.receiptUrl, notaWajib: false, dibuatOleh: orang(k.createdBy), persetujuan: null,
    aksi: {
      potongGaji: aksi(post && k.status === "AKTIF" && sisa.greaterThan(0), !post ? "Akun Anda tidak boleh mencatat pemotongan." : "Kasbon ini sudah tidak punya sisa yang bisa dipotong.", `/finance/kasbon/${k.id}/pelunasan`, { perlu: ["nominal", "tanggal"], tetap: { method: "POTONG_GAJI" } }),
      batalkan: aksi(admin && k.status !== "DIBATALKAN" && !adaPelunasan, !admin ? "Pembatalan hanya untuk admin keuangan." : k.status === "DIBATALKAN" ? "Kasbon ini sudah dibatalkan." : "Kasbon ini sudah ada pelunasannya — batalkan pelunasannya di web dulu.", `/finance/kasbon/${k.id}/batal`, { perlu: ["alasan"] }),
    },
  };
}

function normalPemasukan(i, akunPeta, user) {
  const akun = akunPeta.get(i.accountId);
  const dibatal = !!i.cancelledAt;
  const admin = boleh(user, P.FINANCE_ADMIN);
  return {
    kunci: `pemasukan:${i.id}`, id: i.id, modul: "pemasukan", nomor: i.incomeNumber, tanggal: tgl(i.date), nominal: uang(i.amount), judul: i.description,
    sub: akun ? `${akun.code} ${akun.name}` : "", pihak: null, rekening: i.cashAccount?.name ?? null, ...statusInfo(dibatal ? "DIBATALKAN" : "AKTIF"),
    jatuhTempo: null, umurHari: null, sisa: null, terbayar: null, adaLampiran: !!i.attachmentUrl, notaWajib: false, dibuatOleh: orang(i.createdBy), persetujuan: null,
    aksi: { batalkan: aksi(admin && !dibatal, !admin ? "Pembatalan hanya untuk admin keuangan." : "Pemasukan ini sudah dibatalkan.", `/finance/other-income/${i.id}/cancel`, { perlu: ["alasan"] }) },
  };
}

function normalRefund(r, user) {
  const menunggu = r.status === "MENUNGGU_APPROVAL";
  return {
    kunci: `refund:${r.id}`, id: r.id, modul: "refund", nomor: r.refundNumber, tanggal: tgl(r.date), nominal: uang(r.amount), judul: r.reason,
    sub: r.order?.orderNumber ? `Order ${r.order.orderNumber}` : "", pihak: r.order?.customer?.name ?? null, rekening: r.cashAccount?.name ?? null, ...statusInfo(r.status),
    jatuhTempo: null, umurHari: null, sisa: null, terbayar: null, adaLampiran: !!r.attachmentUrl, notaWajib: false, dibuatOleh: orang(r.createdBy),
    persetujuan: menunggu && boleh(user, P.FINANCE_APPROVE) ? { jenis: "refund", id: r.id } : null, aksi: {},
  };
}

function hitungBill(b) {
  const terbayar = (b.allocations ?? []).length ? sumMoney(b.allocations.map((a) => a.amount)) : ZERO;
  return { terbayar, sisa: toMoney(b.amount).minus(terbayar) };
}

function normalTagihan(b, user) {
  const { terbayar, sisa } = hitungBill(b);
  const terbuka = ["DISETUJUI", "DIBAYAR_SEBAGIAN"].includes(b.status);
  const post = boleh(user, P.FINANCE_POST);
  const acuan = b.dueDate ?? b.billDate;
  const umur = terbuka ? umurDari(acuan) : null;
  const menunggu = ["DRAFT", "MENUNGGU_APPROVAL"].includes(b.status);
  return {
    kunci: `tagihan:${b.id}`, id: b.id, modul: "tagihan", nomor: b.billNumber, tanggal: tgl(b.billDate), nominal: uang(b.amount), judul: b.supplier?.name ?? "—", sub: b.description,
    pihak: b.supplier?.name ?? null, rekening: null, ...statusInfo(b.status), jatuhTempo: tgl(b.dueDate), umurHari: umur, sisa: uang(sisa), terbayar: uang(terbayar),
    adaLampiran: !!b.attachmentUrl, notaWajib: false, dibuatOleh: orang(b.createdBy),
    persetujuan: menunggu && boleh(user, P.FINANCE_APPROVE) ? { jenis: "bill", id: b.id } : null,
    aksi: {
      bayar: aksi(post && terbuka && sisa.greaterThan(0), !post ? "Akun Anda tidak boleh membayar tagihan." : "Hanya tagihan yang sudah disetujui dan masih punya sisa yang bisa dibayar.", "/finance/supplier-payments", {
        perlu: ["rekening", "nominal", "tanggal"], tetap: { supplierId: b.supplierId, billId: b.id },
      }),
    },
  };
}

function normalBayarSupplier(p, user) {
  const dibatal = !!p.cancelledAt;
  const admin = boleh(user, P.FINANCE_ADMIN);
  return {
    kunci: `pembayaran-supplier:${p.id}`, id: p.id, modul: "pembayaran-supplier", nomor: p.paymentNumber, tanggal: tgl(p.date), nominal: uang(p.amount), judul: p.supplier?.name ?? "—",
    sub: (p.allocations ?? []).map((a) => a.bill?.billNumber).filter(Boolean).join(", "), pihak: p.supplier?.name ?? null, rekening: p.cashAccount?.name ?? null,
    ...statusInfo(dibatal ? "DIBATALKAN" : "AKTIF"), jatuhTempo: null, umurHari: null, sisa: null, terbayar: null, adaLampiran: !!p.attachmentUrl, notaWajib: false, dibuatOleh: orang(p.createdBy), persetujuan: null,
    aksi: { batalkan: aksi(admin && !dibatal, !admin ? "Pembatalan hanya untuk admin keuangan." : "Pembayaran ini sudah dibatalkan.", `/finance/supplier-payments/${p.id}/cancel`, { perlu: ["alasan"] }) },
  };
}

function normalSupplier(s, sisaUtang, jumlahTerbuka, user) {
  const post = boleh(user, P.FINANCE_POST);
  return {
    kunci: `supplier:${s.id}`, id: s.id, modul: "supplier", nomor: s.code, tanggal: tgl(s.createdAt), nominal: uang(sisaUtang), judul: s.name,
    sub: [s.phone, s.paymentTermDays ? `Termin ${s.paymentTermDays} hari` : null].filter(Boolean).join(" · "), pihak: s.name, rekening: null, ...statusInfo(s.active ? "AKTIF" : "NONAKTIF"),
    jatuhTempo: null, umurHari: null, sisa: uang(sisaUtang), terbayar: null, jumlahTagihanTerbuka: jumlahTerbuka, adaLampiran: false, notaWajib: false, dibuatOleh: null, persetujuan: null,
    aksi: { ubah: aksi(post, "Akun Anda tidak boleh mengubah data supplier.", `/finance/suppliers/${s.id}`, { metode: "PATCH", perlu: ["form"] }) },
  };
}

// ── DAFTAR ──────────────────────────────────────────────────────────────────────────────────────────────────────
const batasHalaman = (opsi) => {
  const limit = Math.min(Math.max(parseInt(opsi.limit, 10) || 20, 1), 50);
  const page = Math.max(parseInt(opsi.page, 10) || 1, 1);
  return { limit, page, skip: (page - 1) * limit };
};

async function petaAkunPendapatan(db, ids) {
  if (!ids.length) return new Map();
  const akun = await db.finAccount.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, code: true, name: true } });
  return new Map(akun.map((a) => [a.id, a]));
}

async function sisaUtangSupplier(db, supplierIds) {
  if (!supplierIds.length) return new Map();
  const bills = await db.finSupplierBill.findMany({
    where: { supplierId: { in: supplierIds }, status: { in: ["DISETUJUI", "DIBAYAR_SEBAGIAN"] } },
    select: { supplierId: true, amount: true, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } },
  });
  const peta = new Map();
  for (const b of bills) {
    const bayar = b.allocations.length ? sumMoney(b.allocations.map((a) => a.amount)) : ZERO;
    const cur = peta.get(b.supplierId) ?? { sisa: ZERO, jumlah: 0 };
    cur.sisa = cur.sisa.plus(toMoney(b.amount).minus(bayar));
    cur.jumlah += 1;
    peta.set(b.supplierId, cur);
  }
  return peta;
}

async function daftarPiutang(db, user, opsi) {
  const tab = ["SEMUA", "LEWAT", "BERJALAN"].includes(opsi.tab) ? opsi.tab : "SEMUA";
  const { limit, page, skip } = batasHalaman(opsi);
  const data = await umurPiutang(db, {});
  const kata = String(opsi.q || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const cocok = (b) => {
    const gudang = [b.orderNumber, b.invoiceNumber, b.customerName, b.salesName].filter(Boolean).join(" ").toLowerCase();
    return kata.every((k) => gudang.includes(k));
  };
  const dasar = data.baris.filter(cocok);
  const lewat = (b) => b.hariLewat > 0;
  const hitung = { SEMUA: dasar.length, LEWAT: dasar.filter(lewat).length, BERJALAN: dasar.filter((b) => !lewat(b)).length };
  const pilih = dasar.filter((b) => (tab === "LEWAT" ? lewat(b) : tab === "BERJALAN" ? !lewat(b) : true));
  const halaman = pilih.slice(skip, skip + limit);
  const total = pilih.length ? sumMoney(pilih.map((b) => b.sisaTagihan)) : ZERO;
  return {
    modul: "piutang", tab, page, limit, total: pilih.length, adaLagi: skip + halaman.length < pilih.length, hitung,
    items: halaman.map((b) => ({
      kunci: `piutang:${b.orderId}`, id: b.orderId, modul: "piutang", nomor: b.invoiceNumber ?? b.orderNumber ?? "—", tanggal: tgl(b.dueDate), nominal: uang(b.nilaiOrder), judul: b.customerName,
      sub: b.orderNumber ? `Order ${b.orderNumber}` : "", pihak: b.salesName, rekening: null, ...statusInfo(lewat(b) ? "LEWAT_TEMPO" : "BERJALAN"),
      jatuhTempo: tgl(b.dueDate), umurHari: b.hariLewat, ember: b.ember, sumberJatuhTempo: b.sumberJatuhTempo, sisa: uang(b.sisaTagihan), terbayar: null,
      adaLampiran: false, notaWajib: false, dibuatOleh: null, persetujuan: null, aksi: {},
    })),
    ringkasan: {
      total: uang(total), totalSemua: uang(data.total), umur: Object.fromEntries(Object.entries(data.ringkasan).map(([k, v]) => [k, uang(v)])),
      menungguVerifikasi: { jumlah: data.menungguVerifikasi.jumlah, total: uang(data.menungguVerifikasi.total) },
    },
    diperbaruiPada: new Date().toISOString(),
  };
}

export async function daftarTransaksi(db, user, modul, opsi = {}) {
  const cfg = CFG[modul];
  if (!cfg) throw new TransaksiError("Modul tidak dikenal", 404);
  if (modul === "piutang") return daftarPiutang(db, user, opsi);

  const tab = cfg.tabs.find((t) => t.id === opsi.tab) ?? cfg.tabs[0];
  const { limit, page, skip } = batasHalaman(opsi);
  const dasar = whereDasar(cfg, opsi);
  const model = db[cfg.model];
  const bagianTab = (t) => ({ ...dasar, ...t.where });
  let where = bagianTab(tab);
  // Tagihan: filter jatuh tempo lewat (tanpa mengubah tab) — aturan yang sama dengan GET /bills?jatuhTempo=lewat.
  if (modul === "tagihan" && opsi.jatuhTempo === "lewat") where = { ...where, dueDate: { lt: todayBookDateWIB() }, status: { in: ["DISETUJUI", "DIBAYAR_SEBAGIAN"] } };

  const [hitungArr, baris, jumlah] = await Promise.all([
    Promise.all(cfg.tabs.map((t) => model.count({ where: bagianTab(t) }))),
    model.findMany({ where, orderBy: cfg.urut, skip, take: limit, ...(Object.keys(cfg.include).length ? { include: cfg.include } : {}) }),
    model.count({ where }),
  ]);
  const hitung = Object.fromEntries(cfg.tabs.map((t, i) => [t.id, hitungArr[i]]));

  let items;
  const ringkasan = {};
  if (modul === "pengeluaran" || modul === "pembelian") {
    const ambang = await ambangNota(db);
    items = baris.map((d) => normalDokumen(modul, d, user, ambang));
  } else if (modul === "kasbon") {
    items = baris.map((k) => normalKasbon(k, user));
    const aktif = await db.finKasbon.findMany({ where: { status: "AKTIF" }, include: { repayments: { where: { cancelledAt: null } } } });
    ringkasan.sisaAktif = uang(aktif.length ? sumMoney(aktif.map((k) => sisaKasbon(k).sisa)) : ZERO);
  } else if (modul === "pemasukan") {
    const akun = await petaAkunPendapatan(db, baris.map((i) => i.accountId));
    items = baris.map((i) => normalPemasukan(i, akun, user));
  } else if (modul === "refund") {
    items = baris.map((r) => normalRefund(r, user));
  } else if (modul === "tagihan") {
    items = baris.map((b) => normalTagihan(b, user));
    const terbuka = await db.finSupplierBill.findMany({
      where: { status: { in: ["DISETUJUI", "DIBAYAR_SEBAGIAN"] } },
      select: { amount: true, dueDate: true, billDate: true, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } },
    });
    let total = ZERO;
    let lewat = ZERO;
    let nLewat = 0;
    for (const b of terbuka) {
      const s = toMoney(b.amount).minus(b.allocations.length ? sumMoney(b.allocations.map((a) => a.amount)) : ZERO);
      total = total.plus(s);
      if (umurDari(b.dueDate ?? b.billDate) > 0) { lewat = lewat.plus(s); nLewat += 1; }
    }
    ringkasan.utangTerbuka = uang(total);
    ringkasan.lewatTempo = { jumlah: nLewat, total: uang(lewat) };
  } else if (modul === "pembayaran-supplier") {
    items = baris.map((p) => normalBayarSupplier(p, user));
  } else if (modul === "supplier") {
    const peta = await sisaUtangSupplier(db, baris.map((s) => s.id));
    items = baris.map((s) => normalSupplier(s, peta.get(s.id)?.sisa ?? ZERO, peta.get(s.id)?.jumlah ?? 0, user));
    const semua = await sisaUtangSupplier(db, (await db.finSupplier.findMany({ select: { id: true } })).map((s) => s.id));
    ringkasan.utangTerbuka = uang([...semua.values()].reduce((a, v) => a.plus(v.sisa), ZERO));
  }

  if (["pengeluaran", "pembelian", "pemasukan", "refund", "pembayaran-supplier", "kasbon"].includes(modul)) {
    const agg = await model.aggregate({ where, _sum: { amount: true } });
    ringkasan.total = uang(agg._sum.amount ?? 0);
  }
  return { modul, tab: tab.id, page, limit, total: jumlah, adaLagi: skip + items.length < jumlah, hitung, items, ringkasan, diperbaruiPada: new Date().toISOString() };
}

/** Jumlah per modul untuk kartu di tab Transaksi. Semuanya dari server — klien tidak menghitung. */
export async function ringkasanTransaksi(db) {
  const [expMenunggu, purMenunggu, kasbon, refundMenunggu, tagihanMenunggu, supplierAktif, pemasukanAktif, bayarSupMasuk] = await Promise.all([
    db.finExpense.count({ where: { status: "MENUNGGU_APPROVAL" } }), db.finPurchase.count({ where: { status: "MENUNGGU_APPROVAL" } }),
    db.finKasbon.count({ where: { status: "AKTIF" } }), db.finRefund.count({ where: { status: "MENUNGGU_APPROVAL" } }),
    db.finSupplierBill.count({ where: { status: { in: ["DRAFT", "MENUNGGU_APPROVAL"] } } }), db.finSupplier.count({ where: { active: true } }),
    db.finOtherIncome.count({ where: { cancelledAt: null } }), db.finSupplierPayment.count({ where: { cancelledAt: null } }),
  ]);
  const terbuka = await db.finSupplierBill.count({ where: { status: { in: ["DISETUJUI", "DIBAYAR_SEBAGIAN"] } } });
  return {
    pengeluaran: { menunggu: expMenunggu }, pembelian: { menunggu: purMenunggu }, kasbon: { aktif: kasbon }, pemasukan: { aktif: pemasukanAktif },
    refund: { menunggu: refundMenunggu }, tagihan: { menunggu: tagihanMenunggu, terbuka }, supplier: { aktif: supplierAktif }, "pembayaran-supplier": { aktif: bayarSupMasuk },
  };
}

// ── DETAIL ──────────────────────────────────────────────────────────────────────────────────────────────────────
const B = (label, nilai, jenis = "teks", tautan = null) => ({ label, nilai: nilai == null || nilai === "" ? null : nilai, jenis, ...(tautan && { tautan }) });
const bagian = (judul, baris) => ({ judul, baris: baris.filter((r) => r.nilai != null) });

function bagianDokumen(modul, d) {
  return [
    bagian("Dokumen", [B("Nomor", d[CFG[modul].nomor]), B("Tanggal", tgl(d.date), "tanggal"), B("Kategori", d.category?.name), B("Akun", d.category?.account ? `${d.category.account.code} ${d.category.account.name}` : null),
      B("Divisi", d.division), B("Cara bayar", LABEL_MODE[d.mode] ?? d.mode), B("Status", LABEL_STATUS[d.status]?.[0] ?? d.status), B("Order terkait", d.order?.orderNumber)]),
    bagian("Dana", [B("Nominal", uang(d.amount), "uang"), B("Rekening sumber", d.cashAccount?.name), B("Supplier", d.supplier?.name), B("Penerima", d.payeeName), B("Diganti kepada", d.reimburseTo?.name)]),
    bagian("Catatan", [B("Keterangan", d.description), B("Catatan", d.notes), B("Alasan penolakan/pembatalan", d.rejectReason)]),
    bagian("Proses", [B("Dibuat oleh", d.createdBy?.name), B("Diputuskan oleh", d.approvedBy?.name), B("Diputuskan pada", waktu(d.approvedAt), "waktu"), B("Dibayar oleh", d.paidBy?.name), B("Dibayar pada", waktu(d.paidAt), "waktu"),
      B("Bukti terverifikasi", d.receiptVerifiedAt ? "Ya" : d.receiptUrl ? "Belum" : null)]),
  ];
}

async function detailPiutang(db, user, orderId) {
  const data = await umurPiutang(db, {});
  const baris = data.baris.find((b) => b.orderId === orderId);
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, orderNumber: true, value: true, status: true, paymentStatus: true, createdAt: true, customerId: true,
      customer: { select: { id: true, name: true, phone: true } }, invoice: { select: { invoiceNumber: true, dueDate: true, lifecycleStatus: true } },
    },
  });
  if (!order) return null;
  const gate = await getVerificationGate(db);
  const payments = await db.payment.findMany({
    where: { OR: [{ orderId }, { finAllocations: { some: { orderId } } }] },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, amount: true, method: true, createdAt: true, cancelledAt: true, orderId: true, verifications: { select: { id: true } },
      finAllocations: { select: { orderId: true, amount: true, order: { select: { orderNumber: true } } } },
    },
  });
  const refunds = await db.finRefund.findMany({ where: { orderId }, orderBy: { createdAt: "asc" }, select: { id: true, refundNumber: true, amount: true, status: true, date: true } });
  const terbayar = await paidForOrder(db, orderId, gate);
  const saudara = await db.order.findMany({ where: { customerId: order.customerId, status: { not: "CANCELLED" } }, select: { id: true, orderNumber: true }, orderBy: { createdAt: "desc" }, take: 30 });
  const punyaPost = boleh(user, P.FINANCE_POST);
  const statusBayar = (p) => (p.cancelledAt ? "DIBATALKAN" : p.verifications.length ? "TERVERIFIKASI" : "MENUNGGU");
  const pembayaran = payments.map((p) => ({
    id: p.id, nominal: uang(p.amount), metode: p.method, tanggal: tgl(p.createdAt), status: statusBayar(p), statusLabel: { DIBATALKAN: "Dibatalkan", TERVERIFIKASI: "Terverifikasi", MENUNGGU: "Menunggu verifikasi" }[statusBayar(p)],
    asalOrderId: p.orderId,
    alokasi: p.finAllocations.map((a) => ({ orderId: a.orderId, nomor: a.order?.orderNumber ?? null, nominal: uang(a.amount) })),
    aksiAlokasi: aksi(punyaPost && !p.cancelledAt, !punyaPost ? "Akun Anda tidak boleh mengatur alokasi pembayaran." : "Pembayaran yang dibatalkan tidak bisa dialokasikan.", `/finance/customer-payments/${p.id}/allocations`, { perlu: ["alokasi"] }),
  }));
  return {
    kunci: `piutang:${orderId}`, id: orderId, modul: "piutang", nomor: order.invoice?.invoiceNumber ?? order.orderNumber ?? "—", judul: order.customer?.name ?? "—", nominal: uang(order.value),
    sisa: baris ? uang(baris.sisaTagihan) : uang(0), umurHari: baris?.hariLewat ?? null, jatuhTempo: tgl(baris?.dueDate ?? order.invoice?.dueDate), ember: baris?.ember ?? null,
    ...statusInfo(baris && baris.hariLewat > 0 ? "LEWAT_TEMPO" : "BERJALAN"), aksi: {}, persetujuan: null,
    bagian: [
      bagian("Tagihan", [B("Order", order.orderNumber), B("Status order", order.status), B("Status bayar di CRM", order.paymentStatus), B("Nilai order", uang(order.value), "uang"),
        B("Uang diterima (menurut server)", uang(terbayar), "uang"), B("Sisa piutang (buku besar)", baris ? uang(baris.sisaTagihan) : uang(0), "uang")]),
      bagian("Jatuh tempo", [B("Invoice", order.invoice?.invoiceNumber), B("Status invoice", order.invoice?.lifecycleStatus), B("Jatuh tempo", tgl(baris?.dueDate ?? order.invoice?.dueDate), "tanggal"),
        B("Acuan umur", baris ? (baris.sumberJatuhTempo === "invoice" ? "Jatuh tempo invoice" : "Tanggal order (invoice belum punya jatuh tempo)") : null),
        B("Umur", baris ? (baris.hariLewat > 0 ? `${baris.hariLewat} hari lewat tempo` : "Belum jatuh tempo") : null)]),
      bagian("Pelanggan", [B("Nama", order.customer?.name), B("Telepon", order.customer?.phone)]),
      bagian("Refund", refunds.map((r) => B(`${r.refundNumber} · ${LABEL_STATUS[r.status]?.[0] ?? r.status}`, uang(r.amount), "uang", { modul: "refund", id: r.id }))),
    ],
    pembayaran, refund: refunds.length, orderPelanggan: saudara.map((o) => ({ id: o.id, nomor: o.orderNumber })),
    catatan: baris ? null : "Order ini tidak punya sisa piutang di buku besar.", lampiran: [], riwayat: [],
  };
}

export async function detailTransaksi(db, user, modul, id) {
  const cfg = CFG[modul];
  if (!cfg) throw new TransaksiError("Modul tidak dikenal", 404);
  if (modul === "piutang") return detailPiutang(db, user, id);
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const doc = await db[cfg.model].findUnique({ where: { id }, include: Object.keys(cfg.include).length ? cfg.include : undefined });
  if (!doc) return null;
  const lampiran = bangunLampiran(doc);
  const riwayatDari = (entity) => bangunRiwayat(db, null, doc, entity);

  if (modul === "pengeluaran" || modul === "pembelian") {
    const item = normalDokumen(modul, doc, user, await ambangNota(db));
    return { ...item, bagian: bagianDokumen(modul, doc), lampiran, riwayat: await riwayatDari(cfg.entity), syarat: item.notaWajib ? "Nota wajib sebelum disetujui." : null };
  }
  if (modul === "kasbon") {
    const item = normalKasbon(doc, user);
    return {
      ...item,
      bagian: [
        bagian("Kasbon", [B("Nomor", doc.kasbonNumber), B("Tanggal", tgl(doc.date), "tanggal"), B("Karyawan", doc.employeeName), B("Alasan", doc.urgency), B("Nominal", item.nominal, "uang"),
          B("Sudah dipotong", item.terbayar, "uang"), B("Sisa", item.sisa, "uang"), B("Uang keluar dari", doc.cashAccount?.name), B("Catatan", doc.notes), B("Status", LABEL_STATUS[doc.status]?.[0]), B("Alasan batal", doc.cancelReason)]),
        bagian("Pemotongan gaji", doc.repayments.map((r) => B(`${tgl(r.date)}${r.cancelledAt ? " · dibatalkan" : ""}`, uang(r.amount), "uang"))),
      ],
      lampiran, riwayat: await riwayatDari(cfg.entity),
    };
  }
  if (modul === "pemasukan") {
    const akun = await petaAkunPendapatan(db, [doc.accountId]);
    const item = normalPemasukan(doc, akun, user);
    const a = akun.get(doc.accountId);
    return {
      ...item,
      bagian: [
        bagian("Pemasukan", [B("Nomor", doc.incomeNumber), B("Tanggal", tgl(doc.date), "tanggal"), B("Nominal", item.nominal, "uang"), B("Akun pendapatan", a ? `${a.code} ${a.name}` : null), B("Masuk ke rekening", doc.cashAccount?.name),
          B("Keterangan", doc.description), B("Catatan", doc.notes), B("Dibuat oleh", doc.createdBy?.name), B("Alasan batal", doc.cancelReason)]),
      ],
      catatan: "Pemasukan Lain bukan pembayaran order. Uang dari pelanggan dicatat di Pembayaran & Verifikasi.", lampiran, riwayat: await riwayatDari(cfg.entity),
    };
  }
  if (modul === "refund") {
    const item = normalRefund(doc, user);
    const gate = await getVerificationGate(db);
    const sisaBisa = await paidForOrder(db, doc.orderId, gate);
    return {
      ...item,
      bagian: [
        bagian("Refund", [B("Nomor", doc.refundNumber), B("Tanggal", tgl(doc.date), "tanggal"), B("Nominal", item.nominal, "uang"), B("Alasan", doc.reason), B("Order", doc.order?.orderNumber), B("Pelanggan", doc.order?.customer?.name),
          B("Dikembalikan dari rekening", doc.cashAccount?.name), B("Status", LABEL_STATUS[doc.status]?.[0]), B("Alasan penolakan", doc.rejectReason), B("Dibuat oleh", doc.createdBy?.name), B("Diputuskan oleh", doc.approvedBy?.name)]),
        bagian("Sumber pembayaran", [B("Nilai order", uang(doc.order?.value), "uang"), B("Uang yang masih bisa dikembalikan (server)", uang(sisaBisa), "uang", doc.order ? { modul: "piutang", id: doc.order.id } : null)]),
      ],
      lampiran, riwayat: await riwayatDari(cfg.entity),
    };
  }
  if (modul === "tagihan") {
    const item = normalTagihan(doc, user);
    return {
      ...item,
      bagian: [
        bagian("Tagihan", [B("Nomor internal", doc.billNumber), B("Nomor faktur supplier", doc.supplierRef), B("Supplier", doc.supplier?.name, "teks", { modul: "supplier", id: doc.supplierId }), B("Tanggal tagihan", tgl(doc.billDate), "tanggal"),
          B("Jatuh tempo", tgl(doc.dueDate), "tanggal"), B("Keterangan", doc.description), B("Penerimaan barang", doc.goodsReceipt?.receiptNumber), B("Status", LABEL_STATUS[doc.status]?.[0]), B("Alasan penolakan", doc.rejectReason)]),
        bagian("Utang", [B("Nominal tagihan", item.nominal, "uang"), B("Sudah dibayar", item.terbayar, "uang"), B("Sisa utang", item.sisa, "uang"),
          B("Umur", item.umurHari == null ? null : item.umurHari > 0 ? `${item.umurHari} hari lewat ${doc.dueDate ? "jatuh tempo" : "tanggal tagihan"}` : "Belum jatuh tempo")]),
        bagian("Pembayaran", doc.allocations.map((a) => B(`${a.payment.paymentNumber} · ${tgl(a.payment.date)}`, uang(a.amount), "uang", { modul: "pembayaran-supplier", id: a.payment.id }))),
      ],
      lampiran, riwayat: await riwayatDari(cfg.entity),
    };
  }
  if (modul === "pembayaran-supplier") {
    const item = normalBayarSupplier(doc, user);
    return {
      ...item,
      bagian: [
        bagian("Pembayaran", [B("Nomor", doc.paymentNumber), B("Tanggal", tgl(doc.date), "tanggal"), B("Supplier", doc.supplier?.name, "teks", { modul: "supplier", id: doc.supplierId }), B("Nominal", item.nominal, "uang"), B("Dari rekening", doc.cashAccount?.name),
          B("Referensi transfer", doc.reference), B("Catatan", doc.notes), B("Dibuat oleh", doc.createdBy?.name), B("Alasan batal", doc.cancelReason)]),
        bagian("Tagihan yang dibayar", doc.allocations.map((a) => B(a.bill?.billNumber ?? "—", uang(a.amount), "uang", a.bill ? { modul: "tagihan", id: a.bill.id } : null))),
      ],
      lampiran, riwayat: [],
    };
  }
  if (modul === "supplier") {
    const peta = await sisaUtangSupplier(db, [doc.id]);
    const item = normalSupplier(doc, peta.get(doc.id)?.sisa ?? ZERO, peta.get(doc.id)?.jumlah ?? 0, user);
    const terbuka = await db.finSupplierBill.findMany({
      where: { supplierId: doc.id, status: { in: ["DISETUJUI", "DIBAYAR_SEBAGIAN"] } }, orderBy: [{ dueDate: "asc" }, { billDate: "asc" }], take: 30,
      include: { allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } },
    });
    const histori = await db.finSupplierPayment.findMany({ where: { supplierId: doc.id, cancelledAt: null }, orderBy: { date: "desc" }, take: 10, select: { id: true, paymentNumber: true, date: true, amount: true } });
    return {
      ...item,
      supplier: { telepon: doc.phone, email: doc.email, alamat: doc.address, terminHari: doc.paymentTermDays, bank: doc.bankName, rekeningBank: doc.bankAccount, atasNama: doc.bankHolder, catatan: doc.notes, aktif: doc.active },
      bagian: [
        bagian("Supplier", [B("Kode", doc.code), B("Nama", doc.name), B("Telepon", doc.phone), B("Email", doc.email), B("Alamat", doc.address), B("Termin pembayaran", doc.paymentTermDays ? `${doc.paymentTermDays} hari` : null), B("Catatan", doc.notes)]),
        bagian("Rekening supplier", [B("Bank", doc.bankName), B("Nomor rekening", doc.bankAccount), B("Atas nama", doc.bankHolder)]),
        bagian("Utang terbuka", terbuka.map((b) => {
          const s = toMoney(b.amount).minus(b.allocations.length ? sumMoney(b.allocations.map((a) => a.amount)) : ZERO);
          return B(`${b.billNumber} · jatuh tempo ${tgl(b.dueDate) ?? "—"}`, uang(s), "uang", { modul: "tagihan", id: b.id });
        })),
        bagian("Pembayaran terakhir", histori.map((p) => B(`${p.paymentNumber} · ${tgl(p.date)}`, uang(p.amount), "uang", { modul: "pembayaran-supplier", id: p.id }))),
      ],
      lampiran: [], riwayat: [],
    };
  }
  return null;
}

// ── OPSI FORM ───────────────────────────────────────────────────────────────────────────────────────────────────
// Termasuk akun kontra RETUR_PENJUALAN: dipakai refund; menaruh pemasukan di sana sama saja membatalkan refund lewat jalan pintas.
const AKUN_PENDAPATAN_ORDER = new Set(["PENDAPATAN_LAYANAN", "PENDAPATAN_PRODUK", "PENDAPATAN_SEWA", "PENDAPATAN_ONGKIR", "RETUR_PENJUALAN"]);

/** Pilihan untuk formulir (kategori, rekening + saldo, supplier, karyawan, akun pendapatan lain). Semua dari server; tidak ada daftar buatan klien. */
export async function opsiForm(db, user) {
  const [katExp, katPur, saldo, suppliers, akun, ambang] = await Promise.all([
    db.finExpenseCategory.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, division: true } }),
    db.finPurchaseCategory.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    saldoKasBank(db, {}),
    db.finSupplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, paymentTermDays: true } }),
    db.finAccount.findMany({ where: { type: "PENDAPATAN", isPostable: true, active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, systemKey: true } }),
    ambangNota(db),
  ]);
  const punyaPost = boleh(user, P.FINANCE_POST);
  return {
    kategoriPengeluaran: katExp, kategoriPembelian: katPur,
    rekening: saldo.map((r) => ({ id: r.id, name: r.name, kind: r.kind, saldo: uang(r.saldo) })),
    supplier: suppliers,
    // Akun pendapatan penjualan/layanan/sewa/ongkir TIDAK ditawarkan: itu milik alur pembayaran order (aturan yang sama dengan penjaga di POST /other-income).
    akunPemasukanLain: akun.filter((a) => !AKUN_PENDAPATAN_ORDER.has(a.systemKey)).map((a) => ({ id: a.id, code: a.code, name: a.name })),
    karyawan: punyaPost ? (await daftarKaryawanKasbon(db)).map((k) => ({ id: k.id, name: k.name })) : [],
    mode: [{ id: "LANGSUNG", label: LABEL_MODE.LANGSUNG }, { id: "REIMBURSEMENT", label: LABEL_MODE.REIMBURSEMENT }, { id: "UTANG", label: LABEL_MODE.UTANG }],
    // Orang yang hanya boleh mengajukan (bukan mencatat) selalu berujung reimbursement — sama dengan aturan POST /expenses.
    hanyaReimbursement: !punyaPost,
    ambangNotaRupiah: uang(ambang),
  };
}

/** Cari order untuk refund: menampilkan uang yang MASIH boleh dikembalikan menurut server (paidForOrder), bukan tebakan klien. */
export async function cariOrderRefund(db, q) {
  const kata = String(q || "").trim();
  if (kata.length < 2) return [];
  const orders = await db.order.findMany({
    where: { status: { not: "CANCELLED" }, OR: [{ orderNumber: { contains: kata, mode: "insensitive" } }, { customer: { name: { contains: kata, mode: "insensitive" } } }] },
    orderBy: { createdAt: "desc" }, take: 15, select: { id: true, orderNumber: true, value: true, customer: { select: { name: true } } },
  });
  const gate = await getVerificationGate(db);
  const hasil = [];
  for (const o of orders) {
    const sisa = await paidForOrder(db, o.id, gate);
    hasil.push({ id: o.id, nomor: o.orderNumber, pelanggan: o.customer?.name ?? "—", nilai: uang(o.value), sisaBisaDirefund: uang(sisa) });
  }
  return hasil;
}
