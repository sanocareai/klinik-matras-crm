// KOREKSI PENGAKUAN PENDAPATAN PER DOKUMEN (Okt 2026) — order yang sudah DISERAHKAN tetapi pendapatannya belum masuk buku besar (tanpa gap) dan order bernilai Rp0 (gap NILAI_ORDER_NOL).
//
// ATURAN TEGAS (permintaan Owner):
//  • TIDAK menebak harga, tanggal, atau nilai. Harga hanya dari orang (Finance Admin) + bukti; tanggal pengakuan hanya dari bukti serah (POD / riwayat status) atau KEPUTUSAN OWNER bertanggal + bukti.
//  • TIDAK ada posting massal: satu order = satu permintaan, PIN step-up + alasan tertulis + Idempotency-Key.
//  • Memakai mesin pengakuan YANG SAMA dengan alur otomatis (postRevenueRecognition: Dr Piutang / Cr Pendapatan [+ ongkir], uang muka dipindah jadi pelunasan) — bukan jurnal rakitan sendiri.
//  • Idempoten (kunci jurnal PENGAKUAN_PENDAPATAN:<order>), atomik (jurnal + gap + audit satu transaksi), terkunci per order (advisory lock + row lock), menghormati periode tertutup.
//  • PEMBALIKAN AMAN: hanya bila tidak ada transaksi lain yang bergantung pada piutang order itu; jurnal balik resmi (dimensi dibawa) bertanggal hari ini, periode asal & hari ini harus terbuka.
//  • Tanggal pengakuan TIDAK BOLEH sebelum tanggal cutoff saldo awal (buku besar mulai di situ). Order yang diserahkan SEBELUM cutoff ditahan: pendapatannya tercakup riwayat sebelum sistem;
//    mengakuinya di periode berjalan butuh persetujuan eksplisit per dokumen (akuiPraCutoff) karena menaikkan pendapatan periode itu.
//  • Order "Lunas" tanpa catatan pembayaran DITAHAN (tidak ada override): mengakuinya menciptakan piutang untuk uang yang dianggap sudah lunas.

import { STATUS_PENGAKUAN, KEY as KEY_PENDAPATAN, postRevenueRecognition } from "../posting/orderRevenue.js";
import { STATUS_DIHITUNG, reverseJournal, todayBookDateWIB } from "../journal.js";
import { tanggalCutoff, tanggalWIB } from "../cutoff.js";
import { toMoney, sumMoney, moneyToNumber } from "../money.js";
import { nilaiBersihPerOrder } from "../../orderNilaiBersih.js";
import { lockRowForUpdate } from "../../inventoryLedger.js";
import { KoreksiError, PratinjauKoreksi } from "../koreksiGate.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../../lib/activityLog.js";

const rp = (d) => moneyToNumber(d);
const POLA_TGL = /^\d{4}-\d{2}-\d{2}$/;
const tglKalenderValid = (v) => POLA_TGL.test(String(v || "")) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export const DASAR_TANGGAL = Object.freeze({
  TANGGAL_SERAH_POD: "TANGGAL_SERAH_POD",
  TANGGAL_STATUS_DISERAHKAN: "TANGGAL_STATUS_DISERAHKAN",
  KEPUTUSAN_OWNER: "KEPUTUSAN_OWNER",
});
export const LABEL_DASAR = Object.freeze({
  TANGGAL_SERAH_POD: "Tanggal serah (pengiriman selesai di Delivery)",
  TANGGAL_STATUS_DISERAHKAN: "Tanggal status order menjadi diserahkan",
  KEPUTUSAN_OWNER: "Keputusan Owner (tanggal + bukti)",
});

export const KODE_TAHAN = Object.freeze({
  SUDAH_DIAKUI: "SUDAH_DIAKUI", PKR: "PENJUALAN_KARYAWAN", DIGABUNG: "ORDER_DIGABUNG", BELUM_DISERAHKAN: "STATUS_BELUM_DISERAHKAN", NILAI_NOL: "NILAI_ORDER_NOL",
  LUNAS_TANPA_PEMBAYARAN: "LUNAS_TANPA_PEMBAYARAN", DIBALIK: "PENGAKUAN_DIBALIK_SENGAJA", PRA_CUTOFF: "DISERAHKAN_SEBELUM_CUTOFF", SERAH_TIDAK_TERBUKTI: "SERAH_TIDAK_TERBUKTI",
});
export const KELAS = Object.freeze({ PERLU_KEPUTUSAN: "PERLU_KEPUTUSAN", NILAI_NOL: "NILAI_NOL", RIWAYAT_PRA_BUKU: "RIWAYAT_PRA_BUKU", SUDAH_DIAKUI: "SUDAH_DIAKUI", LAIN: "LAIN" });

const OPSI_TX = { maxWait: 15_000, timeout: 60_000 };

