// Penyusun isi PANEL DETAIL untuk tiap jenis daftar Finance. Murni fungsi: menerima baris yang SUDAH dimuat daftar dan mengembalikan
// spec untuk <PanelDetail>. Nilai kosong otomatis disembunyikan panel. Semua teks Bahasa Indonesia.
import React from "react";
import { LABEL_DIVISI, formatUang, tanggalPendek, tanggalJam, Foto } from "./shared.jsx";
import { LinkBukti } from "./receiptMedia.jsx";
import { LABEL_METODE_PJK } from "./penjualanKaryawanLogic.js";

const uang = (v) => (v === null || v === undefined ? null : formatUang(v));
const nama = (o) => o?.name || null;
const ada = (v) => (v ? "Ada" : null);

const LABEL_MODE = { LANGSUNG: "Bayar langsung", REIMBURSEMENT: "Reimbursement (ditalangi karyawan)", UTANG: "Utang ke pihak ketiga" };
const LABEL_METODE_BAYAR = { TUNAI: "Tunai", TRANSFER: "Transfer", CASH: "Tunai", QRIS: "QRIS", CARD: "Kartu" };
const LABEL_STATUS_DOK = {
  DRAFT: "Draf", MENUNGGU_APPROVAL: "Menunggu persetujuan", DISETUJUI: "Disetujui", DIBAYAR: "Dibayar", DITOLAK: "Ditolak", DIBATALKAN: "Dibatalkan",
  AKTIF: "Aktif", LUNAS: "Lunas",
};
const TAMPIL_TANGGAL = (v) => (v ? tanggalJam(v) : null);

function bagianJejak(d) {
  return {
    judul: "Jejak proses",
    baris: [
      ["Dibuat oleh", nama(d.createdBy)], ["Dibuat pada", TAMPIL_TANGGAL(d.createdAt)],
      ["Diajukan", TAMPIL_TANGGAL(d.submittedAt)],
      ["Disetujui oleh", nama(d.approvedBy)], ["Disetujui pada", TAMPIL_TANGGAL(d.approvedAt)],
      ["Dibayar oleh", nama(d.paidBy)], ["Dibayar pada", TAMPIL_TANGGAL(d.paidAt)],
      ["Alasan ditolak", d.rejectReason],
      ["Nota diverifikasi", d.receiptVerifiedAt ? `${nama(d.receiptVerifiedBy) || "—"} · ${TAMPIL_TANGGAL(d.receiptVerifiedAt)}` : null],
    ],
  };
}

/** Rincian biaya admin transfer untuk panel detail: tiga baris (nominal, biaya admin, total keluar rekening) hanya bila ada biaya. Daftar menampilkan TOTAL; di sini rinciannya. */
export function barisBiayaAdminPanel(d) {
  const admin = Number(d?.biayaAdmin ?? d?.transferFeeAmount ?? d?.feeAmount ?? 0);
  if (!(admin > 0)) return [];
  const nominal = Number(d?.nominalDiterima ?? d?.amount ?? 0);
  return [
    ["Nominal (diterima penerima)", formatUang(nominal)],
    ["Biaya admin transfer", formatUang(admin)],
    ["Total keluar rekening", formatUang(d?.totalKeluarRekening ?? nominal + admin)],
  ];
}

function bagianUangKeluar(d) {
  return {
    judul: "Pembayaran",
    baris: [
      ["Cara bayar", LABEL_MODE[d.mode] || d.mode],
      ["Metode", d.paymentMethod ? (LABEL_METODE_BAYAR[d.paymentMethod] || d.paymentMethod) : null],
      ["Sumber dana", nama(d.cashAccount)],
      ...barisBiayaAdminPanel(d),
      ["Ditalangi oleh", nama(d.reimburseTo)],
      ["Dibayar ke", nama(d.supplier) || d.payeeName],
    ],
  };
}

