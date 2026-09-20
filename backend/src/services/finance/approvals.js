// INBOX PERSETUJUAN FINANCE — read-model gabungan (Finance Mobile S4).
//
// Menggabungkan empat dokumen yang punya alur approval — Pengeluaran, Pembelian, Tagihan Supplier, Refund — menjadi
// SATU daftar bernormalisasi. TIDAK menduplikasi data & TIDAK punya command sendiri: keputusan tetap dijalankan oleh
// endpoint approve/reject milik tiap jenis (routes/financeTransactions.js), yang menjadi satu-satunya sumber aturan
// bisnis. Setiap item membawa `aksi` (boleh/tidak + alasan + path endpoint) yang dihitung SERVER, sehingga klien tidak
// menyalin aturan izin, pemisahan tugas, maupun status.
//
// KEPUTUSAN WORKFLOW (dicatat di docs/FINANCE-MOBILE-BACKEND.md):
//   MENUNGGU  = sudah diajukan, belum diputuskan (MENUNGGU_APPROVAL). DRAFT tidak masuk inbox (belum diajukan).
//   DIPROSES  = sudah disetujui tetapi belum selesai (Pengeluaran/Pembelian DISETUJUI menunggu dibayar; Tagihan DISETUJUI/
//               DIBAYAR_SEBAGIAN menunggu pelunasan).
//   DISETUJUI = disetujui dan selesai (DIBAYAR / LUNAS; Refund DISETUJUI karena uang sudah keluar saat disetujui).
//   DITOLAK   = DITOLAK. DIBATALKAN tidak ditampilkan (bukan keputusan approval).

import { hasPermission } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";
import { moneyToNumber } from "./money.js";
import { notaWajib, RECEIPTS_URL_PREFIX } from "./receipts.js";
import { todayBookDateWIB } from "./journal.js";
import { ENTITY_TYPES } from "../../lib/activityLog.js";
import { FILE_PATTERN, MEDIA_SIGN_TTL_SECONDS, signFile } from "../../lib/mediaSigning.js";

export const JENIS_LIST = ["expense", "purchase", "bill", "refund"];
export const TAB_LIST = ["MENUNGGU", "DIPROSES", "DISETUJUI", "DITOLAK"];

const LABEL_JENIS = { expense: "Pengeluaran", purchase: "Pembelian", bill: "Tagihan supplier", refund: "Refund" };
const LABEL_STATUS = {
  MENUNGGU_APPROVAL: "Menunggu persetujuan", DISETUJUI: "Disetujui", DIBAYAR: "Dibayar", DIBAYAR_SEBAGIAN: "Dibayar sebagian",
  LUNAS: "Lunas", DITOLAK: "Ditolak",
};

const TAHAP = {
  expense: { MENUNGGU_APPROVAL: "MENUNGGU", DISETUJUI: "DIPROSES", DIBAYAR: "DISETUJUI", DITOLAK: "DITOLAK" },
  purchase: { MENUNGGU_APPROVAL: "MENUNGGU", DISETUJUI: "DIPROSES", DIBAYAR: "DISETUJUI", DITOLAK: "DITOLAK" },
  bill: { MENUNGGU_APPROVAL: "MENUNGGU", DISETUJUI: "DIPROSES", DIBAYAR_SEBAGIAN: "DIPROSES", LUNAS: "DISETUJUI", DITOLAK: "DITOLAK" },
  refund: { MENUNGGU_APPROVAL: "MENUNGGU", DISETUJUI: "DISETUJUI", DITOLAK: "DITOLAK" },
};

const orangSaya = { select: { id: true, name: true } };
const INCLUDE = {
  expense: {
    category: { select: { code: true, name: true } }, cashAccount: { select: { name: true } }, supplier: { select: { name: true } },
    reimburseTo: orangSaya, createdBy: orangSaya, approvedBy: orangSaya, paidBy: orangSaya, order: { select: { orderNumber: true } },
  },
  purchase: {
    category: { select: { code: true, name: true } }, cashAccount: { select: { name: true } }, supplier: { select: { name: true } },
    reimburseTo: orangSaya, createdBy: orangSaya, approvedBy: orangSaya, paidBy: orangSaya,
  },
  bill: { supplier: { select: { name: true } }, createdBy: orangSaya, approvedBy: orangSaya },
  refund: {
    cashAccount: { select: { name: true } }, order: { select: { orderNumber: true, customer: { select: { name: true } } } },
    createdBy: orangSaya, approvedBy: orangSaya,
  },
};