// ── PEMUATAN BUKTI (BACA-SAJA, massal) ─────────────────────────────────────────────────────────────────────────────────────
const SEL_ORDER = {
  id: true, orderNumber: true, category: true, status: true, paymentStatus: true, value: true, ongkir: true, createdAt: true, paidAt: true, statusLocked: true, statusOverrideAt: true,
  penjualanKaryawanId: true, mergedIntoOrderId: true, customerId: true,
  customer: { select: { name: true } },
  items: { select: { id: true, layananName: true, harga: true, standardPrice: true, normalPrice: true, kind: true, sortOrder: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
  _count: { select: { units: true } },
};

async function muatBukti(db, ids) {
  if (!ids.length) return { orders: [], per: new Map() };
  const orders = await db.order.findMany({ where: { id: { in: ids } }, select: SEL_ORDER });
  const bersih = new Map((await nilaiBersihPerOrder(db, orders.map((o) => ({ id: o.id, value: o.value })))).map((x) => [x.id, x]));
  const [trans, jobs, payments, entries, linesPengakuan, gaps, invoices] = await Promise.all([
    db.orderStatusTransition.findMany({ where: { orderId: { in: ids } }, orderBy: { createdAt: "asc" }, select: { orderId: true, fromStatus: true, toStatus: true, createdAt: true, changedBy: { select: { name: true } } } }),
    db.job.findMany({ where: { orderId: { in: ids }, type: "DELIVERY" }, select: { id: true, orderId: true, status: true, completedAt: true, podStatus: true, scheduledDate: true } }),
    db.payment.findMany({ where: { orderId: { in: ids }, cancelledAt: null }, select: { id: true, orderId: true, amount: true, method: true, createdAt: true, verifications: { select: { id: true } } }, orderBy: { createdAt: "asc" } }),
    db.finJournalEntry.findMany({
      where: { OR: [{ source: "PENGAKUAN_PENDAPATAN", sourceId: { in: ids } }, { idempotencyKey: { startsWith: "PENGAKUAN_PENDAPATAN:" }, sourceId: { in: ids } }] },
      select: { id: true, entryNumber: true, date: true, status: true, idempotencyKey: true, sourceId: true, createdAt: true, reversalOfId: true }, orderBy: { createdAt: "asc" },
    }),
    db.finJournalLine.findMany({ where: { orderId: { in: ids }, entry: { status: { in: STATUS_DIHITUNG }, OR: [{ source: "PENGAKUAN_PENDAPATAN" }, { idempotencyKey: { startsWith: "PENGAKUAN_PENDAPATAN:" } }] } }, select: { orderId: true } }),
    db.finPostingGap.findMany({ where: { source: "PENGAKUAN_PENDAPATAN", sourceId: { in: ids }, resolvedAt: null }, select: { id: true, sourceId: true, reason: true, detail: true, createdAt: true } }),
    db.invoice.findMany({ where: { orderId: { in: ids } }, select: { orderId: true, invoiceNumber: true, lifecycleStatus: true } }),
  ]);
  // Jurnal pembalik pengakuan (alasan pembalikan = bukti bahwa seseorang SENGAJA membatalkan pengakuan).
  const pembalikRows = entries.length ? await db.finJournalEntry.findMany({ where: { reversalOfId: { in: entries.map((e) => e.id) } }, select: { reversalOfId: true, entryNumber: true, date: true, description: true } }) : [];
  const orderDariEntri = new Map(entries.map((e) => [e.id, e.sourceId]));
  const pembalikPerOrder = new Map();
  for (const x of pembalikRows) { const k = orderDariEntri.get(x.reversalOfId); (pembalikPerOrder.get(k) ?? pembalikPerOrder.set(k, []).get(k)).push({ nomor: x.entryNumber, tanggal: tanggalWIB(x.date), alasan: String(x.description ?? "").replace(/^Pembatalan\s+\S+\s+—\s*/, "") }); }
  const jurnalBayar = payments.length
    ? await db.finJournalEntry.findMany({ where: { idempotencyKey: { in: payments.map((p) => `PEMBAYARAN_ORDER:${p.id}`) }, status: { in: STATUS_DIHITUNG } }, select: { idempotencyKey: true, entryNumber: true, date: true, status: true } })
    : [];
  const bayarDijurnal = new Map(jurnalBayar.map((j) => [j.idempotencyKey.slice("PEMBAYARAN_ORDER:".length), j]));
  const ya = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m.get(k) ?? m.set(k, []).get(k)).push(x); return m; }, new Map());
  const T = ya(trans, (x) => x.orderId), J = ya(jobs, (x) => x.orderId), P = ya(payments, (x) => x.orderId), E = ya(entries, (x) => x.sourceId), G = ya(gaps, (x) => x.sourceId);
  const I = new Map(invoices.map((x) => [x.orderId, x]));
  const adaLine = new Set(linesPengakuan.map((l) => l.orderId));
  const per = new Map();
  for (const o of orders) {
    per.set(o.id, {
      order: o, nilaiBersih: bersih.get(o.id) ?? { nilaiBersih: o.value, notaKredit: 0 }, transisi: T.get(o.id) ?? [], jobs: J.get(o.id) ?? [], pembayaran: P.get(o.id) ?? [], bayarDijurnal,
      jurnalPengakuan: E.get(o.id) ?? [], pembalik: pembalikPerOrder.get(o.id) ?? [], adaLinePengakuan: adaLine.has(o.id), gap: G.get(o.id) ?? [], invoice: I.get(o.id) ?? null,
    });
  }
  return { orders, per };
}

/** Uang muka pelanggan yang SUDAH di buku besar untuk order ini (kredit − debit akun UANG_MUKA_PELANGGAN). */
async function uangMukaDiBuku(db, ids) {
  if (!ids.length) return new Map();
  const baris = await db.finJournalLine.findMany({
    where: { orderId: { in: ids }, account: { systemKey: "UANG_MUKA_PELANGGAN" }, entry: { status: { in: STATUS_DIHITUNG } } },
    select: { orderId: true, debit: true, credit: true },
  });
  const m = new Map();
  for (const b of baris) m.set(b.orderId, (m.get(b.orderId) ?? toMoney(0)).plus(toMoney(b.credit)).minus(toMoney(b.debit)));
  return new Map([...m].map(([k, v]) => [k, rp(v)]));
}

