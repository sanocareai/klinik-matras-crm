// ATRIBUSI — KOHORT D7 (observasi 7 hari PENUH sejak akuisisi), dibangun dari HISTORI, bukan dari status sekarang. BACA-SAJA.
//
// Definisi (Okt 2026):
//   • Kohort D7 = lead (customer BARU dengan touch CTWA_AD terbukti) yang dibuat pada hari-hari yang SELURUHNYA sudah berumur ≥ 7 hari (hari d matang bila akhir hari d + 7 hari ≤ sekarang).
//     Hari yang belum matang TIDAK dihitung (tanpa sensor/ekstrapolasi) dan dilaporkan sebagai `belumMatang`.
//   • Akhir jendela tiap lead = waktu dibuat + 7×24 jam. Yang dihitung hanya kejadian yang sudah tercatat ≤ akhir jendela:
//       - order: dibuat ≤ akhir DAN status PADA akhir (dari order_status_transitions) bukan CANCELLED/PENDING (status sekarang TIDAK dipakai);
//       - pembayaran: dicatat ≤ akhir, tidak dibatalkan ≤ akhir (batal SESUDAH akhir tetap sah di D7), dan — bila gerbang verifikasi menyala untuk pembayaran sesudah tanggal mulai — diverifikasi ≤ akhir;
//       - refund disetujui ≤ akhir;  - prospek = transisi stage ke PROSPECT/TRANSACTION/REVIEWED tercatat ≤ akhir (stage sekarang TIDAK dipakai).
//   • Biaya D7 memakai spend pada HARI-HARI KOHORT YANG SAMA (bukan seluruh periode) dan hanya bila setiap hari kohort punya baris spend; selain itu null dengan alasan.
//   • Akuisisi (campaign) dipisah dari UNMAPPED, UNKNOWN (touch tanpa bukti akuisisi), dan reaktivasi (touch pada customer lama). Dua yang terakhir tidak masuk kohort.
// KETERBATASAN yang jujur (dinyatakan di `batasan`): nilai order/tagihan memakai nilai bersih SEKARANG (nota kredit sesudah D7 tidak direkonstruksi); order tanpa riwayat status memakai status sekarang.
import { alasanBukanLead, jejakPembayaran, hariWIB } from "./cohort.js";
import { ORDER_EXCLUDED_STATUS, STAGE_PROSPEK_ATAU_LANJUT } from "./cohortDefinitions.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../../utils/wib.js";
import { muatMasukanKohort } from "./cohortLoader.js";
import { muatSpendPerAd } from "./spend.js";
import { getVerificationGate } from "../finance/settings.js";
// order dari muatMasukanKohort sudah membawa value = nilaiBersih (nota kredit aktif); pemanggilan ini hanya mengembalikannya
import { nilaiBersih } from "../orderNilaiBersih.js";

export const D7_JAM = 7 * 24 * 3600 * 1000;
const DAY = 86_400_000;
const rp = (x) => Math.round((Number(x) || 0) * 100) / 100;
const n2 = (x) => (x === null || x === undefined ? null : Math.round(Number(x) * 100) / 100);
const ms = (d) => new Date(d).getTime();
const awalHariWIB = (ymd) => Date.parse(`${ymd}T00:00:00+07:00`);
const geser = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Hari terakhir (≤ sampai) yang SELURUHNYA sudah berumur ≥ 7 hari pada `now`; null bila tidak ada di [dari, sampai]. */
export function hariMatangTerakhir({ dari, sampai, now }) {
  for (let h = sampai; h >= dari; h = geser(h, -1)) if (awalHariWIB(h) + DAY + D7_JAM <= ms(now)) return h;
  return null;
}

/** Status order PADA waktu `t` dari riwayat transisi (asc). `riwayat=false` bila tidak ada riwayat sama sekali (status sekarang dipakai). */
export function statusPada(order, transisi, t) {
  const tr = transisi || [];
  // Tanpa riwayat: order yang statusnya tidak pernah berubah masih PENDING (bawaan). Status lain TANPA transisi = riwayat tidak tercatat → TIDAK DIKETAHUI (bukan ditebak dari status sekarang).
  if (!tr.length) return order.status === "PENDING" ? { status: "PENDING", riwayat: false, tidakDiketahui: false } : { status: order.status, riwayat: false, tidakDiketahui: true };
  let s = tr[0].fromStatus;
  for (const x of tr) { if (ms(x.createdAt) <= t) s = x.toStatus; else break; }
  return { status: s, riwayat: true, tidakDiketahui: false };
}

