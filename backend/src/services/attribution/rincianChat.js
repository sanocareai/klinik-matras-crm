// DAFTAR CHAT per sumber atau per iklan, plus EKSPOR EXCEL tab Marketing. BACA-SAJA (transaksi READ ONLY). Hanya untuk rute ADMIN karena memuat nama dan nomor pelanggan.
//
// Tiga cara memilih lead (hitungannya harus sama dengan baris tabel asalnya):
//   sumber=<id>                        semua customer berlabel sumber itu (definisi hitungSumber).
//   adId / adSetId / campaignId / kreatif   customer dengan touch akuisisi CTWA terbukti di iklan itu (aturan yang sama dengan iklanReport: touch NEW pertama per customer).
//   tanpaIklan=1                       berlabel Meta tetapi tanpa touch akuisisi terbukti: "Iklan tidak terbaca". Tidak pernah ditebak ke iklan mana pun.
// Ber-order, lunas, dan nilai memakai aturan kohort yang sama dengan laporan (lead sah + order eligible + ledger).
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../../utils/wib.js";
import { alasanBukanLead, jejakPembayaran } from "./cohort.js";
import { ORDER_EXCLUDED_STATUS } from "./cohortDefinitions.js";
import { muatMasukanKohort } from "./cohortLoader.js";
import { nilaiBersih } from "../orderNilaiBersih.js";
import { detailSumberTampil } from "./keteranganSumber.js";
import { hitungLaporanIklan, ParameterError } from "./iklanReport.js";
import { hitungSumberPerforma, sumberDariCustomer, SUMBER } from "./sumber.js";

export const UKURAN_HALAMAN = 50;
const RE_ID = /^\d{5,32}$/;
const HASIL = Object.freeze(["semua", "order", "spam"]);
const TEKS_TANPA_BUKTI_IKLAN = "Iklan tidak terbaca";
const potong = (arr, n = 2000) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600e3).toISOString().replace("T", " ").slice(0, 16);

/** Validasi filter. Tepat satu pemilih; kosong = semua lead pada periode (dipakai ekspor). */
export function parseFilterChat(query = {}, { wajibPemilih = true } = {}) {
  const f = {
    sumber: query.sumber ? String(query.sumber) : null,
    adId: query.adId ? String(query.adId) : null,
    adSetId: query.adSetId ? String(query.adSetId) : null,
    campaignId: query.campaignId ? String(query.campaignId) : null,
    kreatif: query.kreatif ? String(query.kreatif).slice(0, 300) : null,
    tanpaIklan: query.tanpaIklan === "1" || query.tanpaIklan === "true",
  };
  if (f.sumber && !SUMBER.some((s) => s.id === f.sumber)) throw new ParameterError("sumber tidak dikenal");
  for (const k of ["adId", "adSetId", "campaignId"]) if (f[k] && !RE_ID.test(f[k])) throw new ParameterError(`${k} harus string digit (ID Meta)`);
  const jumlah = [f.sumber, f.adId, f.adSetId, f.campaignId, f.kreatif, f.tanpaIklan || null].filter(Boolean).length;
  if (jumlah > 1) throw new ParameterError("pilih satu saja: sumber, iklan, ad set, campaign, kreatif, atau tanpaIklan");
  if (wajibPemilih && jumlah === 0) throw new ParameterError("pilih sumber, iklan, ad set, campaign, kreatif, atau tanpaIklan");
  const hasil = query.hasil ? String(query.hasil) : "semua";
  if (!HASIL.includes(hasil)) throw new ParameterError(`hasil harus salah satu: ${HASIL.join(", ")}`);
  const halaman = query.halaman === undefined ? 1 : Number(query.halaman);
  if (!Number.isInteger(halaman) || halaman < 1) throw new ParameterError("halaman harus bilangan bulat >= 1");
  return { ...f, hasil, halaman };
}

/** MURNI. Touch NEW pertama per customer menurut (touchAt, id): aturan akuisisi iklanReport. */
export function pilihAkuisisi(touches) {
  const urut = [...touches].sort((a, b) => new Date(a.touchAt) - new Date(b.touchAt) || (a.id < b.id ? -1 : 1));
  const peta = new Map();
  for (const t of urut) if (!peta.has(t.customerId)) peta.set(t.customerId, t);
  return peta;
}