// ── ANALISIS (murni; tanpa DB) ─────────────────────────────────────────────────────────────────────────────────────────────
export function analisis(b, { cutoff, hariIni, uangMuka = 0 }) {
  const o = b.order;
  const nilaiKotor = rp(toMoney(o.value ?? 0)); const ongkir = rp(toMoney(o.ongkir ?? 0)); const total = nilaiKotor + ongkir;
  const aktif = b.jurnalPengakuan.find((e) => e.status === "POSTED" && !e.reversalOfId) ?? null;
  const pernahDiakui = b.jurnalPengakuan.some((e) => !e.reversalOfId) || b.adaLinePengakuan;
  const dibalik = !aktif && b.jurnalPengakuan.some((e) => e.status === "REVERSED");

  const jobSelesai = b.jobs.filter((j) => j.status === "COMPLETED" && j.completedAt).sort((a, c) => new Date(c.completedAt) - new Date(a.completedAt));
  const serah = jobSelesai[0] ? { tanggal: tanggalWIB(jobSelesai[0].completedAt), jobId: jobSelesai[0].id, podStatus: jobSelesai[0].podStatus ?? null, diverifikasi: jobSelesai[0].podStatus === "VERIFIED" } : null;
  const trDiserahkan = b.transisi.find((t) => STATUS_PENGAKUAN.includes(t.toStatus));
  const statusDiserahkan = trDiserahkan ? { tanggal: tanggalWIB(trDiserahkan.createdAt), oleh: trDiserahkan.changedBy?.name ?? null, dari: trDiserahkan.fromStatus, ke: trDiserahkan.toStatus } : null;
  const pembayaran = b.pembayaran.map((p) => ({
    id: p.id, jumlah: Number(p.amount), metode: p.method, tanggal: tanggalWIB(p.createdAt), terverifikasi: p.verifications.length > 0,
    dijurnal: b.bayarDijurnal.has(p.id) ? { nomor: b.bayarDijurnal.get(p.id).entryNumber, tanggal: tanggalWIB(b.bayarDijurnal.get(p.id).date) } : null,
  }));
  const totalDibayar = pembayaran.reduce((a, p) => a + p.jumlah, 0);

  const tahan = []; const penyebab = [];
  if (b.order.penjualanKaryawanId) tahan.push({ kode: KODE_TAHAN.PKR, pesan: "Order operasional Penjualan Karyawan — pendapatan & piutang dicatat di dokumen PKR (pengakuan dari order = pendapatan ganda)." });
  if (o.mergedIntoOrderId) tahan.push({ kode: KODE_TAHAN.DIGABUNG, pesan: "Order ini sudah digabung ke order lain — pengakuan dilakukan pada order tujuan." });
  if (!STATUS_PENGAKUAN.includes(o.status)) tahan.push({ kode: KODE_TAHAN.BELUM_DISERAHKAN, pesan: `Status order ${o.status} bukan status serah (${STATUS_PENGAKUAN.join("/")}).` });
  if (aktif) tahan.push({ kode: KODE_TAHAN.SUDAH_DIAKUI, pesan: `Pendapatan sudah diakui di jurnal ${aktif.entryNumber} (${tanggalWIB(aktif.date)}).` });
  else if (pernahDiakui && !dibalik) tahan.push({ kode: KODE_TAHAN.SUDAH_DIAKUI, pesan: "Order sudah punya pengakuan/piutang awal di buku besar." });
  if (dibalik) {
    const pb = b.pembalik[0];
    tahan.push({ kode: KODE_TAHAN.DIBALIK, pesan: `Pengakuan sebelumnya SUDAH DIBALIK${pb ? ` (${pb.nomor}, ${pb.tanggal}: "${pb.alasan}")` : ""}. Selesaikan alasan pembalikan itu lebih dulu; mengakui ulang butuh persetujuan eksplisit (akuiSetelahDibalik).`, lunakDenganPersetujuan: true });
  }
  if (total <= 0) tahan.push({ kode: KODE_TAHAN.NILAI_NOL, pesan: "Nilai order Rp0 (harga belum diisi). Tetapkan harga dari bukti (langkah 'Tetapkan harga'); sistem TIDAK menebak harga." });
  if (o.paymentStatus === "LUNAS" && b.pembayaran.length === 0) {
    tahan.push({ kode: KODE_TAHAN.LUNAS_TANPA_PEMBAYARAN, pesan: "Status Lunas tetapi tidak ada catatan pembayaran. Mengakui pendapatan akan menciptakan piutang untuk uang yang dianggap sudah lunas — selesaikan bukti pembayaran (penuntasan pembayaran historis) lebih dulu." });
  }
  const buktiSerah = serah ?? statusDiserahkan;
  const tglBuktiTerawal = [serah?.tanggal, statusDiserahkan?.tanggal].filter(Boolean).sort()[0] ?? null;
  const praCutoff = !!tglBuktiTerawal && tglBuktiTerawal < cutoff;
  if (praCutoff && STATUS_PENGAKUAN.includes(o.status)) {
    tahan.push({ kode: KODE_TAHAN.PRA_CUTOFF, pesan: `Diserahkan ${tglBuktiTerawal}, sebelum cutoff saldo awal (${cutoff}). Pendapatannya tercakup riwayat sebelum buku besar; mengakuinya di periode berjalan menaikkan pendapatan periode itu dan butuh persetujuan eksplisit per dokumen.`, lunakDenganPersetujuan: true });
  }
  if (!buktiSerah && STATUS_PENGAKUAN.includes(o.status)) {
    tahan.push({ kode: KODE_TAHAN.SERAH_TIDAK_TERBUKTI, pesan: "Tidak ada pengiriman selesai maupun riwayat status serah. Penyerahan tidak terbukti — hanya bisa dengan Keputusan Owner + bukti referensi.", lunakDenganPersetujuan: true });
  }

  // PENYEBAB (hanya yang dapat dibuktikan dari data)
  if (total <= 0) penyebab.push({ kode: "NILAI_NOL", uraian: "Harga order Rp0 pada saat serah, sehingga mesin pengakuan mencatat gap NILAI_ORDER_NOL dan menolak jurnal bernilai nol." + (b.order.items.length ? ` Item layanan ada (${b.order.items.length}) tetapi semua berharga Rp0.` : " Order tidak punya item layanan.") });
  if (STATUS_PENGAKUAN.includes(o.status) && !pernahDiakui && total > 0) {
    if (b.transisi.length === 0) penyebab.push({ kode: "STATUS_DITETAPKAN_SAAT_DIBUAT", uraian: `Tidak ada riwayat perpindahan status: status ${o.status} ditetapkan langsung saat order dibuat/diubah manual${o.statusLocked ? " (status terkunci)" : ""}, jalur yang tidak memanggil pengakuan otomatis.` });
    if (tglBuktiTerawal && tglBuktiTerawal < cutoff) penyebab.push({ kode: "SEBELUM_BUKU_BESAR", uraian: `Serah terjadi ${tglBuktiTerawal}, sebelum buku besar mulai (cutoff ${cutoff}); pengakuan otomatis baru berjalan untuk serah sesudah tanggal itu.` });
    if (o.statusLocked && b.transisi.length > 0 && !(tglBuktiTerawal && tglBuktiTerawal < cutoff)) penyebab.push({ kode: "STATUS_DIATUR_MANUAL", uraian: `Status order dikunci/diatur manual${o.statusOverrideAt ? ` (${tanggalWIB(o.statusOverrideAt)})` : ""}; jalur otomatis berhenti untuk order terkunci dan jalur manual tidak menghasilkan pengakuan.` });
    if (!penyebab.length) penyebab.push({ kode: "TIDAK_TERBUKTI", uraian: "Tidak ada jurnal pengakuan dan tidak ada gap; penyebab tidak dapat dibuktikan dari data (perlu penelusuran log)." });
  }
if (dibalik) penyebab.push({ kode: "PENGAKUAN_DIBALIK", uraian: `Pengakuan sebelumnya dibalik (${b.jurnalPengakuan.filter((e) => e.status === "REVERSED").map((e) => e.entryNumber).join(", ")})${b.pembalik[0] ? `; alasan pembalikan: "${b.pembalik[0].alasan}"` : ""}.` });

  // PILIHAN TANGGAL (hanya yang berbukti)
  const opsi = [];
  const tambah = (dasar, tanggal, catatan) => {
    let alasanTidak = null;
    if (tanggal && tanggal < cutoff) alasanTidak = `Sebelum cutoff saldo awal (${cutoff}) — buku besar tidak menerima pengakuan di tanggal ini.`;
    else if (tanggal && tanggal > hariIni) alasanTidak = "Tanggal di masa depan.";
    opsi.push({ dasar, label: LABEL_DASAR[dasar], tanggal, tersedia: !!tanggal && !alasanTidak, alasanTidak: tanggal ? alasanTidak : "Tidak ada bukti tanggal ini.", catatan });
  };
  tambah(DASAR_TANGGAL.TANGGAL_SERAH_POD, serah?.tanggal ?? null, serah ? (serah.diverifikasi ? "POD terverifikasi" : "POD belum diverifikasi") : null);
  tambah(DASAR_TANGGAL.TANGGAL_STATUS_DISERAHKAN, statusDiserahkan?.tanggal ?? null, statusDiserahkan ? `Dicatat ${statusDiserahkan.oleh ?? "sistem"}` : null);
  opsi.push({ dasar: DASAR_TANGGAL.KEPUTUSAN_OWNER, label: LABEL_DASAR.KEPUTUSAN_OWNER, tanggal: null, tersedia: true, alasanTidak: null, catatan: `Pilih tanggal ${cutoff}..${hariIni}; wajib bukti referensi dan alasan.` });

  // KELAS
  let kelas = KELAS.LAIN;
  const hanyaTahanLunak = tahan.every((t) => t.lunakDenganPersetujuan);
  if (aktif || (pernahDiakui && !dibalik)) kelas = KELAS.SUDAH_DIAKUI;
  else if (total <= 0 && STATUS_PENGAKUAN.includes(o.status) && !o.penjualanKaryawanId && !o.mergedIntoOrderId) kelas = KELAS.NILAI_NOL;
  else if (STATUS_PENGAKUAN.includes(o.status) && !o.penjualanKaryawanId && !o.mergedIntoOrderId) {
    const tanggalRelevan = [serah?.tanggal, statusDiserahkan?.tanggal, o.paidAt ? tanggalWIB(o.paidAt) : null, ...pembayaran.map((p) => p.tanggal)].filter(Boolean);
    const adaSesudah = tanggalRelevan.some((t) => t >= cutoff) || uangMuka > 0 || (!buktiSerah && tanggalWIB(o.createdAt) >= cutoff);
    kelas = adaSesudah ? KELAS.PERLU_KEPUTUSAN : KELAS.RIWAYAT_PRA_BUKU;
  }
  const bisaDiproses = kelas === KELAS.PERLU_KEPUTUSAN && tahan.every((t) => t.lunakDenganPersetujuan);
  return {
    orderId: o.id, nomor: o.orderNumber, kategori: o.category, status: o.status, statusBayar: o.paymentStatus, pelanggan: o.customer?.name ?? "", tanggalOrder: tanggalWIB(o.createdAt),
    nilaiKotor, ongkir, total, notaKredit: b.nilaiBersih.notaKredit, nilaiBersih: Number(b.nilaiBersih.nilaiBersih), tanggalLunas: o.paidAt ? tanggalWIB(o.paidAt) : null,
    items: o.items.map((i) => ({ id: i.id, nama: i.layananName, harga: i.harga, kind: i.kind ?? null, hargaKatalog: i.standardPrice ?? null, hargaNormal: i.normalPrice ?? null })),
    bukti: { serah, statusDiserahkan, pembayaran, totalDibayar, uangMukaDiBuku: uangMuka, invoice: b.invoice ? { nomor: b.invoice.invoiceNumber, status: b.invoice.lifecycleStatus } : null, gapSistem: b.gap.map((g) => ({ id: g.id, alasan: g.reason, detail: g.detail, tanggal: tanggalWIB(g.createdAt) })), jumlahUnit: o._count.units },
    pengakuan: { aktif: aktif ? { nomorJurnal: aktif.entryNumber, tanggal: tanggalWIB(aktif.date) } : null, riwayat: b.jurnalPengakuan.map((e) => ({ nomorJurnal: e.entryNumber, tanggal: tanggalWIB(e.date), status: e.status, membalik: !!e.reversalOfId })) },
    penyebab, tahan, kelas, bisaDiproses, praCutoff, pilihanTanggal: opsi,
  };
}