const kosongGrup = () => ({ leadUnik: 0, spam: 0, leadSah: 0, prospek: 0, prospekTanpaTanggal: 0, customerOrder: 0, customerPernahBayar: 0, customerDp: 0, orderDp: 0, customerLunas: 0, orderLunas: 0, orderEligible: 0, nilaiOrderSaatIni: 0, uangLedger: 0, refund: 0, uangBersih: 0, customerOrderStatusTidakDiketahui: 0, orderStatusTidakDiketahui: 0, kategoriEksklusif: { belumBayar: 0, dpSaatD7: 0, lunas: 0 } });

/**
 * MURNI. Menyusun hasil D7.
 * @param {object} p
 *  now, dari, sampai (hari WIB lead), hariIni, mulaiHari (hari WIB touch pertama | null)
 *  leadSemua   : jumlah SEMUA customer baru di [dari,sampai] (untuk coverage atribusi)
 *  customers   : customer akuisisi-terbukti yang dibuat di [dari,sampai]: {id, createdAt, pipelineStage, leadSource, isInternalStaff, staffUserId, transitions:[{toStage,createdAt}]}
 *  akuisisi    : Map customerId -> adId (touch CTWA_AD NEW pertama)
 *  touchLain   : [{customerId, customerStatusAtTouch}]  touch iklan pada lead rentang yang BUKAN akuisisi terbukti (UNKNOWN/EXISTING)
 *  reaktivasiCustomer : jumlah customer unik dengan touch EXISTING di rentang
 *  referensi   : Map adId -> {campaignId, campaignName}
 *  orders      : [{id, customerId, createdAt, status, value, tagihan, penjualanKaryawanId}]
 *  transisi    : Map orderId -> [{fromStatus,toStatus,createdAt}] asc
 *  payments    : [{id, orderId, amount, createdAt, cancelledAt, verifiedAt, alokasi:[{orderId,amount}]}]  (TERMASUK yang dibatalkan/belum diverifikasi)
 *  refunds     : [{orderId, amount, approvedAt, date, status}]
 *  gate        : {enabled, since}
 *  spend       : null | {spendPerAd:[{adId,spend,impressions,linkClicks,platformConversations}], hariTersedia:[YYYY-MM-DD], terhubung:boolean}
 */