/** MURNI. Apakah customer lolos pemilih. `ref` = referensi iklan dari touch akuisisi (null bila belum terpetakan). */
export function cocokFilter(c, akuisisi, ref, f) {
  if (f.sumber) return sumberDariCustomer(c) === f.sumber;
  if (f.tanpaIklan) return c.leadSource === "META_ADS" && !akuisisi;
  if (f.adId) return akuisisi?.adId === f.adId;
  if (f.adSetId) return ref?.adSetId === f.adSetId;
  if (f.campaignId) return ref?.campaignId === f.campaignId;
  if (f.kreatif) return ref?.adName === f.kreatif;
  return true;
}

/** MURNI. Hasil satu customer dari order eligible dan ledger. Spam atau staf tidak pernah dihitung ber-order, sama dengan laporan. */
export function hasilCustomer(c, orders, kPerOrder, rPerOrder) {
  const alasan = alasanBukanLead(c);
  const out = { spam: alasan === "SPAM", berOrder: false, jumlahOrder: 0, nilaiOrder: 0, statusBayar: null };
  if (alasan) return out;
  let lunas = 0, dp = 0, tidakDiketahui = 0, belum = 0;
  for (const o of orders) {
    if (o.penjualanKaryawanId || ORDER_EXCLUDED_STATUS.includes(o.status)) continue;
    out.jumlahOrder++; out.nilaiOrder += nilaiBersih(o);
    const j = jejakPembayaran(kPerOrder.get(o.id) || [], o.tagihan != null ? o.tagihan : nilaiBersih(o), rPerOrder.get(o.id) || []);
    if (j.status === "LUNAS") lunas++;
    else if (j.status === "DP") dp++;
    else if (j.jumlahPembayaran === 0 && (o.paymentStatus === "LUNAS" || o.paymentStatus === "DP")) tidakDiketahui++;
    else belum++;
  }
  out.berOrder = out.jumlahOrder > 0;
  if (out.berOrder) out.statusBayar = lunas === out.jumlahOrder ? "Lunas" : lunas + dp > 0 ? "DP" : tidakDiketahui > 0 ? "Tidak diketahui" : "Belum bayar";
  return out;
}