async function konteks(db) {
  return { cutoff: await tanggalCutoff(db), hariIni: tanggalWIB(new Date()) };
}

// ── DAFTAR & DETAIL (BACA-SAJA) ────────────────────────────────────────────────────────────────────────────────────────────
/** Daftar order diserahkan yang belum diakui (tanpa gap) + order Rp0, dikelompokkan per kelas. Tidak mengarang apa pun; riwayat pra-buku hanya dihitung (tidak diperinci). */
export async function daftarPengakuan(db, { kelas = null } = {}) {
  const ctx = await konteks(db);
  const [diserahkan, gapNol] = await Promise.all([
    db.order.findMany({ where: { status: { in: STATUS_PENGAKUAN }, penjualanKaryawanId: null, mergedIntoOrderId: null }, select: { id: true } }),
    db.finPostingGap.findMany({ where: { source: "PENGAKUAN_PENDAPATAN", reason: "NILAI_ORDER_NOL", resolvedAt: null }, select: { sourceId: true } }),
  ]);
  const ids = [...new Set([...diserahkan.map((o) => o.id), ...gapNol.map((g) => g.sourceId)])];
  // hanya yang belum punya pengakuan/line pengakuan dimuat penuh → filter cepat lewat jurnal
  // HANYA pengakuan AKTIF (POSTED) yang menyingkirkan order dari daftar. Pengakuan yang sudah DIBALIK (REVERSED) tidak lagi mengakui pendapatan — order tetap tampil (kasus NEW-23092026-040).
  const diakui = ids.length ? await db.finJournalEntry.findMany({ where: { sourceId: { in: ids }, OR: [{ source: "PENGAKUAN_PENDAPATAN" }, { idempotencyKey: { startsWith: "PENGAKUAN_PENDAPATAN:" } }], status: "POSTED" }, select: { sourceId: true } }) : [];
  const diakuiLine = ids.length ? await db.finJournalLine.findMany({ where: { orderId: { in: ids }, entry: { status: "POSTED", OR: [{ source: "PENGAKUAN_PENDAPATAN" }, { idempotencyKey: { startsWith: "PENGAKUAN_PENDAPATAN:" } }] } }, select: { orderId: true } }) : [];
  const sudah = new Set([...diakui.map((e) => e.sourceId), ...diakuiLine.map((l) => l.orderId)]);
  const kandidatId = ids.filter((id) => !sudah.has(id));
  const { orders, per } = await muatBukti(db, kandidatId);
  const um = await uangMukaDiBuku(db, kandidatId);
  const semua = orders.map((o) => analisis(per.get(o.id), { ...ctx, uangMuka: um.get(o.id) ?? 0 }));
  const hitung = (k) => semua.filter((x) => x.kelas === k);
  const ringkas = (arr) => ({ jumlah: arr.length, nilai: arr.reduce((a, x) => a + x.nilaiKotor + x.ongkir, 0) });
  const ringkasan = {
    perluKeputusan: ringkas(hitung(KELAS.PERLU_KEPUTUSAN)), nilaiNol: { jumlah: hitung(KELAS.NILAI_NOL).length, nilai: 0 },
    riwayatPraBuku: ringkas(hitung(KELAS.RIWAYAT_PRA_BUKU)), lain: ringkas(hitung(KELAS.LAIN)),
  };
  const tampil = semua.filter((x) => (kelas ? x.kelas === kelas : x.kelas === KELAS.PERLU_KEPUTUSAN || x.kelas === KELAS.NILAI_NOL));
  tampil.sort((a, b) => a.kelas.localeCompare(b.kelas) || a.nomor.localeCompare(b.nomor));
  return {
    cutoff: ctx.cutoff, hariIni: ctx.hariIni, ringkasan,
    daftar: tampil.map((x) => ({
      orderId: x.orderId, nomor: x.nomor, kategori: x.kategori, status: x.status, statusBayar: x.statusBayar, pelanggan: x.pelanggan, kelas: x.kelas, nilai: x.nilaiKotor + x.ongkir, nilaiBersih: x.nilaiBersih,
      tanggalSerah: x.bukti.serah?.tanggal ?? x.bukti.statusDiserahkan?.tanggal ?? null, tanggalLunas: x.tanggalLunas, dibayar: x.bukti.totalDibayar, uangMukaDiBuku: x.bukti.uangMukaDiBuku,
      penyebab: x.penyebab.map((p) => p.kode), tahan: x.tahan.map((t) => ({ kode: t.kode, lunak: !!t.lunakDenganPersetujuan })), bisaDiproses: x.bisaDiproses,
    })),
    catatan: "Daftar keputusan per dokumen. Tidak ada tombol massal: tiap order dibuka, diperiksa buktinya, lalu diakui/ditahan satu per satu. Riwayat sebelum buku besar hanya dihitung.",
  };
}