const MODEL = { expense: "finExpense", purchase: "finPurchase", bill: "finSupplierBill", refund: "finRefund" };
const ENTITY = { expense: ENTITY_TYPES.FIN_EXPENSE, purchase: ENTITY_TYPES.FIN_PURCHASE, bill: ENTITY_TYPES.FIN_SUPPLIER_BILL, refund: ENTITY_TYPES.FIN_REFUND };
const KOLOM_TANGGAL = { expense: "date", purchase: "date", bill: "billDate", refund: "date" };
const KOLOM_NOMOR = { expense: "expenseNumber", purchase: "purchaseNumber", bill: "billNumber", refund: "refundNumber" };
const PATH_KEPUTUSAN = {
  expense: (id, aksi) => `/finance/expenses/${id}/${aksi}`,
  purchase: (id, aksi) => `/finance/purchases/${id}/${aksi}`,
  bill: (id, aksi) => `/finance/bills/${id}/${aksi}`,
  refund: (id, aksi) => `/finance/refunds/${id}/${aksi}`,
};

// Kolom teks yang dicari untuk pencarian bebas (dot-path ke relasi).
const KOLOM_CARI = {
  expense: ["expenseNumber", "description", "payeeName", "notes", "category.name", "supplier.name", "reimburseTo.name", "createdBy.name"],
  purchase: ["purchaseNumber", "description", "payeeName", "notes", "category.name", "supplier.name", "reimburseTo.name", "createdBy.name"],
  bill: ["billNumber", "supplierRef", "description", "supplier.name", "createdBy.name"],
  refund: ["refundNumber", "reason", "order.orderNumber", "order.customer.name", "createdBy.name"],
};

export function tahapDari(jenis, status) {
  return TAHAP[jenis]?.[status] ?? null;
}

const statusUntukTahap = (jenis, tab) => Object.entries(TAHAP[jenis]).filter(([, t]) => t === tab).map(([s]) => s);
const semuaStatus = (jenis) => Object.keys(TAHAP[jenis]);

function tanggalKolom(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? new Date(`${v}T00:00:00.000Z`) : null;
}