export function specPengeluaran(e, { badge, aksi } = {}) {
  return {
    judul: e.expenseNumber, subjudul: e.description, badge, aksi,
    ringkas: [["Nominal", formatUang(e.amount)], ["Status", LABEL_STATUS_DOK[e.status] || e.status, e.status === "DIBAYAR" ? "hijau" : e.status === "DITOLAK" || e.status === "DIBATALKAN" ? "merah" : "oranye"]],
    bagian: [
      { judul: "Dokumen", baris: [["Tanggal", tanggalPendek(e.date)], ["Kategori", nama(e.category)], ["Divisi", LABEL_DIVISI[e.division] || e.division], ["Order terkait", e.order?.orderNumber], ["Uang muka dipakai", Number(e.advanceAppliedAmount) > 0 ? formatUang(e.advanceAppliedAmount) : null], ["No. uang muka", e.advance?.advanceNumber]] },
      bagianUangKeluar(e),
      { judul: "Bukti & catatan", baris: [["Nota / bukti", ada(e.receiptUrl)], ["Nota wajib", e.notaWajib && !e.receiptUrl ? "Ya — belum dilampirkan" : null], ["Catatan", e.notes]] },
      bagianJejak(e),
    ],
  };
}

export function specPembelian(p, { badge, aksi } = {}) {
  return {
    judul: p.purchaseNumber, subjudul: p.description, badge, aksi,
    ringkas: [["Nominal", formatUang(p.amount)], ["Status", LABEL_STATUS_DOK[p.status] || p.status, p.status === "DIBAYAR" ? "hijau" : p.status === "DITOLAK" || p.status === "DIBATALKAN" ? "merah" : "oranye"]],
    bagian: [
      { judul: "Dokumen", baris: [["Tanggal", tanggalPendek(p.date)], ["Kategori", nama(p.category)], ["Divisi", LABEL_DIVISI[p.division] || p.division]] },
      bagianUangKeluar(p),
      {
        judul: "Uang muka (DP) pembelian",
        baris: [
          ["DP diterapkan", p.dpDiterapkan != null ? formatUang(p.dpDiterapkan) : null], ["Sisa utang", p.dpDiterapkan != null ? formatUang(p.sisaUtang) : null],
          ["DP sudah dipakai", p.dpDigunakan != null ? formatUang(p.dpDigunakan) : null], ["DP masih tersedia", p.dpDigunakan != null ? formatUang(p.dpTersedia) : null],
        ],
      },
      { judul: "Bukti & catatan", baris: [["Nota / bukti", ada(p.receiptUrl)], ["Catatan", p.notes]] },
      bagianJejak(p),
    ],
  };
}

export function specKasbon(k, { badge, aksi } = {}) {
  const riwayat = (k.repayments || []).filter((r) => !r.cancelledAt);
  return {
    judul: k.kasbonNumber, subjudul: `Kasbon ${k.employeeName}`, badge, aksi,
    ringkas: [
      ["Nominal kasbon", formatUang(k.amount)],
      ["Belum dipotong", formatUang(k.sisa ?? 0), Number(k.sisa) > 0 ? "oranye" : "hijau"],
    ],
    bagian: [
      { judul: "Kasbon", baris: [["Karyawan", k.employeeName], ["Tanggal", tanggalPendek(k.date)], ["Status", LABEL_STATUS_DOK[k.status] || k.status], ["Alasan / urgensi", k.urgency], ["Sudah dipotong", uang(k.terlunasi)], ["Catatan", k.notes], ["Sumber lama", k.historis ? "Data historis (impor)" : null]] },
      { judul: "Uang keluar", baris: [["Sumber dana", nama(k.cashAccount)], ...barisBiayaAdminPanel(k), ["Metode", k.paymentMethod ? (LABEL_METODE_BAYAR[k.paymentMethod] || k.paymentMethod) : null], ["Bukti", ada(k.receiptUrl)]] },
      ...(riwayat.length > 0 ? [{ judul: `Potongan gaji (${riwayat.length})`, baris: riwayat.map((r, i) => [`${i + 1}. ${tanggalPendek(r.date)}`, `${formatUang(r.amount)}${r.notes ? ` — ${r.notes}` : ""}`]) }] : []),
      { judul: "Jejak", baris: [["Dibuat oleh", nama(k.createdBy)], ["Dibuat pada", TAMPIL_TANGGAL(k.createdAt)], ["Dibatalkan", k.cancelledAt ? `${TAMPIL_TANGGAL(k.cancelledAt)}${k.cancelReason ? ` — ${k.cancelReason}` : ""}` : null]] },
    ],
  };
}