export async function detailPengakuan(db, orderId) {
  const ctx = await konteks(db);
  const { orders, per } = await muatBukti(db, [orderId]);
  if (!orders.length) throw new KoreksiError("Order tidak ditemukan", 404, "ORDER_TIDAK_ADA");
  const um = await uangMukaDiBuku(db, [orderId]);
  return { cutoff: ctx.cutoff, hariIni: ctx.hariIni, ...analisis(per.get(orderId), { ...ctx, uangMuka: um.get(orderId) ?? 0 }) };
}

// ── VALIDASI INPUT ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function periksaInput(a, input, ctx) {
  const teksAlasan = String(input?.alasan ?? "").trim();
  if (teksAlasan.length < 10) throw new KoreksiError("Alasan wajib diisi (minimal 10 karakter).", 400, "ALASAN_WAJIB");
  const dasar = String(input?.dasarTanggal ?? "");
  if (!DASAR_TANGGAL[dasar]) throw new KoreksiError(`Dasar tanggal tidak dikenal. Pilihan: ${Object.keys(DASAR_TANGGAL).join(", ")}`, 400, "DASAR_TANGGAL_TIDAK_VALID");
  const tanggal = String(input?.tanggal ?? "");
  if (!tglKalenderValid(tanggal)) throw new KoreksiError("Tanggal pengakuan wajib YYYY-MM-DD yang ada di kalender.", 400, "TANGGAL_TIDAK_VALID");
  if (tanggal < ctx.cutoff) throw new KoreksiError(`Tanggal pengakuan ${tanggal} sebelum cutoff saldo awal (${ctx.cutoff}) — buku besar tidak menerima pengakuan di tanggal itu.`, 422, "TANGGAL_SEBELUM_CUTOFF");
  if (tanggal > ctx.hariIni) throw new KoreksiError("Tanggal pengakuan tidak boleh di masa depan.", 422, "TANGGAL_MASA_DEPAN");
  const bukti = String(input?.buktiReferensi ?? "").trim();

  const keras = a.tahan.filter((t) => !t.lunakDenganPersetujuan);
  if (keras.length) throw new KoreksiError(keras[0].pesan, keras[0].kode === KODE_TAHAN.SUDAH_DIAKUI ? 409 : 422, keras[0].kode);

  const opsi = a.pilihanTanggal.find((o) => o.dasar === dasar);
  if (dasar !== DASAR_TANGGAL.KEPUTUSAN_OWNER) {
    if (!opsi?.tanggal) throw new KoreksiError("Bukti untuk dasar tanggal ini tidak ada pada order.", 422, "BUKTI_TANGGAL_TIDAK_ADA");
    if (opsi.tanggal !== tanggal) throw new KoreksiError(`Tanggal harus sama dengan bukti (${opsi.tanggal}) untuk dasar ini; untuk tanggal lain pakai Keputusan Owner.`, 422, "TANGGAL_TIDAK_SESUAI_BUKTI");
    if (!opsi.tersedia) throw new KoreksiError(opsi.alasanTidak ?? "Dasar tanggal tidak tersedia.", 422, "DASAR_TIDAK_TERSEDIA");
  } else if (bukti.length < 8) {
    throw new KoreksiError("Keputusan Owner wajib disertai bukti referensi (minimal 8 karakter: nomor dokumen/pesan/kesepakatan).", 400, "BUKTI_REFERENSI_WAJIB");
  }
  const lunak = a.tahan.filter((t) => t.lunakDenganPersetujuan);
  if (lunak.some((t) => t.kode === KODE_TAHAN.DIBALIK) && input?.akuiSetelahDibalik !== true) {
    throw new KoreksiError(lunak.find((t) => t.kode === KODE_TAHAN.DIBALIK).pesan, 422, "PERSETUJUAN_SETELAH_DIBALIK_DIPERLUKAN");
  }
  if (lunak.some((t) => t.kode === KODE_TAHAN.PRA_CUTOFF) && input?.akuiPraCutoff !== true) {
    throw new KoreksiError(lunak.find((t) => t.kode === KODE_TAHAN.PRA_CUTOFF).pesan + " Kirim akuiPraCutoff=true dengan dasar Keputusan Owner bila memang diputuskan.", 422, "PERSETUJUAN_PRA_CUTOFF_DIPERLUKAN");
  }
  if (lunak.some((t) => t.kode === KODE_TAHAN.PRA_CUTOFF) && dasar !== DASAR_TANGGAL.KEPUTUSAN_OWNER) {
    throw new KoreksiError("Order yang diserahkan sebelum cutoff hanya bisa diakui dengan dasar Keputusan Owner (tanggal ≥ cutoff).", 422, "DASAR_HARUS_KEPUTUSAN_OWNER");
  }
  if (lunak.some((t) => t.kode === KODE_TAHAN.SERAH_TIDAK_TERBUKTI) && dasar !== DASAR_TANGGAL.KEPUTUSAN_OWNER) {
    throw new KoreksiError("Penyerahan tidak terbukti: hanya Keputusan Owner + bukti referensi yang dapat dipakai.", 422, "DASAR_HARUS_KEPUTUSAN_OWNER");
  }
  return { alasan: teksAlasan, dasar, tanggal, bukti, akuiPraCutoff: input?.akuiPraCutoff === true, akuiSetelahDibalik: input?.akuiSetelahDibalik === true };
}

