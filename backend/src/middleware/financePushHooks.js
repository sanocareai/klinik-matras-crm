// PEMICU PUSH FINANCE (S11) — dipasang SEKALI di /api/finance, di depan semua router finance.
//
// Tidak mengubah perilaku endpoint mana pun: hanya mengamati hasil respons. Setelah respons sukses terkirim ke klien (res "finish"), pemicu dijalankan
// fire-and-forget (dispatchFinanceNotification tidak pernah melempar; di sini pun dibungkus try/catch). Bila FINANCE_PUSH_ENABLED tidak "true",
// dispatch langsung berhenti — tidak ada query tambahan yang berarti dan tidak ada jaringan keluar.
//
// Pemicu:
//   dokumen baru/diajukan berstatus MENUNGGU_APPROVAL (expenses|purchases|bills|refunds)   → approval baru ke pemegang FINANCE_APPROVE
//   /{expenses|purchases|bills|refunds}/:id/approve|reject                                  → hasil keputusan ke pengaju
//   /pembayaran/:id/tolak                                                                   → pembayaran ditolak ke pencatat
//   pembatalan oleh admin (/{expenses|purchases}/:id/cancel, /kasbon/:id/batal, dsb.)       → transaksi sensitif ke pemegang FINANCE_ADMIN
// Pengingat jatuh tempo & "pembayaran menunggu" dijalankan job harian (services/financeReminderJob.js), bukan di sini.

import { prisma } from "../db.js";
import { financePushEnabled, notifyApprovalRequested, notifyApprovalDecided, notifyPaymentRejected, notifySensitive } from "../services/financeNotifications.js";

const JENIS = { expenses: "expense", purchases: "purchase", bills: "bill", refunds: "refund" };
const MODEL = { expense: "finExpense", purchase: "finPurchase", bill: "finSupplierBill", refund: "finRefund" };
const MODUL_SENSITIF = { expenses: "pengeluaran", purchases: "pembelian", kasbon: "kasbon", "other-income": "pemasukan", "supplier-payments": "pembayaran-supplier", bills: "tagihan", refunds: "refund" };

async function jalankan(req, body, status) {
  if (!financePushEnabled()) return;
  const path = req.path.replace(/\/+$/, "");
  const aktor = req.user?.id ?? null;
  let m;

  // Pembuatan dokumen langsung diajukan
  if ((m = /^\/(expenses|purchases|bills|refunds)$/.exec(path)) && req.method === "POST" && status === 201 && body?.id && body?.status === "MENUNGGU_APPROVAL") {
    return notifyApprovalRequested({ jenis: JENIS[m[1]], id: body.id, nomor: body.expenseNumber || body.purchaseNumber || body.billNumber || body.refundNumber, actorId: aktor });
  }
  if ((m = /^\/(expenses|purchases)\/([^/]+)\/submit$/.exec(path)) && req.method === "POST" && status === 200 && body?.status === "MENUNGGU_APPROVAL") {
    return notifyApprovalRequested({ jenis: JENIS[m[1]], id: m[2], nomor: body.expenseNumber || body.purchaseNumber, actorId: aktor });
  }
  // Keputusan
  if ((m = /^\/(expenses|purchases|bills|refunds)\/([^/]+)\/(approve|reject)$/.exec(path)) && req.method === "POST" && status >= 200 && status < 300) {
    const jenis = JENIS[m[1]];
    const doc = await prisma[MODEL[jenis]].findUnique({ where: { id: m[2] }, select: { createdById: true } }).catch(() => null);
    if (doc?.createdById && doc.createdById !== aktor) {
      return notifyApprovalDecided({ jenis, id: m[2], decision: m[3] === "approve" ? "approved" : "rejected", submitterId: doc.createdById });
    }
    return;
  }
  // Pembayaran ditolak
  if ((m = /^\/pembayaran\/([^/]+)\/tolak$/.exec(path)) && req.method === "POST" && status >= 200 && status < 300) {
    const p = await prisma.payment.findUnique({ where: { id: m[1] }, select: { recordedById: true } }).catch(() => null);
    return notifyPaymentRejected({ id: m[1], recordedById: p?.recordedById ?? null, actorId: aktor });
  }
  // Pembatalan admin (transaksi sensitif)
  if ((m = /^\/(expenses|purchases|bills|refunds|supplier-payments|other-income)\/([^/]+)\/cancel$/.exec(path) || /^\/(kasbon)\/([^/]+)\/batal$/.exec(path)) && req.method === "POST" && status >= 200 && status < 300) {
    return notifySensitive({ modul: MODUL_SENSITIF[m[1]], id: m[2], actorId: aktor });
  }
}

export function financePushHooks(req, res, next) {
  if (req.method !== "POST" || !financePushEnabled()) return next();
  let body;
  const asli = res.json.bind(res);
  res.json = (b) => { body = b; return asli(b); };
  res.on("finish", () => {
    Promise.resolve(jalankan(req, body, res.statusCode)).catch((err) => console.warn("[financePush] pemicu gagal:", err?.message));
  });
  return next();
}