export function specMutasiRekening(b, { rekening, badge, aksi } = {}) {
  const masuk = !!b.masuk;
  return {
    judul: b.nomor, subjudul: `${masuk ? "Uang masuk ke" : "Uang keluar dari"} ${rekening || "rekening"}`, badge, aksi,
    ringkas: [
      [masuk ? "Uang masuk" : "Uang keluar", formatUang(b.masuk || b.keluar), masuk ? "hijau" : "oranye"],
      ["Saldo setelah transaksi", formatUang(b.saldo)],
    ],
    bagian: [
      { judul: "Transaksi", baris: [["Tanggal buku", tanggalPendek(b.tanggalBuku ?? b.tanggal)], ["Keterangan", b.keterangan], ["Akun lawan", b.lawan], ["Sumber", b.sumberLabel], ["Dokumen", b.dokumen?.nomor], ["Status jurnal", LABEL_STATUS_DOK[b.status] || (b.status === "REVERSED" ? "Sudah dibalik" : b.status === "POSTED" ? "Terposting" : b.status)], ["Membalik jurnal", b.membalik]] },
      // Empat tanggal yang tidak boleh dicampur: tanggal buku (di jurnal), kapan diinput, tanggal bank & efektif (dari rekening koran yang dicocokkan).
      { judul: "Waktu & pencatat", baris: [["Dibuat pada", b.dibuatPada ? tanggalJam(b.dibuatPada) : null], ["Dibuat oleh", b.aktor], ["Diinput setelah tanggal bukunya", b.dibuatSetelahTanggalBuku ? "Ya (jurnal mundur)" : null], ["Tanggal bank", b.tanggalBank ? tanggalPendek(b.tanggalBank) : null], ["Tanggal efektif", b.tanggalEfektif ? tanggalPendek(b.tanggalEfektif) : null], ["Pencocokan bank", { COCOK_OTOMATIS: "Cocok otomatis", COCOK_MANUAL: "Cocok manual", DIKECUALIKAN: "Dikecualikan" }[b.statusCocok] || "Belum dicocokkan"]] },
    ],
  };
}

export function specPengecualianLunas(p, { badge, aksi } = {}) {
  const tgl = (v) => (v ? TAMPIL_TANGGAL(v) : null);
  return {
    judul: p.order.nomor, subjudul: `Pengecualian tanggal lunas — ${p.order.pelanggan || "pelanggan"}`, badge, aksi,
    ringkas: [
      ["Nilai order", formatUang(p.order.nilai)],
      ["Lunas dikunci", tgl(p.paidAtDikunci) || "—", p.aktif ? "hijau" : undefined],
    ],
    bagian: [
      { judul: "Keputusan", baris: [["Alasan", p.alasan], ["Dibuat oleh", p.dibuatOleh], ["Dibuat pada", tgl(p.dibuatPada)], ["Tanggal lunas sebelum dikunci", tgl(p.paidAtAsli)]] },
      { judul: "Order saat ini", baris: [["Status bayar", p.order.statusBayar], ["Tanggal lunas sekarang", tgl(p.order.paidAtSekarang)], ["Penjaga", p.aktif ? (p.konsisten ? "Bekerja (tanggal sesuai yang dikunci)" : "PERLU DICEK: tanggal berbeda dari yang dikunci") : null]] },
      ...(p.aktif ? [] : [{ judul: "Pencabutan", baris: [["Dicabut oleh", p.dicabutOleh], ["Dicabut pada", tgl(p.dicabutPada)], ["Alasan mencabut", p.alasanDicabut]] }]),
    ],
  };
}