async function periodeTertutupUntuk(db, tanggal) {
  const p = await db.finPeriod.findUnique({ where: { year_month: { year: Number(tanggal.slice(0, 4)), month: Number(tanggal.slice(5, 7)) } }, select: { status: true } });
  return p?.status === "CLOSED";
}

// ── PENGAKUAN ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
function ringkasJurnal(entry, lines, akun) {
  const bar = lines.map((l) => ({ akun: `${akun.get(l.accountId)?.code ?? ""} ${akun.get(l.accountId)?.name ?? ""}`.trim(), systemKey: akun.get(l.accountId)?.systemKey ?? null, debit: rp(toMoney(l.debit || 0)), kredit: rp(toMoney(l.credit || 0)), keterangan: l.description ?? "" }));
  return { nomor: entry.entryNumber, tanggal: tanggalWIB(entry.date), keterangan: entry.description, status: entry.status, baris: bar, totalDebit: bar.reduce((a, b) => a + b.debit, 0), totalKredit: bar.reduce((a, b) => a + b.kredit, 0) };
}
async function petaAkun(tx, ids) {
  const rows = await tx.finAccount.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, code: true, name: true, systemKey: true } });
  return new Map(rows.map((r) => [r.id, r]));
}

/** Dampak ke piutang/pendapatan/uang muka dari jurnal yang BARU dibuat. */
function dampakDariJurnal(bar) {
  const net = (key) => bar.filter((b) => b.systemKey === key).reduce((a, b) => a + b.debit - b.kredit, 0); // debit − kredit: positif = aset BERTAMBAH (piutang)
  const pendapatan = -bar.filter((b) => ["PENDAPATAN_LAYANAN", "PENDAPATAN_PRODUK", "PENDAPATAN_SEWA", "PENDAPATAN_ONGKIR"].includes(b.systemKey)).reduce((a, b) => a + b.debit - b.kredit, 0);
  return { pendapatanBertambah: pendapatan, piutangUsahaBerubah: net("PIUTANG_USAHA"), uangMukaPelangganBerubah: -net("UANG_MUKA_PELANGGAN") /* kewajiban: kredit − debit; negatif = uang muka BERKURANG (dipindah jadi pelunasan) */ };
}

/**
 * Jalankan pengakuan terkendali untuk SATU order. `preview=true` → seluruh langkah dijalankan di dalam transaksi lalu di-ROLLBACK (melempar PratinjauKoreksi) — pratinjau memakai kode yang SAMA.
 * `stepUp` (async fn) dipanggil sebelum menulis bila bukan pratinjau.
 */
export async function pengakuanTerkendali(tx, { orderId, input, userId, preview = false, stepUp = null }) {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `koreksi_pengakuan:${orderId}`);
  await lockRowForUpdate(tx, '"Order"', orderId, { cast: null });
  const ctx = await konteks(tx);
  const { orders, per } = await muatBukti(tx, [orderId]);
  if (!orders.length) throw new KoreksiError("Order tidak ditemukan", 404, "ORDER_TIDAK_ADA");
  const um = await uangMukaDiBuku(tx, [orderId]);
  const a = analisis(per.get(orderId), { ...ctx, uangMuka: um.get(orderId) ?? 0 });

  // IDEMPOTEN: sudah diakui → hasil yang sama, tidak ada jurnal kedua (replay / klik ganda / paralel).
  if (a.pengakuan.aktif) {
    if (preview) throw new PratinjauKoreksi({ orderId, nomor: a.nomor, sudahDiakui: true, jurnal: null, tahan: a.tahan });
    return { dibuat: false, status: "SUDAH_DIAKUI", nomorJurnal: a.pengakuan.aktif.nomorJurnal };
  }
  const v = periksaInput(a, input, ctx);
  if (await periodeTertutupUntuk(tx, v.tanggal)) throw new KoreksiError(`Periode ${v.tanggal.slice(5, 7)}/${v.tanggal.slice(0, 4)} sudah ditutup — pengakuan ditolak. Buka kembali periodenya atau pilih tanggal di periode terbuka.`, 409, "PERIODE_TERTUTUP");
  if (!preview && stepUp) await stepUp();

  const hasil = await postRevenueRecognition(tx, { orderId, userId, date: new Date(`${v.tanggal}T00:00:00.000Z`) });
  if (!hasil.posted) throw new KoreksiError(hasil.gap ? "Mesin pengakuan menolak (gap tercatat): periksa nilai order dan akun sistem." : "Pengakuan tidak menghasilkan jurnal.", 422, "PENGAKUAN_DITOLAK");
  if (hasil.created === false) return { dibuat: false, status: "SUDAH_DIAKUI", nomorJurnal: hasil.entry.entryNumber };

  const lines = await tx.finJournalLine.findMany({ where: { entryId: hasil.entry.id }, orderBy: { lineNo: "asc" } });
  const akun = await petaAkun(tx, lines.map((l) => l.accountId));
  const jurnal = ringkasJurnal(hasil.entry, lines, akun);
  const dampak = dampakDariJurnal(jurnal.baris);

  // gap NILAI_ORDER_NOL (bila ada) ditutup oleh jurnal ini
  const gapTerbuka = await tx.finPostingGap.findMany({ where: { source: "PENGAKUAN_PENDAPATAN", sourceId: orderId, resolvedAt: null }, select: { id: true } });
  if (gapTerbuka.length) await tx.finPostingGap.updateMany({ where: { id: { in: gapTerbuka.map((g) => g.id) } }, data: { resolvedAt: new Date(), resolvedEntryId: hasil.entry.id } });

  const ringkasan = {
    orderId, nomor: a.nomor, pelanggan: a.pelanggan, kelas: a.kelas, dasarTanggal: v.dasar, tanggal: v.tanggal, penyebab: a.penyebab, jurnal, dampak, gapDitutup: gapTerbuka.length,
    peringatan: [
      ...(a.praCutoff ? ["Order ini diserahkan sebelum cutoff: pendapatan masuk periode " + v.tanggal.slice(0, 7) + " atas persetujuan eksplisit."] : []),
      ...(um.get(orderId) ? [`Uang muka Rp${um.get(orderId).toLocaleString("id-ID")} di buku dipindahkan menjadi pelunasan piutang.`] : []),
      ...(a.statusBayar === "LUNAS" || a.bukti.totalDibayar > 0 ? [] : [`Piutang usaha baru Rp${jurnal.baris.filter((b) => b.systemKey === "PIUTANG_USAHA").reduce((s, b) => s + b.debit - b.kredit, 0).toLocaleString("id-ID")} muncul (belum ada pembayaran).`]),
    ],
  };
  if (preview) throw new PratinjauKoreksi(ringkasan);

  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: userId ?? null,
    metadata: { aksi: "KOREKSI_PENGAKUAN_PENDAPATAN", nomorOrder: a.nomor, nomorJurnal: hasil.entry.entryNumber, tanggal: v.tanggal, dasarTanggal: v.dasar, buktiReferensi: v.bukti || null, alasan: v.alasan, akuiPraCutoff: v.akuiPraCutoff, akuiSetelahDibalik: v.akuiSetelahDibalik, penyebab: a.penyebab.map((p) => p.kode), dampak, gapDitutup: gapTerbuka.length },
  });
  return { dibuat: true, status: "DIAKUI", nomorJurnal: hasil.entry.entryNumber, ringkasan };
}