export function susunD7(p) {
  const { now, dari, sampai, hariIni, mulaiHari = null, leadSemua = null, customers, akuisisi, touchLain = [], reaktivasiCustomer = 0, referensi, orders, transisi = new Map(), payments, refunds, gate = { enabled: false, since: null }, spend = null } = p;
  const matang = hariMatangTerakhir({ dari, sampai, now });
  const batasan = [
    "nilaiOrderSaatIni = nilai order/tagihan bersih SAAT INI (BUKAN nilai historis D7; nota kredit sesudah D7 tidak direkonstruksi). Jangan membacanya sebagai 'booked D7'.",
    "Order dengan status selain PENDING tetapi tanpa riwayat transisi → status pada D7 TIDAK DIKETAHUI: tidak dihitung dan dilaporkan (orderStatusTidakDiketahui).",
    "customerDp (pernah DP), customerLunas, dan customerPernahBayar TIDAK eksklusif (satu customer bisa DP lalu lunas); gunakan kategoriEksklusif (lunas > DP saat D7 > belum bayar) untuk pembagian saling lepas.",
    "Tanggal pembayaran = waktu pencatatan di sistem, bukan tanggal uang diterima.",
    "Customer pernah membayar/DP/lunas dihitung dari pembayaran yang tercatat di ledger; pembayaran di luar sistem tidak terlihat.",
    "Prospek = penandaan manual sales yang BERTANGGAL (transisi stage); penandaan tanpa tanggal tidak dihitung di D7.",
  ];
  const base = { versi: 1, definisi: "D7 = setiap lead memiliki observasi 7 hari penuh; kejadian dihitung sampai 7×24 jam sejak lead dibuat dan dibaca dari histori (bukan status sekarang).", batasan };
  const periode = { dari, sampai, hariIni, hariMatangTerakhir: matang, cohortDari: matang ? dari : null, cohortSampai: matang };
  const ids = new Set(customers.map((c) => c.id));
  const adaAkuisisi = new Set([...akuisisi.keys()].filter((id) => ids.has(id)));
  const unknownIds = new Set(touchLain.filter((t) => !adaAkuisisi.has(t.customerId)).map((t) => t.customerId));
  const leadRentang = leadSemua ?? (adaAkuisisi.size + unknownIds.size);
  const bagianRentang = { leadDiRentang: leadRentang, akuisisiTerbukti: adaAkuisisi.size, touchTanpaBukti: unknownIds.size, tanpaTouch: Math.max(0, leadRentang - adaAkuisisi.size - unknownIds.size) };
  if (!matang) {
    return { ...base, status: "BELUM_TERSEDIA", alasan: "BELUM_ADA_LEAD_BERUMUR_7_HARI", periode, grup: [], total: null, unknown: { lead: unknownIds.size }, reaktivasi: { customerUnik: reaktivasiCustomer }, coverage: { atribusi: bagianRentang, belumMatang: { lead: adaAkuisisi.size } } };
  }

  const tglWib = (c) => hariWIB(c.createdAt);
  const kohort = customers.filter((c) => adaAkuisisi.has(c.id) && tglWib(c) >= dari && tglWib(c) <= matang);
  const belumMatang = customers.filter((c) => adaAkuisisi.has(c.id) && tglWib(c) > matang).length;
  const custById = new Map(customers.map((c) => [c.id, c]));
  const ordersBy = new Map(); for (const o of orders) (ordersBy.get(o.customerId) || ordersBy.set(o.customerId, []).get(o.customerId)).push(o);
  // kontribusi mentah per order (alokasi dipecah)
  const kontribMentah = new Map();
  for (const py of payments) {
    const bagian = (py.alokasi && py.alokasi.length) ? py.alokasi.filter((a) => Number(a.amount) > 0).map((a) => ({ orderId: a.orderId, amount: Math.round(Number(a.amount)) })) : [{ orderId: py.orderId, amount: Number(py.amount) }];
    for (const b of bagian) (kontribMentah.get(b.orderId) || kontribMentah.set(b.orderId, []).get(b.orderId)).push({ id: `${py.id}:${b.orderId}`, amount: b.amount, createdAt: py.createdAt, cancelledAt: py.cancelledAt ?? null, verifiedAt: py.verifiedAt ?? null });
  }
  const refundPer = new Map(); for (const r of refunds) if (r.status === "DISETUJUI") (refundPer.get(r.orderId) || refundPer.set(r.orderId, []).get(r.orderId)).push(r);

  const grupMap = new Map(); const g = (k, info) => grupMap.get(k) || grupMap.set(k, { kunci: k, ...info, ...kosongGrup() }).get(k);
  const cov = { orderEligible: 0, orderDenganPembayaran: 0, orderTanpaRiwayatStatus: 0, paymentSetelahD7Diabaikan: 0, paymentDibatalkanSebelumD7: 0, paymentBatalSetelahD7TetapSah: 0, paymentBelumTerverifikasiPadaD7: 0, orderBatalSebelumD7: 0, orderBatalTanpaRiwayat: 0, orderBatalSetelahD7TetapDihitung: 0 };
  const denganRef = (adId) => referensi.get(adId) || null;

  for (const c of kohort) {
    const ref = denganRef(akuisisi.get(c.id)); const kunci = ref ? ref.campaignId : "UNMAPPED";
    const x = g(kunci, ref ? { status: "MAPPED", campaign: { id: ref.campaignId, nama: ref.campaignName ?? null } } : { status: "UNMAPPED", campaign: null });
    const akhir = ms(c.createdAt) + D7_JAM; const alasan = alasanBukanLead(c);
    x.leadUnik++;
    if (alasan === "SPAM") x.spam++;
    if (alasan) continue;
    x.leadSah++;
    const trProspek = (c.transitions || []).filter((t) => STAGE_PROSPEK_ATAU_LANJUT.includes(t.toStage));
    if (trProspek.some((t) => ms(t.createdAt) <= akhir)) x.prospek++; else if (!trProspek.length && STAGE_PROSPEK_ATAU_LANJUT.includes(c.pipelineStage)) x.prospekTanpaTanggal++;
    let adaOrder = false, adaBayar = false, adaDp = false, adaLunas = false, adaDpKini = false, adaTidakDiketahui = false;
    for (const o of ordersBy.get(c.id) || []) {
      if (o.penjualanKaryawanId || ms(o.createdAt) > akhir) continue;
      const sp = statusPada(o, transisi.get(o.id), akhir);
      if (sp.tidakDiketahui) { cov.orderTanpaRiwayatStatus++; x.orderStatusTidakDiketahui++; adaTidakDiketahui = true; continue; }   // riwayat status tidak tersedia: TIDAK dihitung sebagai order D7 (dan tidak ditebak)
      if (ORDER_EXCLUDED_STATUS.includes(sp.status)) { if (sp.status === "CANCELLED") { if (sp.riwayat) cov.orderBatalSebelumD7++; else cov.orderBatalTanpaRiwayat++; } continue; }
      if (o.status === "CANCELLED") cov.orderBatalSetelahD7TetapDihitung++;
      // pembayaran sah PADA akhir jendela
      const kontribusi = [];
      for (const k of kontribMentah.get(o.id) || []) {
        if (ms(k.createdAt) > akhir) { cov.paymentSetelahD7Diabaikan++; continue; }
        if (k.cancelledAt && ms(k.cancelledAt) <= akhir) { cov.paymentDibatalkanSebelumD7++; continue; }
        if (gate.enabled && gate.since && ms(k.createdAt) >= ms(gate.since) && !(k.verifiedAt && ms(k.verifiedAt) <= akhir)) { cov.paymentBelumTerverifikasiPadaD7++; continue; }
        if (k.cancelledAt) cov.paymentBatalSetelahD7TetapSah++;
        kontribusi.push(k);
      }
      const rf = (refundPer.get(o.id) || []).filter((r) => ms(r.approvedAt || r.date) <= akhir);
      const j = jejakPembayaran(kontribusi, o.tagihan != null ? o.tagihan : nilaiBersih(o), rf);
      adaOrder = true; x.orderEligible++; cov.orderEligible++; x.nilaiOrderSaatIni += rp(nilaiBersih(o));
      if (j.jumlahPembayaran > 0) { cov.orderDenganPembayaran++; adaBayar = true; }
      if (j.pernahDp) { adaDp = true; x.orderDp++; }
      if (j.status === "DP") adaDpKini = true;
      if (j.status === "LUNAS") { adaLunas = true; x.orderLunas++; }
      x.uangLedger += j.kotor; x.refund += j.refund; x.uangBersih += j.bersih;
    }
    if (adaOrder) { x.customerOrder++; if (adaLunas) x.kategoriEksklusif.lunas++; else if (adaDpKini) x.kategoriEksklusif.dpSaatD7++; else x.kategoriEksklusif.belumBayar++; }
    if (adaTidakDiketahui) x.customerOrderStatusTidakDiketahui++;
    if (adaBayar) x.customerPernahBayar++; if (adaDp) x.customerDp++; if (adaLunas) x.customerLunas++;
  }

  // ── SPEND pada hari-hari kohort yang sama ──
  const hariKohort = []; for (let h = dari; h <= matang; h = geser(h, 1)) hariKohort.push(h);
  let spendStatus = "BELUM_TERHUBUNG"; let hariHilang = []; const spendPer = new Map(); let spendUnmapped = 0;
  if (spend && spend.terhubung) {
    const ada = new Set(spend.hariTersedia || []); hariHilang = hariKohort.filter((h) => !ada.has(h));
    for (const s of spend.spendPerAd || []) { const ref = denganRef(s.adId); const k = ref ? ref.campaignId : "UNMAPPED"; const a = spendPer.get(k) || { spend: 0, ref }; a.spend = rp(a.spend + s.spend); spendPer.set(k, a); if (!ref) spendUnmapped = rp(spendUnmapped + s.spend); }
    spendStatus = mulaiHari === null || dari < mulaiHari ? "SEBELUM_ATRIBUSI" : dari === mulaiHari ? "HARI_ATRIBUSI_PARSIAL" : hariHilang.length ? "SPEND_TIDAK_LENGKAP" : "LENGKAP";
  }
  for (const [k, a] of spendPer) if (!grupMap.has(k)) g(k, k === "UNMAPPED" ? { status: "UNMAPPED", campaign: null } : { status: "MAPPED", campaign: { id: k, nama: a.ref?.campaignName ?? null } });
  const biayaDari = (x, S) => {
    const lengkap = spendStatus === "LENGKAP"; const alasan = spendStatus === "BELUM_TERHUBUNG" ? "BELUM_ADA_SPEND" : lengkap ? null : spendStatus;
    const bagi = (a, b, alasanB) => (!lengkap ? { nilai: null, alasan } : !(b > 0) ? { nilai: null, alasan: alasanB } : { nilai: n2(a / b), alasan: null });
    const roas = (v) => (!lengkap ? { nilai: null, alasan } : S > 0 ? { nilai: n2(v / S), alasan: null } : { nilai: null, alasan: "SPEND_NOL" });
    return { status: spendStatus, spend: spendStatus === "BELUM_TERHUBUNG" ? null : S, cpl: bagi(S, x.leadSah, "BELUM_ADA_KONVERSI"), biayaPerCustomerPernahBayar: bagi(S, x.customerPernahBayar, "BELUM_ADA_KONVERSI"), biayaPerCustomerDp: bagi(S, x.customerDp, "BELUM_ADA_KONVERSI"), cpaLunas: bagi(S, x.customerLunas, "BELUM_ADA_KONVERSI"), roasNilaiOrderSaatIni: roas(x.nilaiOrderSaatIni), cashRoas: roas(x.uangBersih) };
  };
  const grup = [...grupMap.values()].map((x) => { const S = spendPer.get(x.kunci)?.spend ?? 0; return { ...x, uangLedger: rp(x.uangLedger), refund: rp(x.refund), uangBersih: rp(x.uangBersih), nilaiOrderSaatIni: rp(x.nilaiOrderSaatIni), biaya: biayaDari(x, S) }; }).sort((a, b) => b.leadUnik - a.leadUnik || (a.kunci < b.kunci ? -1 : 1));
  const total = kosongGrup(); for (const x of grup) for (const f of Object.keys(total)) { if (f === "kategoriEksklusif") { for (const k of Object.keys(total[f])) total[f][k] += x[f][k]; } else total[f] = rp(total[f] + x[f]); }
  const spendTotal = rp([...spendPer.values()].reduce((s, a) => s + a.spend, 0));
  const biayaTotal = biayaDari(total, spendTotal);
  const rekonsiliasi = { ok: grup.reduce((s, x) => s + x.leadUnik, 0) === kohort.length && total.leadUnik === kohort.length, kohortLead: kohort.length, sigmaGrup: grup.reduce((s, x) => s + x.leadUnik, 0), spendSigmaGrup: rp(grup.reduce((s, x) => s + (x.biaya.spend ?? 0), 0)), spendTotal };
  return {
    ...base, status: "TERSEDIA", periode: { ...periode, hariAtribusiParsial: mulaiHari !== null && mulaiHari >= dari && mulaiHari <= matang, atribusiMulai: mulaiHari }, grup, total: { ...total, biaya: biayaTotal }, rekonsiliasi,
    unknown: { lead: unknownIds.size, catatan: "touch iklan tanpa bukti akuisisi; tidak masuk kohort" }, reaktivasi: { customerUnik: reaktivasiCustomer, catatan: "touch pada customer lama; tidak masuk kohort" },
    coverage: {
      atribusi: { ...bagianRentang, persenAkuisisiTerbukti: leadRentang ? n2((adaAkuisisi.size / leadRentang) * 100) : null, terpetakanCampaign: kohort.filter((c) => denganRef(akuisisi.get(c.id))).length, unmapped: kohort.filter((c) => !denganRef(akuisisi.get(c.id))).length },
      belumMatang: { lead: belumMatang, catatan: `hari sesudah ${matang} belum berumur 7 hari penuh` },
      ledger: { orderEligible: cov.orderEligible, orderDenganPembayaran: cov.orderDenganPembayaran, persenOrderBerLedger: cov.orderEligible ? n2((cov.orderDenganPembayaran / cov.orderEligible) * 100) : null, orderTanpaRiwayatStatus: cov.orderTanpaRiwayatStatus },
      histori: { paymentSetelahD7Diabaikan: cov.paymentSetelahD7Diabaikan, paymentDibatalkanSebelumD7: cov.paymentDibatalkanSebelumD7, paymentBatalSetelahD7TetapSah: cov.paymentBatalSetelahD7TetapSah, paymentBelumTerverifikasiPadaD7: cov.paymentBelumTerverifikasiPadaD7, orderBatalSebelumD7: cov.orderBatalSebelumD7, orderBatalTanpaRiwayat: cov.orderBatalTanpaRiwayat, orderBatalSetelahD7TetapDihitung: cov.orderBatalSetelahD7TetapDihitung },
      spend: { status: spendStatus, hariKohort: hariKohort.length, hariHilang, spendTidakTerpetakan: spendUnmapped, catatan: "spend hanya pada hari-hari kohort yang sama dengan lead; null bila ada hari tanpa baris spend, sebelum/awal hari atribusi, atau belum terhubung" },
    },
  };
}