export function specPenjualanKaryawan(p, { badge, aksi } = {}) {
  const bayar = (p.payments || []).filter((x) => !x.cancelledAt);
  return {
    judul: p.nomor, subjudul: `Penjualan ${p.seller?.name || "karyawan"} → ${p.buyerName}`, badge, aksi,
    ringkas: [
      ["Total penjualan", formatUang(p.total)],
      ["Sisa tagihan ke karyawan", formatUang(p.sisa ?? 0), Number(p.sisa) > 0 ? "oranye" : "hijau"],
    ],
    bagian: [
      { judul: "Penjualan", baris: [["Tanggal", tanggalPendek(p.date)], ["Karyawan penjual", nama(p.seller)], ["Pembeli", p.buyerName], ["Sudah dibayar", uang(p.terbayar)], ["Catatan", p.notes]] },
      { judul: `Item (${(p.items || []).length})`, baris: (p.items || []).map((i) => [i.name, `${i.quantity} × ${formatUang(i.unitPrice)} = ${formatUang(i.subtotal)}`]) },
      ...(bayar.length > 0 ? [{ judul: `Pembayaran (${bayar.length})`, baris: bayar.map((x, i) => [`${i + 1}. ${tanggalPendek(x.date)}`, `${formatUang(x.amount)} · ${LABEL_METODE_PJK[x.method] || x.method}${x.cashAccount ? ` ke ${x.cashAccount.name}` : ""}${x.notes ? ` — ${x.notes}` : ""}`]) }] : []),
      { judul: "Jejak", baris: [["Dibuat oleh", nama(p.createdBy)], ["Dibuat pada", TAMPIL_TANGGAL(p.createdAt)], ["Dibatalkan", p.cancelledAt ? `${TAMPIL_TANGGAL(p.cancelledAt)}${p.cancelReason ? ` — ${p.cancelReason}` : ""}` : null]] },
    ],
  };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// PENYUSUN OTOMATIS — untuk daftar yang belum punya penyusun khusus. Membaca isi baris, memberi label Indonesia, memformat uang/tanggal,
// dan menyembunyikan kolom teknis (id, alokasi internal, menu aksi). Bukan pengganti penyusun khusus, tetapi menjamin SETIAP baris bisa dibuka.
import { StatusBadge } from "./shared.jsx";

const LABEL_KOLOM = {
  date: "Tanggal", tanggal: "Tanggal", dueDate: "Jatuh tempo", jatuhTempo: "Jatuh tempo", createdAt: "Dibuat pada", updatedAt: "Diubah pada", paidAt: "Dibayar pada",
  approvedAt: "Disetujui pada", cancelledAt: "Dibatalkan pada", verifiedAt: "Diverifikasi pada",
  amount: "Nominal", nominal: "Nominal", saldo: "Saldo", total: "Total", sisa: "Sisa", dibayar: "Sudah dibayar", terbayar: "Sudah dibayar", outstanding: "Sisa",
  description: "Keterangan", keterangan: "Keterangan", notes: "Catatan", catatan: "Catatan", purpose: "Tujuan", alasan: "Alasan", reason: "Alasan",
  status: "Status", statusLabel: "Status", mode: "Cara bayar", division: "Divisi", category: "Kategori", kategori: "Kategori", kategoriLabel: "Kategori",
  holder: "Pemegang", pemegang: "Pemegang", supplier: "Supplier", customer: "Pelanggan", pelanggan: "Pelanggan", sales: "Sales", pihak: "Pihak",
  cashAccount: "Rekening", rekening: "Rekening", bank: "Bank", accountNumber: "No. rekening", accountName: "Atas nama", bankName: "Bank",
  order: "Order", orderNumber: "No. order", invoiceNumber: "No. faktur", billNumber: "No. tagihan", paymentNumber: "No. pembayaran", refundNumber: "No. refund",
  advanceNumber: "No. uang muka", expenseNumber: "No. pengeluaran", entryNumber: "No. jurnal", nomor: "Nomor",
  dipertanggungjawabkan: "Dipertanggungjawabkan", dikembalikan: "Dikembalikan", lewatTempo: "Lewat tempo",
  method: "Cara bayar", metode: "Cara bayar", referenceNumber: "No. referensi", debit: "Debit", credit: "Kredit", kredit: "Kredit",
  receiptUrl: "Bukti", proofPhotoUrl: "Bukti", umur: "Umur (hari)", ember: "Kelompok umur",
  name: "Nama", phone: "Telepon", email: "Email", address: "Alamat", kind: "Jenis", jenis: "Jenis", source: "Sumber", sumber: "Sumber", sumberLabel: "Sumber",
  payeeName: "Penerima", createdBy: "Dibuat oleh", approvedBy: "Disetujui oleh", paidBy: "Dibayar oleh", recordedBy: "Dicatat oleh", cancelledBy: "Dibatalkan oleh",
  transferFeeAmount: "Biaya admin transfer", paymentMethod: "Metode", biayaAdmin: "Biaya admin transfer", nominalDiterima: "Nominal (diterima penerima)", totalKeluarRekening: "Total keluar rekening", feeAmount: "Biaya admin transfer", fromAccount: "Dari rekening", toAccount: "Ke rekening", transferNumber: "No. transfer",
};
const UANG = /(amount|nominal|saldo|total|harga|nilai|debit|credit|kredit|sisa|dibayar|terbayar|dipertanggungjawabkan|dikembalikan|fee|biaya|outstanding|piutang|utang|refund|diterima|tagihan|umurPiutang)/i;
const KECUALI = /(^id$|Id$|Ids$|^key$|^lineId$|sortOrder|^menu|^aksi|^bentuk|^_|repayments|allocations|Allocations|lines|^items$|^perStatus$|thumbUrl|tautan$|version|^versi|replaces|replacedBy|^lewatTempo$)/;
const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?$/;

const manusia = (k) => LABEL_KOLOM[k] || String(k).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
const teksStatus = (v) => LABEL_STATUS_DOK[v] || String(v).toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function nilaiOtomatis(k, v) {
  if (v === null || v === undefined || v === "" || v === false) return null;
  if (v === true) return "Ya";
  if (typeof v === "number") return UANG.test(k) ? formatUang(v) : String(v);
  if (typeof v === "string") {
    if (ISO.test(v)) return v.length > 10 ? tanggalJam(v) : tanggalPendek(v);
    if (/^(\/media\/|https?:\/\/)/.test(v)) return "Ada";
    if (/^[A-Z][A-Z0-9_]+$/.test(v) && v.length > 2) return teksStatus(v);
    return v;
  }
  if (Array.isArray(v)) return v.length ? `${v.length} data` : null;
  if (typeof v === "object") {
    const t = v.name ?? v.orderNumber ?? v.advanceNumber ?? v.invoiceNumber ?? v.billNumber ?? v.expenseNumber ?? v.kasbonNumber ?? v.code ?? v.label ?? null;
    return t ? String(t) : null;
  }
  return String(v);
}

const KANDIDAT_NOMOR = ["transferNumber", "expenseNumber", "purchaseNumber", "kasbonNumber", "advanceNumber", "billNumber", "paymentNumber", "refundNumber", "invoiceNumber", "entryNumber", "orderNumber", "nomor", "name", "code"];
const KANDIDAT_SUB = ["keterangan", "description", "purpose", "pihak", "customerName", "pelanggan", "supplierName", "name", "notes"];

/**
 * Rincian otomatis dari satu baris. `opsi`: { judul, subjudul, badge, ringkas, sembunyi: [kolom], label: { kolom: "Label" }, urut: [kolom prioritas] }.
 */
export function specOtomatis(row, opsi = {}) {
  const r = row || {};
  const pilih = (daftar) => { for (const k of daftar) { const t = nilaiOtomatis(k, r[k]); if (t) return String(t); } return null; };
  const judul = opsi.judul ?? pilih(KANDIDAT_NOMOR) ?? "Detail";
  const subjudul = opsi.subjudul ?? pilih(KANDIDAT_SUB);
  const sembunyi = new Set(opsi.sembunyi || []);
  // Ada biaya admin transfer: tampilkan tiga baris rincian (nominal, biaya admin, total keluar rekening) di awal dan sembunyikan kolom mentahnya agar tidak ganda.
  const rincianBiaya = barisBiayaAdminPanel(r);
  if (rincianBiaya.length) for (const k of ["transferFeeAmount", "feeAmount", "nominalDiterima", "biayaAdmin", "totalKeluarRekening", "amount"]) sembunyi.add(k);
  const urut = opsi.urut || [];
  const kunci = [...urut.filter((k) => k in r), ...Object.keys(r).filter((k) => !urut.includes(k))];
  const baris = [...rincianBiaya];
  for (const k of kunci) {
    if (sembunyi.has(k) || KECUALI.test(k)) continue;
    const t = nilaiOtomatis(k, r[k]);
    if (t === null) continue;
    if (t === judul || (k === "description" && t === subjudul)) continue;
    baris.push([(opsi.label && opsi.label[k]) || manusia(k), t]);
  }
  const badge = opsi.badge ?? (typeof r.status === "string" ? React.createElement(StatusBadge, { status: r.status }) : undefined);
  return { judul, subjudul, badge, ringkas: opsi.ringkas, aksi: opsi.aksi, bagian: [{ baris }] };
}

/** Rincian satu Payment pelanggan (daftar Pembayaran & Verifikasi). */
export function specPembayaran(p, { badge, aksi } = {}) {
  const v = p.verifications?.[0];
  return {
    judul: p.order?.orderNumber || "Pembayaran", subjudul: p.order?.customer?.name, badge, aksi,
    ringkas: [["Nominal", formatUang(p.amount)], ["Jenis", p.jenisPembayaran ? ({ DP: "DP (uang muka)", CICILAN: "Cicilan", PELUNASAN: "Pelunasan" })[p.jenisPembayaran] : "—", p.jenisPembayaran === "PELUNASAN" ? "hijau" : undefined]],
    bagian: [
      { judul: "Pembayaran", baris: [["Diterima", tanggalJam(p.createdAt)], ["Metode", LABEL_METODE_BAYAR[p.method] || p.method], ["Masuk ke rekening", nama(p.cashAccount) || "Rekening standar cara bayar"], ["Nomor referensi", p.referenceNumber], ["Dibagi ke order", p.finAllocations?.length ? p.finAllocations.map((a) => `${a.order?.orderNumber}: ${formatUang(a.amount)}`).join("; ") : null]] },
      { judul: "Verifikasi", baris: [["Status", p.cancelledAt ? (p.replacedBy ? "Diganti versi baru" : "Dibatalkan") : v ? "Sudah diverifikasi" : "Menunggu verifikasi"], ["Dicatat oleh", nama(p.recordedBy)], ["Diverifikasi oleh", v ? `${nama(v.verifiedBy) || "—"} · ${tanggalJam(v.createdAt)}` : null], ["Alasan pembatalan", p.cancelReason]] },
      { judul: "Bukti & catatan", baris: [["Bukti", galeriBukti(p)], ["Catatan", p.notes], ["Keterangan internal", p.internalNote]] },
    ],
  };
}

/** Semua foto bukti pembayaran sebagai thumbnail (klik = buka penuh). Null bila tidak ada foto. */
function galeriBukti(p) {
  const urls = p.proofPhotoUrls?.length ? p.proofPhotoUrls : p.proofPhotoUrl ? [p.proofPhotoUrl] : [];
  if (urls.length === 0) return null;
  return React.createElement(
    "div", { className: "flex flex-wrap gap-2" },
    urls.map((u, i) => React.createElement(
      LinkBukti, { key: u, url: u, className: "block h-14 w-14 overflow-hidden rounded-lg border border-line", "aria-label": `Bukti ${i + 1}` },
      React.createElement(Foto, { url: u, className: "h-full w-full object-cover" }),
    )),
  );
}