/** Teks pesan untuk ditampilkan: tanda klik tak terlihat (zero-width) dibuang, spasi dirapikan. */
export function rapikanPesan(teks) {
  return String(teks || "").replace(/[​-‍⁠﻿]/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Muat baris lead (belum berisi percakapan) dalam transaksi yang diberikan. */
async function muatBaris(tx, { dari, sampai }, f) {
  const awal = startOfDayWIB(dari), akhir = endOfDayExclusiveWIB(sampai);
  const customers = await tx.customer.findMany({
    where: { createdAt: { gte: awal, lt: akhir } },
    select: { id: true, name: true, phone: true, createdAt: true, leadSource: true, leadSourceDetail: true, pipelineStage: true, isInternalStaff: true, staffUserId: true, assignedSales: { select: { name: true } } },
  });
  const touches = await tx.attributionTouch.findMany({
    where: { customerStatusAtTouch: "NEW", evidenceSource: "CTWA_AD", customer: { createdAt: { gte: awal, lt: akhir } } },
    select: { id: true, customerId: true, adId: true, touchAt: true },
  });
  const akuisisi = pilihAkuisisi(touches);
  const adIds = [...new Set([...akuisisi.values()].map((t) => t.adId))];
  const refs = adIds.length ? await tx.metaAdReference.findMany({ where: { adId: { in: adIds } }, select: { adId: true, adSetId: true, campaignId: true, adName: true, adSetName: true, campaignName: true } }) : [];
  const refPer = new Map(refs.map((r) => [r.adId, r]));
  const pilih = customers.filter((c) => { const t = akuisisi.get(c.id); return cocokFilter(c, t, t ? refPer.get(t.adId) : null, f); });

  const { orders, kontribusi, refunds } = await muatMasukanKohort(tx, { customerIds: pilih.map((c) => c.id) });
  const oPer = new Map(); for (const o of orders) (oPer.get(o.customerId) || oPer.set(o.customerId, []).get(o.customerId)).push(o);
  const kPer = new Map(); for (const k of kontribusi) (kPer.get(k.orderId) || kPer.set(k.orderId, []).get(k.orderId)).push(k);
  const rPer = new Map(); for (const r of refunds) if (r.status === "DISETUJUI") (rPer.get(r.orderId) || rPer.set(r.orderId, []).get(r.orderId)).push(r);

  return pilih.map((c) => {
    const t = akuisisi.get(c.id) || null; const r = t ? refPer.get(t.adId) || null : null;
    return {
      id: c.id, nama: c.name || null, nomor: c.phone || null, masukPada: c.createdAt, tanggal: wib(c.createdAt), stage: c.pipelineStage,
      sumberId: sumberDariCustomer(c), sumberLabel: c.leadSource, keterangan: detailSumberTampil(c.leadSourceDetail) || null, sales: c.assignedSales?.name || null,
      iklan: t ? { adId: t.adId, adNama: r?.adName ?? null, adSetId: r?.adSetId ?? null, adSetNama: r?.adSetName ?? null, campaignId: r?.campaignId ?? null, campaignNama: r?.campaignName ?? null } : null,
      ...hasilCustomer(c, oPer.get(c.id) || [], kPer, rPer),
    };
  }).sort((a, b) => new Date(b.masukPada) - new Date(a.masukPada) || (a.id < b.id ? -1 : 1));
}

/** Lengkapi baris dengan percakapan terbaru (tautan chat) dan pesan masuk pertama. */
async function lengkapiPercakapan(tx, baris) {
  const peta = new Map(baris.map((b) => [b.id, b]));
  for (const part of potong(baris.map((b) => b.id))) {
    const conv = await tx.conversation.findMany({ where: { customerId: { in: part }, type: "INDIVIDUAL" }, select: { id: true, customerId: true, lastMessageAt: true } });
    const pemilik = new Map(conv.map((k) => [k.id, k.customerId]));
    for (const k of conv) {
      const b = peta.get(k.customerId);
      if (!b._kini || new Date(k.lastMessageAt) > b._kini) { b._kini = new Date(k.lastMessageAt); b.conversationId = k.id; }
    }
    if (!conv.length) continue;
    const pesan = await tx.$queryRaw`
      SELECT DISTINCT ON (m."conversationId") m."conversationId" AS conv, m.content, m."createdAt" AS waktu
      FROM "Message" m
      WHERE m."conversationId" IN (${Prisma.join(conv.map((k) => k.id))}) AND m.direction = 'INBOUND' AND m."isRevoked" = false
      ORDER BY m."conversationId", m."createdAt" ASC`;
    for (const p of pesan) {
      const b = peta.get(pemilik.get(p.conv));
      if (!b._awal || new Date(p.waktu) < b._awal) { b._awal = new Date(p.waktu); b.pesanPertama = rapikanPesan(p.content); }
    }
  }
  return baris.map(({ _kini, _awal, masukPada, ...b }) => ({ conversationId: null, pesanPertama: null, ...b }));
}

const transaksi = (db, fn, timeoutMs = 25_000) => db.$transaction(async (tx) => {
  await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`);
  return fn(tx);
}, { timeout: timeoutMs + 5_000, maxWait: 5_000 });

/** GET /chat: satu halaman daftar chat beserta hitungan per saringan. */
export async function hitungDaftarChat(db, parameter, f) {
  return transaksi(db, async (tx) => {
    const semua = await muatBaris(tx, parameter, f);
    const jumlah = { semua: semua.length, order: semua.filter((b) => b.berOrder).length, spam: semua.filter((b) => b.spam).length };
    const tersaring = f.hasil === "order" ? semua.filter((b) => b.berOrder) : f.hasil === "spam" ? semua.filter((b) => b.spam) : semua;
    const mulai = (f.halaman - 1) * UKURAN_HALAMAN;
    const baris = await lengkapiPercakapan(tx, tersaring.slice(mulai, mulai + UKURAN_HALAMAN));
    return { periode: { dari: parameter.dari, sampai: parameter.sampai }, jumlah, total: tersaring.length, halaman: f.halaman, ukuranHalaman: UKURAN_HALAMAN, adaLagi: mulai + UKURAN_HALAMAN < tersaring.length, baris };
  });
}

// ── EXCEL ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const RUPIAH = '"Rp"#,##0';
function lembar(wb, nama, kolom, baris, catatan = null) {
  const ws = wb.addWorksheet(nama, { views: [{ state: "frozen", ySplit: catatan ? 2 : 1 }] });
  if (catatan) { ws.addRow([catatan]); ws.getRow(1).font = { italic: true, color: { argb: "FF5B5F66" } }; }
  const kepala = ws.addRow(kolom.map((k) => k.judul));
  kepala.font = { bold: true };
  kepala.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0F2" } }; });
  kolom.forEach((k, i) => { const col = ws.getColumn(i + 1); col.width = k.lebar || 16; if (k.rupiah) col.numFmt = RUPIAH; });
  for (const b of baris) ws.addRow(kolom.map((k) => k.nilai(b)));
  return ws;
}
const namaTahap = { NEW: "Lead baru", PROSPECT: "Prospek", TRANSACTION: "Transaksi", REVIEWED: "Sudah ulasan", SPAM: "Spam" };

/** MURNI terhadap DB: membangun workbook dari data yang sudah dihitung. `asalUrl` tanpa garis miring penutup. */
export async function bangunExcelMarketing({ sumber, iklan, chat, periode, asalUrl }) {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const uang = (v) => (v == null ? null : Number(v));
  lembar(wb, "Ringkasan Sumber", [
    { judul: "Kelompok", lebar: 22, nilai: (s) => s.kelompok }, { judul: "Channel", lebar: 32, nilai: (s) => s.label }, { judul: "Tingkat bukti", lebar: 16, nilai: (s) => s.tingkatBukti },
    { judul: "Lead", nilai: (s) => s.lead }, { judul: "Spam", nilai: (s) => s.spam }, { judul: "Lead sah", nilai: (s) => s.leadSah }, { judul: "Customer ber-order", nilai: (s) => s.berOrder }, { judul: "Customer membayar", nilai: (s) => s.membayar }, { judul: "Customer lunas", nilai: (s) => s.lunas },
    { judul: "Nilai order", rupiah: true, nilai: (s) => uang(s.uang.nilaiOrderSaatIni) }, { judul: "Uang diterima bersih", rupiah: true, nilai: (s) => uang(s.uang.uangBersih) }, { judul: "Biaya", rupiah: true, nilai: (s) => uang(s.biaya?.spend) },
  ], sumber.sumber, `Periode ${periode.dari} s.d. ${periode.sampai} (tanggal lead, WIB). Biaya kosong berarti tidak tersedia atau belum lengkap, bukan Rp0.`);
  const barisIklan = (iklan.grup || []).filter((g) => g.status !== "UNKNOWN");
  lembar(wb, "Per Iklan", [
    { judul: "Campaign", lebar: 44, nilai: (g) => g.campaign?.nama ?? "Belum terpetakan" }, { judul: "ID campaign", lebar: 18, nilai: (g) => g.campaign?.id ?? "" }, { judul: "Ad set", lebar: 40, nilai: (g) => g.adSet?.nama ?? "Belum terpetakan" }, { judul: "ID ad set", lebar: 18, nilai: (g) => g.adSet?.id ?? "" },
    { judul: "Iklan", lebar: 40, nilai: (g) => g.ad?.nama ?? "Belum terpetakan" }, { judul: "ID iklan", lebar: 18, nilai: (g) => g.ad?.id ?? "" },
    { judul: "Lead terbukti", nilai: (g) => g.lead.unik }, { judul: "Spam", nilai: (g) => g.lead.spam }, { judul: "Customer ber-order", nilai: (g) => g.customerDenganOrder }, { judul: "Customer membayar", nilai: (g) => g.customerPernahMembayar }, { judul: "Customer lunas", nilai: (g) => g.closingUtama.customerLunasTerbuktiLedger },
    { judul: "Nilai order", rupiah: true, nilai: (g) => uang(g.bookedValue) }, { judul: "Uang diterima bersih", rupiah: true, nilai: (g) => uang(g.uangBersihLedger) }, { judul: "Biaya", rupiah: true, nilai: (g) => uang(g.biaya?.spend) },
  ], barisIklan, "Hanya lead dengan touch iklan CTWA terbukti. Lead tanpa ID iklan ada di lembar Daftar Chat dengan keterangan Iklan tidak terbaca.");
  const labelSumber = new Map(SUMBER.map((s) => [s.id, s.label]));
  const wsChat = lembar(wb, "Daftar Chat", [
    { judul: "Tanggal masuk (WIB)", lebar: 18, nilai: (b) => b.tanggal }, { judul: "Nama", lebar: 24, nilai: (b) => b.nama ?? "" }, { judul: "Nomor", lebar: 16, nilai: (b) => b.nomor ?? "" },
    { judul: "Channel", lebar: 30, nilai: (b) => labelSumber.get(b.sumberId) ?? "Bukan lead pemasaran" }, { judul: "Keterangan sumber", lebar: 42, nilai: (b) => b.keterangan ?? "" },
    { judul: "Campaign", lebar: 40, nilai: (b) => b.iklan?.campaignNama ?? (b.sumberLabel === "META_ADS" ? TEKS_TANPA_BUKTI_IKLAN : "") }, { judul: "Ad set", lebar: 36, nilai: (b) => b.iklan?.adSetNama ?? "" }, { judul: "Iklan", lebar: 36, nilai: (b) => b.iklan?.adNama ?? "" }, { judul: "ID iklan", lebar: 18, nilai: (b) => b.iklan?.adId ?? "" },
    { judul: "Pesan pertama", lebar: 50, nilai: (b) => b.pesanPertama ?? "" }, { judul: "Sales", lebar: 16, nilai: (b) => b.sales ?? "" }, { judul: "Tahap", lebar: 12, nilai: (b) => namaTahap[b.stage] ?? b.stage ?? "" },
    { judul: "Jumlah order", nilai: (b) => b.jumlahOrder }, { judul: "Nilai order", rupiah: true, nilai: (b) => b.nilaiOrder || 0 }, { judul: "Status bayar", lebar: 14, nilai: (b) => b.statusBayar ?? "" },
    { judul: "Buka chat", lebar: 12, nilai: (b) => (b.conversationId ? { text: "Buka chat", hyperlink: `${asalUrl}/inbox?conv=${b.conversationId}` } : "") },
  ], chat);
  wsChat.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 16 } };
  return wb.xlsx.writeBuffer();
}

/** GET /ekspor.xlsx. Lembar Daftar Chat mengikuti pemilih (bila ada) dan saringan hasil; dua lembar lain selalu seluruh periode. */
export async function hitungEksporMarketing(db, parameter, f, { asalUrl }) {
  const sumber = await hitungSumberPerforma(db, parameter);
  const iklan = await hitungLaporanIklan(db, { dari: parameter.dari, sampai: parameter.sampai, level: "ad", sinyal: "CTWA_AD", rincian: false, hariIni: parameter.hariIni, bawaan: false, filter: null });
  const chat = await transaksi(db, async (tx) => {
    const semua = await muatBaris(tx, parameter, f);
    const tersaring = f.hasil === "order" ? semua.filter((b) => b.berOrder) : f.hasil === "spam" ? semua.filter((b) => b.spam) : semua;
    return lengkapiPercakapan(tx, tersaring);
  }, 45_000);
  const berkas = await bangunExcelMarketing({ sumber, iklan, chat, periode: parameter, asalUrl });
  return { berkas, namaFile: `Marketing_${parameter.dari}_${parameter.sampai}.xlsx`, jumlahChat: chat.length };
}