// ── PEMBALIKAN ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Transaksi lain yang bergantung pada piutang pengakuan ini (pembayaran/Nota Kredit/refund yang menyentuh piutang order sesudah pengakuan). */
async function tergantung(tx, orderId, entryId) {
  const baris = await tx.finJournalLine.findMany({
    where: { orderId, entryId: { not: entryId }, account: { systemKey: "PIUTANG_USAHA" }, entry: { status: { in: STATUS_DIHITUNG }, reversalOfId: null, NOT: { reversalOf: { id: entryId } } } },
    select: { entry: { select: { entryNumber: true, source: true, status: true, date: true } }, debit: true, credit: true },
  });
  return baris.filter((b) => b.entry.status === "POSTED").map((b) => ({ nomor: b.entry.entryNumber, sumber: b.entry.source, tanggal: tanggalWIB(b.entry.date), nilai: rp(toMoney(b.debit).minus(toMoney(b.credit))) }));
}

export async function balikPengakuan(tx, { orderId, alasan, userId, preview = false, stepUp = null }) {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `koreksi_pengakuan:${orderId}`);
  await lockRowForUpdate(tx, '"Order"', orderId, { cast: null });
  const teks = String(alasan ?? "").trim();
  if (teks.length < 10) throw new KoreksiError("Alasan pembalikan wajib diisi (minimal 10 karakter).", 400, "ALASAN_WAJIB");
  const o = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, orderNumber: true } });
  if (!o) throw new KoreksiError("Order tidak ditemukan", 404, "ORDER_TIDAK_ADA");
  const aktif = await tx.finJournalEntry.findFirst({ where: { idempotencyKey: { startsWith: KEY_PENDAPATAN.revenue(orderId) }, status: "POSTED", reversalOfId: null }, include: { lines: true } });
  if (!aktif) return { dibuat: false, status: "TIDAK_ADA_PENGAKUAN_AKTIF" };
  // hanya pengakuan hasil koreksi terkendali yang boleh dibalik lewat jalur ini (pengakuan otomatis dibalik oleh pembatalan order)
  const dariKoreksi = await tx.activityEvent.findFirst({ where: { entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, metadata: { path: ["nomorJurnal"], equals: aktif.entryNumber } }, select: { id: true } });
  if (!dariKoreksi) throw new KoreksiError(`Jurnal ${aktif.entryNumber} bukan hasil koreksi terkendali. Pengakuan otomatis hanya dibalik lewat pembatalan order (Order dibatalkan) — jalur ini tidak membalik jurnal otomatis.`, 422, "BUKAN_HASIL_KOREKSI");
  const bergantung = await tergantung(tx, orderId, aktif.id);
  if (bergantung.length) throw new KoreksiError(`Tidak aman dibalik: ada transaksi lain yang memakai piutang order ini (${bergantung.map((b) => b.nomor).join(", ")}). Batalkan/koreksi transaksi itu lebih dulu.`, 409, "ADA_TRANSAKSI_BERGANTUNG");
  const periodeAsal = await tx.finPeriod.findUnique({ where: { year_month: { year: aktif.date.getUTCFullYear(), month: aktif.date.getUTCMonth() + 1 } }, select: { status: true } });
  if (periodeAsal?.status === "CLOSED") throw new KoreksiError("Periode pengakuan sudah ditutup — pembalikan ditolak. Buka kembali periodenya (Finance > Pengaturan).", 409, "PERIODE_TERTUTUP");
  const hariIni = todayBookDateWIB();
  const periodeIni = await tx.finPeriod.findUnique({ where: { year_month: { year: hariIni.getUTCFullYear(), month: hariIni.getUTCMonth() + 1 } }, select: { status: true } });
  if (periodeIni?.status === "CLOSED") throw new KoreksiError("Periode hari ini sudah ditutup — jurnal balik tidak bisa diposting.", 409, "PERIODE_TERTUTUP");
  if (!preview && stepUp) await stepUp();

  const balik = await reverseJournal(tx, { entryId: aktif.id, reason: `Pembalikan koreksi pengakuan pendapatan ${o.orderNumber} — ${teks}`, userId });
  const lines = await tx.finJournalLine.findMany({ where: { entryId: balik.id }, orderBy: { lineNo: "asc" } });
  const akun = await petaAkun(tx, lines.map((l) => l.accountId));
  const jurnal = ringkasJurnal(balik, lines, akun);
  const dampak = dampakDariJurnal(jurnal.baris);
  const ringkasan = { orderId, nomor: o.orderNumber, jurnalDibalik: aktif.entryNumber, jurnalBalik: jurnal, dampak, catatan: "Order tetap berstatus diserahkan. Pengakuan baru hanya lewat koreksi terkendali (kunci jurnal ber-sufiks ULANG)." };
  if (preview) throw new PratinjauKoreksi(ringkasan);
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.JOURNAL_REVERSED, actorId: userId ?? null,
    metadata: { aksi: "PEMBALIKAN_KOREKSI_PENGAKUAN_PENDAPATAN", nomorOrder: o.orderNumber, nomorJurnal: aktif.entryNumber, nomorJurnalBalik: balik.entryNumber, alasan: teks, dampak },
  });
  return { dibuat: true, status: "DIBALIK", nomorJurnal: aktif.entryNumber, nomorJurnalBalik: balik.entryNumber, ringkasan };
}