// ── pemuat (READ ONLY) ───────────────────────────────────────────────────────────────────────────────────────

export async function hitungD7(db, { dari, sampai, hariIni }, { now = new Date(), timeoutMs = 25_000 } = {}) {
  const lo = startOfDayWIB(dari), hi = endOfDayExclusiveWIB(sampai);
  const tglDari = new Date(`${dari}T00:00:00.000Z`), tglSampai = new Date(`${sampai}T00:00:00.000Z`);
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(Number(timeoutMs)))}`);
    const akuisisiRaw = await tx.attributionTouch.findMany({ where: { customerStatusAtTouch: "NEW", evidenceSource: "CTWA_AD", customer: { createdAt: { gte: lo, lt: hi } } }, select: { id: true, customerId: true, adId: true }, orderBy: [{ touchAt: "asc" }, { id: "asc" }] });
    const akuisisi = new Map(); for (const t of akuisisiRaw) if (!akuisisi.has(t.customerId)) akuisisi.set(t.customerId, t.adId);
    const touchLain = await tx.attributionTouch.findMany({ where: { evidenceSource: "CTWA_AD", customerStatusAtTouch: { in: ["UNKNOWN", "EXISTING"] }, customer: { createdAt: { gte: lo, lt: hi } } }, select: { customerId: true, customerStatusAtTouch: true } });
    const reakt = await tx.attributionTouch.findMany({ where: { evidenceSource: "CTWA_AD", customerStatusAtTouch: "EXISTING", touchDateWib: { gte: tglDari, lte: tglSampai } }, select: { customerId: true } });
    const leadSemua = await tx.customer.count({ where: { createdAt: { gte: lo, lt: hi } } });
    const idsRef = [...new Set(akuisisi.values())];
    const refRows = idsRef.length ? await tx.metaAdReference.findMany({ where: { adId: { in: idsRef } } }) : [];
    const referensi = new Map(refRows.map((r) => [r.adId, r]));
    const { meta, ...m } = await muatMasukanKohort(tx, { customerIds: [...akuisisi.keys()] });
    const orderIds = m.orders.map((o) => o.id);
    const gate = await getVerificationGate(tx);
    const pay = orderIds.length ? await tx.payment.findMany({ where: { OR: [{ orderId: { in: orderIds } }, { finAllocations: { some: { orderId: { in: orderIds } } } }] }, select: { id: true, orderId: true, amount: true, createdAt: true, cancelledAt: true, verifications: { select: { createdAt: true } }, finAllocations: { select: { orderId: true, amount: true } } } }) : [];
    const payments = pay.map((p) => ({ id: p.id, orderId: p.orderId, amount: p.amount, createdAt: p.createdAt, cancelledAt: p.cancelledAt, verifiedAt: p.verifications?.[0]?.createdAt ?? null, alokasi: (p.finAllocations || []).map((a) => ({ orderId: a.orderId, amount: Number(a.amount) })) }));
    const tr = orderIds.length ? await tx.orderStatusTransition.findMany({ where: { orderId: { in: orderIds } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { orderId: true, fromStatus: true, toStatus: true, createdAt: true } }) : [];
    const transisi = new Map(); for (const t of tr) (transisi.get(t.orderId) || transisi.set(t.orderId, []).get(t.orderId)).push(t);
    const matang = hariMatangTerakhir({ dari, sampai, now });
    let spend = null;
    if (matang) {
      const sp = await muatSpendPerAd(tx, { dari, sampai: matang });
      const idsBaru = sp.spendPerAd.map((x) => x.adId).filter((id) => !referensi.has(id));
      if (idsBaru.length) for (const r of await tx.metaAdReference.findMany({ where: { adId: { in: idsBaru } } })) referensi.set(r.adId, r);
      const [ada] = await tx.$queryRaw`SELECT (SELECT count(*)::int FROM meta_ad_daily_spend) AS n`;
      spend = { terhubung: ada.n > 0, spendPerAd: sp.spendPerAd, hariTersedia: sp.kesegaranMentah.hariTersedia };
    }
    const agg = await tx.attributionTouch.aggregate({ _min: { touchAt: true } });
    const mulaiHari = agg._min.touchAt ? hariWIB(agg._min.touchAt) : null;
    const hasil = susunD7({ now, dari, sampai, hariIni, mulaiHari, leadSemua, customers: m.customers, akuisisi, touchLain, reaktivasiCustomer: new Set(reakt.map((r) => r.customerId)).size, referensi, orders: m.orders, transisi, payments, refunds: m.refunds, gate, spend });
    return hasil;
  }, { timeout: timeoutMs + 5_000, maxWait: 5_000 });
}