/** Tiap KATA harus cocok di salah satu kolom (AND antar kata, OR antar kolom); kata angka juga dicocokkan ke nominal. */
function klausaCari(q, kolom) {
  const kata = String(q || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return kata.map((k) => {
    const atau = kolom.map((path) => {
      const bagian = path.split(".");
      return bagian.reduceRight((isi, kunci, i) => (i === bagian.length - 1 ? { [kunci]: { contains: k, mode: "insensitive" } } : { [kunci]: isi }), null);
    });
    const angka = k.replace(/\./g, "");
    if (/^\d{3,12}$/.test(angka)) atau.push({ amount: Number(angka) });
    return { OR: atau };
  });
}

function bangunWhere(jenis, { statuses, from, to, pemohonId, q }) {
  const dari = tanggalKolom(from);
  const sampai = tanggalKolom(to);
  return {
    status: { in: statuses },
    ...(dari && sampai && { [KOLOM_TANGGAL[jenis]]: { gte: dari, lte: sampai } }),
    ...(pemohonId && { createdById: pemohonId }),
    ...(q && String(q).trim() ? { AND: klausaCari(q, KOLOM_CARI[jenis]) } : {}),
  };
}

function urutan(jenis, tab) {
  const arah = tab === "MENUNGGU" ? "asc" : "desc"; // yang menunggu: paling lama dulu
  if (jenis === "expense" || jenis === "purchase") return [{ submittedAt: { sort: arah, nulls: "last" } }, { createdAt: arah }];
  return [{ createdAt: arah }];
}

const diajukanPada = (doc) => doc.submittedAt ?? doc.createdAt;

function umurHari(diajukan) {
  const a = todayBookDateWIB().getTime();
  const b = todayBookDateWIB(new Date(diajukan)).getTime();
  return Math.max(0, Math.round((a - b) / 86400000));
}

/** Izin & aturan keputusan untuk SATU dokumen, dari sudut pandang `user`. Sumber tunggal — klien tidak menghitung ulang. */
export function hitungAksi(jenis, doc, user, { syarat = null } = {}) {
  const punyaIzin = hasPermission(user, P.FINANCE_APPROVE);
  const menunggu = doc.status === "MENUNGGU_APPROVAL";
  const base = (aksi) => ({ path: PATH_KEPUTUSAN[jenis](doc.id, aksi), metode: "POST" });

  let bolehSetuju = punyaIzin && menunggu;
  let bolehTolak = punyaIzin && menunggu;
  let alasanSetuju = null;
  let alasanTolak = null;

  if (!punyaIzin) {
    alasanSetuju = alasanTolak = "Akun Anda tidak punya izin memutuskan persetujuan.";
  } else if (!menunggu) {
    alasanSetuju = alasanTolak = "Dokumen ini sudah diputuskan.";
  } else {
    // Pemisahan tugas yang SUDAH ADA di backend: pengeluaran & pembelian tidak boleh disetujui pembuatnya sendiri
    // (kecuali FINANCE_ADMIN). Tagihan & refund tidak memiliki aturan itu di backend — tidak dikarang di sini.
    const jenisDenganSoD = jenis === "expense" || jenis === "purchase";
    if (jenisDenganSoD && doc.createdById === user.id && !hasPermission(user, P.FINANCE_ADMIN)) {
      bolehSetuju = false;
      alasanSetuju = "Pengajuan Anda sendiri harus disetujui orang lain.";
    }
    if (bolehSetuju && syarat && !syarat.terpenuhi) {
      bolehSetuju = false;
      alasanSetuju = syarat.pesan;
    }
  }
  return {
    setujui: { boleh: bolehSetuju, alasan: bolehSetuju ? null : alasanSetuju, ...base("approve") },
    tolak: { boleh: bolehTolak, alasan: bolehTolak ? null : alasanTolak, alasanWajib: true, ...base("reject") },
  };
}

/** Syarat bukti (nota) yang akan ditagih backend saat menyetujui — dihitung dengan fungsi yang SAMA. */
async function syaratBukti(db, jenis, doc) {
  if (jenis !== "expense" && jenis !== "purchase") return { terpenuhi: true, pesan: null };
  if (doc.receiptUrl) return { terpenuhi: true, pesan: null };
  const wajib = await notaWajib(db, { jenis, mode: doc.mode, amount: doc.amount, categoryCode: doc.category?.code });
  if (!wajib) return { terpenuhi: true, pesan: null };
  return {
    terpenuhi: false,
    pesan: jenis === "purchase"
      ? "Pembelian wajib punya foto nota sebelum disetujui."
      : "Pengeluaran ini wajib punya foto nota sebelum disetujui.",
  };
}

function pihakDari(jenis, doc) {
  if (jenis === "bill") return doc.supplier?.name ?? null;
  if (jenis === "refund") return doc.order?.customer?.name ?? null;
  return doc.supplier?.name ?? doc.payeeName ?? doc.reimburseTo?.name ?? null;
}

export async function normalisasi(db, jenis, doc, user, { denganSyarat = true } = {}) {
  const tahap = tahapDari(jenis, doc.status);
  const syarat = denganSyarat ? await syaratBukti(db, jenis, doc) : null;
  const diajukan = diajukanPada(doc);
  const diputuskan = ["DISETUJUI", "DIBAYAR", "DIBAYAR_SEBAGIAN", "LUNAS", "DITOLAK"].includes(doc.status) ? doc.approvedBy ?? null : null;
  return {
    kunci: `${jenis}:${doc.id}`,
    id: doc.id,
    jenis,
    jenisLabel: LABEL_JENIS[jenis],
    nomor: doc[KOLOM_NOMOR[jenis]],
    tanggal: new Date(doc[KOLOM_TANGGAL[jenis]]).toISOString().slice(0, 10),
    diajukanPada: new Date(diajukan).toISOString(),
    umurHari: umurHari(diajukan),
    pemohon: doc.createdBy ? { id: doc.createdBy.id, name: doc.createdBy.name } : null,
    nominal: moneyToNumber(doc.amount),
    keterangan: (jenis === "refund" ? doc.reason : doc.description) ?? "",
    kategori: doc.category?.name ?? null,
    rekening: doc.cashAccount?.name ?? null,
    pihak: pihakDari(jenis, doc),
    nomorOrder: doc.order?.orderNumber ?? null,
    mode: doc.mode ?? null,
    status: doc.status,
    statusLabel: LABEL_STATUS[doc.status] ?? doc.status,
    tahap,
    adaLampiran: !!(doc.receiptUrl || doc.attachmentUrl),
    alasanTolak: doc.rejectReason ?? null,
    diputuskanOleh: diputuskan ? { id: diputuskan.id, name: diputuskan.name } : null,
    diputuskanPada: doc.approvedAt ? new Date(doc.approvedAt).toISOString() : null,
    syarat: syarat && !syarat.terpenuhi ? { terpenuhi: false, pesan: syarat.pesan } : null,
    aksi: hitungAksi(jenis, doc, user, { syarat }),
  };
}

function parseJenis(v) {
  if (!v) return JENIS_LIST;
  const daftar = String(v).split(",").map((s) => s.trim()).filter((s) => JENIS_LIST.includes(s));
  return daftar.length ? daftar : JENIS_LIST;
}

/** Daftar terpaginasi satu tab + jumlah semua tab (menghormati filter kecuali tab). */
export async function daftarPersetujuan(db, user, opsi = {}) {
  const tab = TAB_LIST.includes(opsi.tab) ? opsi.tab : "MENUNGGU";
  const jenisDipilih = parseJenis(opsi.jenis);
  const limit = Math.min(Math.max(parseInt(opsi.limit, 10) || 20, 1), 50);
  const page = Math.max(parseInt(opsi.page, 10) || 1, 1);
  const skip = (page - 1) * limit;
  const filter = { from: opsi.from, to: opsi.to, pemohonId: opsi.pemohonId || null, q: opsi.q };

  const hasilPerJenis = await Promise.all(jenisDipilih.map(async (jenis) => {
    const model = db[MODEL[jenis]];
    const statuses = statusUntukTahap(jenis, tab);
    const grup = await model.groupBy({ by: ["status"], where: bangunWhere(jenis, { ...filter, statuses: semuaStatus(jenis) }), _count: { _all: true } });
    const hitung = { MENUNGGU: 0, DIPROSES: 0, DISETUJUI: 0, DITOLAK: 0 };
    for (const g of grup) {
      const t = tahapDari(jenis, g.status);
      if (t) hitung[t] += g._count._all;
    }
    const baris = statuses.length === 0 || hitung[tab] === 0 ? [] : await model.findMany({
      where: bangunWhere(jenis, { ...filter, statuses }),
      orderBy: urutan(jenis, tab),
      take: skip + limit,
      include: INCLUDE[jenis],
    });
    return { jenis, hitung, baris };
  }));

  const hitung = { MENUNGGU: 0, DIPROSES: 0, DISETUJUI: 0, DITOLAK: 0 };
  for (const h of hasilPerJenis) for (const t of TAB_LIST) hitung[t] += h.hitung[t];

  const gabung = hasilPerJenis.flatMap((h) => h.baris.map((doc) => ({ jenis: h.jenis, doc })));
  const arah = tab === "MENUNGGU" ? 1 : -1;
  gabung.sort((a, b) => {
    const d = new Date(diajukanPada(a.doc)).getTime() - new Date(diajukanPada(b.doc)).getTime();
    return d !== 0 ? d * arah : String(a.doc.id).localeCompare(String(b.doc.id));
  });
  const halaman = gabung.slice(skip, skip + limit);
  const items = [];
  for (const { jenis, doc } of halaman) items.push(await normalisasi(db, jenis, doc, user));

  const total = hitung[tab];
  return { items, tab, page, limit, total, adaLagi: skip + items.length < total, hitung };
}

/** Jumlah yang menunggu (untuk lencana) — tanpa filter. */
export async function ringkasanMenunggu(db) {
  const hitung = await Promise.all(JENIS_LIST.map((j) => db[MODEL[j]].count({ where: { status: "MENUNGGU_APPROVAL" } })));
  const perJenis = Object.fromEntries(JENIS_LIST.map((j, i) => [j, hitung[i]]));
  return { menunggu: hitung.reduce((a, b) => a + b, 0), perJenis };
}

/** Pemohon yang pernah mengajukan dokumen ber-approval (untuk filter). */
export async function pilihanPemohon(db) {
  const hasil = await Promise.all(JENIS_LIST.map((j) => db[MODEL[j]].findMany({
    where: { status: { in: semuaStatus(j) }, createdById: { not: null } },
    distinct: ["createdById"],
    select: { createdBy: orangSaya },
  })));
  const peta = new Map();
  for (const baris of hasil) for (const r of baris) if (r.createdBy) peta.set(r.createdBy.id, r.createdBy.name);
  return [...peta.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "id"));
}