// ── TETAPKAN HARGA (order Rp0) ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Menetapkan harga item order yang masih Rp0, SATU order per permintaan, harga dari manusia + bukti (BUKAN tebakan; harga katalog hanya ditampilkan sebagai acuan). Hanya item berharga Rp0
 * yang boleh diisi; item berharga tidak disentuh. Memakai logika yang sama dengan edit item order resmi (Order.value = Σ item, agregat pelanggan disinkronkan, catatan revisi bila Lunas)
 * dan mencatat sebelum/sesudah. TIDAK memposting pengakuan — itu langkah terpisah (pengakuan terkendali) agar tanggal diputuskan sadar.
 */
export async function tetapkanHarga(tx, { orderId, harga, buktiHarga, alasan, userId, preview = false, stepUp = null }) {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `koreksi_pengakuan:${orderId}`);
  await lockRowForUpdate(tx, '"Order"', orderId, { cast: null });
  const teks = String(alasan ?? "").trim(); const bukti = String(buktiHarga ?? "").trim();
  if (teks.length < 10) throw new KoreksiError("Alasan wajib diisi (minimal 10 karakter).", 400, "ALASAN_WAJIB");
  if (bukti.length < 8) throw new KoreksiError("Bukti harga wajib (nomor penawaran/pesan/kesepakatan, minimal 8 karakter) — sistem tidak menebak harga.", 400, "BUKTI_HARGA_WAJIB");
  if (!Array.isArray(harga) || harga.length === 0) throw new KoreksiError("Daftar harga item wajib diisi.", 400, "HARGA_WAJIB");
  const o = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, orderNumber: true, value: true, ongkir: true, status: true, paymentStatus: true, customerId: true, penjualanKaryawanId: true, mergedIntoOrderId: true, items: { select: { id: true, layananName: true, harga: true } } } });
  if (!o) throw new KoreksiError("Order tidak ditemukan", 404, "ORDER_TIDAK_ADA");
  if (o.penjualanKaryawanId || o.mergedIntoOrderId) throw new KoreksiError("Order PKR/digabung tidak boleh diubah harganya dari sini.", 422, "ORDER_TIDAK_BOLEH");
  const sudahDiakui = await tx.finJournalEntry.findFirst({ where: { idempotencyKey: { startsWith: KEY_PENDAPATAN.revenue(orderId) }, status: "POSTED" }, select: { entryNumber: true } });
  if (sudahDiakui) throw new KoreksiError(`Pendapatan order sudah diakui (${sudahDiakui.entryNumber}); harga tidak boleh diubah dari sini — gunakan koreksi order resmi.`, 409, "SUDAH_DIAKUI");
  const mapItem = new Map(o.items.map((i) => [i.id, i]));
  const perubahan = [];
  for (const h of harga) {
    const it = mapItem.get(h?.itemId);
    if (!it) throw new KoreksiError(`Item ${h?.itemId} bukan item order ini.`, 422, "ITEM_TIDAK_VALID");
    if (it.harga !== 0) throw new KoreksiError(`Item "${it.layananName}" sudah berharga Rp${it.harga.toLocaleString("id-ID")} — hanya item Rp0 yang boleh diisi dari sini.`, 422, "ITEM_SUDAH_BERHARGA");
    const nilai = Number(h?.harga);
    if (!Number.isInteger(nilai) || nilai <= 0 || nilai > 1_000_000_000) throw new KoreksiError(`Harga item "${it.layananName}" harus bilangan bulat Rupiah > 0.`, 400, "HARGA_TIDAK_VALID");
    if (perubahan.some((p) => p.itemId === it.id)) throw new KoreksiError("Item yang sama dikirim dua kali.", 400, "ITEM_GANDA");
    perubahan.push({ itemId: it.id, nama: it.layananName, sebelum: 0, sesudah: nilai });
  }
  const valueSebelum = Number(o.value) || 0;
  const valueSesudah = valueSebelum + perubahan.reduce((a, p) => a + p.sesudah, 0);
  const ringkasan = { orderId, nomor: o.orderNumber, perubahan, valueSebelum, valueSesudah, dampakSales: `Omzet Sales order ini berubah dari Rp${valueSebelum.toLocaleString("id-ID")} menjadi Rp${valueSesudah.toLocaleString("id-ID")} (Order.value = Σ item).`, catatan: "Belum ada jurnal: setelah harga tersimpan, lanjutkan ke pengakuan pendapatan (tanggal diputuskan sadar)." };
  if (preview) throw new PratinjauKoreksi(ringkasan);
  if (stepUp) await stepUp();
  for (const p of perubahan) await tx.orderItem.update({ where: { id: p.itemId }, data: { harga: p.sesudah } });
  const agg = await tx.orderItem.aggregate({ where: { orderId }, _sum: { harga: true } });
  await tx.order.update({ where: { id: orderId }, data: { value: agg._sum.harga || 0 } });
  if (o.paymentStatus === "LUNAS") await tx.orderRevisionLog.create({ data: { orderId, editedById: userId ?? null, note: "Menetapkan harga item Rp0 (koreksi Finance)" } });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: userId ?? null,
    metadata: { aksi: "TETAPKAN_HARGA_ORDER_RP0", nomorOrder: o.orderNumber, before: { value: valueSebelum, item: perubahan.map((p) => ({ id: p.itemId, harga: 0 })) }, after: { value: valueSesudah, item: perubahan.map((p) => ({ id: p.itemId, harga: p.sesudah })) }, buktiHarga: bukti, alasan: teks },
  });
  // customerId dikembalikan: pemanggil menyinkronkan agregat Customer SESUDAH commit (syncCustomerOrderAggregate memakai klien global, bukan transaksi ini).
  return { dibuat: true, status: "HARGA_DITETAPKAN", ringkasan, customerId: o.customerId };
}

/** Bungkus fungsi bermode `preview` menjadi pratinjau murni: jalankan di transaksi, tangkap PratinjauKoreksi, rollback. */
export async function jalankanPratinjau(prisma, fn) {
  try {
    await prisma.$transaction((tx) => fn(tx), OPSI_TX);
  } catch (e) {
    if (e instanceof PratinjauKoreksi) return e.data;
    throw e;
  }
  throw new Error("Pratinjau tidak menghasilkan data");
}
export { OPSI_TX };