// ── Detail ────────────────────────────────────────────────────────────────────────────────

const LABEL_PERISTIWA = {
  DOCUMENT_APPROVED: "Disetujui", DOCUMENT_REJECTED: "Ditolak", DOCUMENT_CANCELLED: "Dibatalkan", DOCUMENT_POSTED: "Dibukukan",
  DOCUMENT_CORRECTED: "Dikoreksi", DOCUMENT_EDITED: "Diubah",
};

function fileDariUrl(url) {
  const s = String(url || "").split("?")[0];
  if (!s.startsWith(`${RECEIPTS_URL_PREFIX}/`)) return null;
  const file = s.slice(RECEIPTS_URL_PREFIX.length + 1);
  return FILE_PATTERN.test(file) ? file : null;
}

/** Lampiran → tautan bertanda-tangan berumur pendek. Tautan luar/format lain TIDAK diproksikan (hanya diberi tanda). */
export function bangunLampiran(doc) {
  const url = doc.receiptUrl || doc.attachmentUrl;
  if (!url) return [];
  const file = fileDariUrl(url);
  if (!file) return [{ id: "lampiran-1", jenis: "tautan", url: null, thumbUrl: null, kedaluwarsa: null }];
  const thumb = file.replace(/\.jpg$/, "_t.jpg");
  const a = signFile(file);
  const b = signFile(thumb);
  return [{
    id: file, jenis: "foto",
    url: `${RECEIPTS_URL_PREFIX}/${file}?exp=${a.exp}&sig=${a.sig}`,
    thumbUrl: `${RECEIPTS_URL_PREFIX}/${thumb}?exp=${b.exp}&sig=${b.sig}`,
    kedaluwarsa: new Date(Date.now() + MEDIA_SIGN_TTL_SECONDS * 1000).toISOString(),
  }];
}

async function bangunRiwayat(db, jenis, doc) {
  const events = await db.activityEvent.findMany({
    where: { entityType: ENTITY[jenis], entityId: doc.id }, orderBy: { createdAt: "asc" }, take: 100,
  });
  const idPelaku = [...new Set(events.map((e) => e.actorId).filter(Boolean))];
  const pelaku = idPelaku.length ? await db.user.findMany({ where: { id: { in: idPelaku } }, select: { id: true, name: true } }) : [];
  const namaPelaku = new Map(pelaku.map((u) => [u.id, u.name]));

  const riwayat = [{
    waktu: new Date(diajukanPada(doc)).toISOString(), peristiwa: "DIAJUKAN", label: "Diajukan", oleh: doc.createdBy?.name ?? null, catatan: null,
  }];
  for (const e of events) {
    const md = e.metadata && typeof e.metadata === "object" ? e.metadata : {};
    let catatan = typeof md.reason === "string" ? md.reason : null;
    if (md.menyetujuiPengajuanSendiri) catatan = "Disetujui oleh pembuat dokumen (pengecualian admin).";
    riwayat.push({
      waktu: new Date(e.createdAt).toISOString(), peristiwa: e.eventType, label: LABEL_PERISTIWA[e.eventType] ?? "Aktivitas",
      oleh: e.actorId ? namaPelaku.get(e.actorId) ?? null : null, catatan,
    });
  }
  if (doc.paidAt) {
    riwayat.push({ waktu: new Date(doc.paidAt).toISOString(), peristiwa: "DIBAYAR", label: "Dibayar", oleh: doc.paidBy?.name ?? null, catatan: null });
  }
  return riwayat.sort((a, b) => new Date(a.waktu) - new Date(b.waktu));
}

/** Detail lengkap satu item. null bila tidak ada / bukan dokumen inbox (draf, dibatalkan). */
export async function detailPersetujuan(db, user, jenis, id) {
  if (!JENIS_LIST.includes(jenis)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const doc = await db[MODEL[jenis]].findUnique({ where: { id }, include: INCLUDE[jenis] });
  if (!doc || !tahapDari(jenis, doc.status)) return null;

  const item = await normalisasi(db, jenis, doc, user);
  const rincian = {
    ...(doc.division && { divisi: doc.division }),
    ...(doc.notes && { catatan: doc.notes }),
    ...(jenis === "bill" && {
      nomorFakturSupplier: doc.supplierRef ?? null,
      jatuhTempo: doc.dueDate ? new Date(doc.dueDate).toISOString().slice(0, 10) : null,
    }),
    ...(doc.paidAt && { dibayarPada: new Date(doc.paidAt).toISOString(), dibayarOleh: doc.paidBy?.name ?? null }),
    ...((jenis === "expense" || jenis === "purchase") && { buktiTerverifikasi: !!doc.receiptVerifiedAt }),
    ...(doc.reimburseTo && { diganti: doc.reimburseTo.name }),
  };
  return { ...item, rincian, lampiran: bangunLampiran(doc), riwayat: await bangunRiwayat(db, jenis, doc) };
}
