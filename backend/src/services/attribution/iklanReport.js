// ATRIBUSI CTWA FASE 2 — laporan lead dan closing per Campaign / Ad Set / Ad. BACA-SAJA (transaksi READ ONLY di sisi DB).
//
// ATRIBUSI UTAMA hanya sinyal CTWA_AD. AD_REPLY_UNMARKED (balasan ke iklan tanpa penanda CTWA) direkam sebagai AUDIT dan dilaporkan di blok `audit`;
// ia TIDAK pernah masuk lead/closing/grup.
// Closing UTAMA untuk keputusan biaya = customer yang punya >= 1 order eligible LUNAS TERBUKTI LEDGER (`closingUtama`). Customer dengan order,
// order pernah DP, dan lunas menurut CRM tetap metrik terpisah (bukan closing utama).
// Akuisisi = touch CTWA valid PERTAMA pada customer yang BARU saat touch itu (customer_status_at_touch = NEW, bukti kausal), dipilih menurut (touch_at, id).
// Touch berikutnya dan touch pada customer lama disimpan terpisah (`sentuhanBerikutnya`) — TIDAK mengubah lead customer lama menjadi lead baru
// dan TIDAK pernah menggeser atribusi lead.
//
// Semua definisi uang/lunas/DP memakai `buildCohort` Fase 1 (cohort.js) PER GRUP — tidak ada definisi kedua. Tiga tanggal dipisah:
//   tanggal lead (Customer.createdAt) menentukan kohort; tanggal order (Order.createdAt) dan tanggal pembayaran (Payment.createdAt) ada di `rincian`.
// Satu customer ada di TEPAT SATU grup; satu order dihitung sekali. Rekonsiliasi: Σ grup = total teratribusi.
//
// Biaya: TIDAK ada integrasi spend Meta di sistem ini → CPA/ROAS null (status BELUM_TERHUBUNG). Tidak ada atribusi historis sebelum touch tersimpan.
import { startOfDayWIB, endOfDayExclusiveWIB, nowPartsWIB } from "../../utils/wib.js";
import { buildCohort, alasanBukanLead, jejakPembayaran, bulanWIB, hariWIB } from "./cohort.js";
import { ORDER_EXCLUDED_STATUS, PAID_AT_BACKFILL_31_AGT, METRICS } from "./cohortDefinitions.js";
import { muatMasukanKohort } from "./cohortLoader.js";
// Baris order dari muatMasukanKohort sudah membawa value = nilaiBersih (Okt 2026); memanggil nilaiBersih(o) di sini hanya mengembalikannya (tanpa orderCredits = tanpa potongan kedua).
import { nilaiBersih } from "../orderNilaiBersih.js";
import { muatSpendPerAd } from "./spend.js";
import { terapkanBiaya, kesegaranSpend, normalisasiTarget } from "./biayaKpi.js";
import { susunLaporan } from "./cohortReport.js";

export const LEVEL = Object.freeze(["campaign", "adset", "ad"]);
/** Satu-satunya sinyal atribusi utama. AD_REPLY_UNMARKED hanya audit. */
export const SINYAL_UTAMA = Object.freeze(["CTWA_AD"]);
export const SINYAL_AUDIT = "AD_REPLY_UNMARKED";
export const WINDOW_KEMATANGAN = Object.freeze([7, 30, 60]);
/** Batas rentang (hari, inklusif): beban kueri linear terhadap jumlah customer di rentang; lihat docs, bagian Performa. */
export const MAKS_HARI = 93;
const DAY = 24 * 3600 * 1000;
const UNMAPPED = "UNMAPPED";
const RE_TGL = /^\d{4}-\d{2}-\d{2}$/;

export class ParameterError extends Error {
  constructor(message) { super(message); this.statusCode = 400; this.code = "PARAMETER_TIDAK_VALID"; }
}

const tglValid = (s) => RE_TGL.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const selisihHari = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export const HARI_BAWAAN = 7;
const geserHari = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const RE_ID = /^\d{5,32}$/;

/**
 * Parameter: dari/sampai = hari WIB (YYYY-MM-DD, inklusif, tanggal LEAD). Keduanya kosong → BAWAAN HARI_BAWAAN (7) hari terakhir termasuk hari ini; hanya salah satu → 400.
 * level; rincian; filter drilldown campaignId (level adset|ad) dan adSetId (level ad). Sinyal hanya CTWA_AD (atribusi utama).
 */
export function parseParameterIklan(query = {}, now = new Date()) {
  const { year, month, day } = nowPartsWIB(now);
  const hariIni = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!!query.dari !== !!query.sampai) throw new ParameterError(`Isi 'dari' DAN 'sampai' (YYYY-MM-DD, hari WIB), atau kosongkan keduanya untuk ${HARI_BAWAAN} hari terakhir`);
  const bawaan = !query.dari && !query.sampai;
  // BAWAAN = PERIODE PENUH: 7 hari lengkap yang berakhir KEMARIN (hari berjalan dipisah, lihat biayaKpi.js#hariBerjalan). Hari ini dipilih eksplisit lewat dari=sampai=hari ini.
  const sampai = bawaan ? geserHari(hariIni, -1) : String(query.sampai);
  const dari = bawaan ? geserHari(hariIni, -HARI_BAWAAN) : String(query.dari);
  if (!tglValid(sampai)) throw new ParameterError("Parameter 'sampai' harus YYYY-MM-DD (hari WIB)");
  if (!tglValid(dari)) throw new ParameterError("Parameter 'dari' harus YYYY-MM-DD (hari WIB)");
  if (dari > sampai) throw new ParameterError("'dari' tidak boleh sesudah 'sampai'");
  if (sampai > hariIni) throw new ParameterError("'sampai' tidak boleh di masa depan");
  if (selisihHari(dari, sampai) + 1 > MAKS_HARI) throw new ParameterError(`Rentang paling lama ${MAKS_HARI} hari`);
  const level = query.level ? String(query.level) : "campaign";
  if (!LEVEL.includes(level)) throw new ParameterError(`level harus salah satu: ${LEVEL.join(", ")}`);
  const sinyal = query.sinyal ? String(query.sinyal) : "CTWA_AD";
  if (sinyal !== "CTWA_AD") throw new ParameterError("sinyal hanya mendukung CTWA_AD (AD_REPLY_UNMARKED hanya audit, tidak masuk atribusi)");
  const rincian = query.rincian === "1" || query.rincian === "true";
  const campaignId = query.campaignId ? String(query.campaignId) : null;
  const adSetId = query.adSetId ? String(query.adSetId) : null;
  if (campaignId && !RE_ID.test(campaignId)) throw new ParameterError("campaignId harus string digit (ID Meta)");
  if (adSetId && !RE_ID.test(adSetId)) throw new ParameterError("adSetId harus string digit (ID Meta)");
  if ((campaignId || adSetId) && level === "campaign") throw new ParameterError("filter campaignId/adSetId hanya untuk level adset atau ad (drilldown)");
  if (adSetId && level !== "ad") throw new ParameterError("filter adSetId hanya untuk level ad");
  return { dari, sampai, level, sinyal, rincian, hariIni, bawaan, filter: campaignId || adSetId ? { campaignId, adSetId } : null };
}

// ── Kematangan kohort: hasil DALAM N hari sejak tanggal lead, hanya untuk lead yang sudah berumur ≥ N hari (tanpa sensor) ──────────────────────────
function hitungKematangan({ leadSah, orders, kontribusi, refunds, asOf }) {
  const ordPerCust = new Map();
  for (const o of orders) {
    if (ORDER_EXCLUDED_STATUS.includes(o.status) || o.penjualanKaryawanId) continue;
    (ordPerCust.get(o.customerId) || ordPerCust.set(o.customerId, []).get(o.customerId)).push(o);
  }
  const kontribPerOrder = new Map();
  for (const k of kontribusi) (kontribPerOrder.get(k.orderId) || kontribPerOrder.set(k.orderId, []).get(k.orderId)).push(k);
  const refundPerOrder = new Map();
  for (const r of refunds) if (r.status === "DISETUJUI") (refundPerOrder.get(r.orderId) || refundPerOrder.set(r.orderId, []).get(r.orderId)).push(r);

  const out = {};
  for (const N of WINDOW_KEMATANGAN) {
    const r = { leadMatang: 0, customerDenganOrder: 0, orderEligible: 0, bookedValue: 0, lunasMenurutCrm: 0, lunasTerbuktiLedger: 0, customerLunasTerbuktiLedger: 0, uangLedger: 0 };
    for (const c of leadSah) {
      const lahir = new Date(c.createdAt).getTime();
      if (asOf.getTime() - lahir < N * DAY) continue;
      r.leadMatang++;
      const akhir = lahir + N * DAY;
      const dalam = (ordPerCust.get(c.id) || []).filter((o) => new Date(o.createdAt).getTime() <= akhir);
      if (dalam.length) r.customerDenganOrder++;
      let customerLunas = false;
      for (const o of dalam) {
        r.orderEligible++; r.bookedValue += nilaiBersih(o);
        const k = (kontribPerOrder.get(o.id) || []).filter((x) => new Date(x.createdAt).getTime() <= akhir);
        const rf = (refundPerOrder.get(o.id) || []).filter((x) => new Date(x.approvedAt || x.date).getTime() <= akhir);
        r.uangLedger += k.reduce((s, x) => s + (Number(x.amount) || 0), 0);
        const j = jejakPembayaran(k, o.tagihan != null ? o.tagihan : nilaiBersih(o), rf);
        if (j.status === "LUNAS") { r.lunasTerbuktiLedger++; customerLunas = true; }
        if (o.paymentStatus === "LUNAS" && o.paidAt && new Date(o.paidAt).getTime() !== PAID_AT_BACKFILL_31_AGT.getTime() && new Date(o.paidAt).getTime() <= akhir) r.lunasMenurutCrm++;
      }
      if (customerLunas) r.customerLunasTerbuktiLedger++;
    }
    out[`hari${N}`] = r;
  }
  return out;
}

const jumlahKunci = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

/**
 * CLOSING UTAMA (keputusan biaya): customer lead sah dengan >= 1 order eligible yang ledger valid-nya menutup SELURUH tagihan (jejakPembayaran.status = LUNAS).
 * Predikat order eligible identik dengan buildCohort. Tanggal closing customer = hari WIB lunas terbukti PERTAMA di antara order-ordernya.
 * Bukan "customer dengan order" (itu tidak menjamin bayar), bukan DP, dan bukan status LUNAS tersimpan (lunas menurut CRM).
 */
function hitungClosingUtama({ customers, orders, kontribusi, refunds }) {
  const leadSah = new Set(customers.filter((c) => !alasanBukanLead(c)).map((c) => c.id));
  const kontribPerOrder = new Map();
  for (const k of kontribusi) (kontribPerOrder.get(k.orderId) || kontribPerOrder.set(k.orderId, []).get(k.orderId)).push(k);
  const refundPerOrder = new Map();
  for (const r of refunds) if (r.status === "DISETUJUI") (refundPerOrder.get(r.orderId) || refundPerOrder.set(r.orderId, []).get(r.orderId)).push(r);
  const perCustomer = new Map();     // customerId -> hariLunas pertama (YYYY-MM-DD WIB)
  let orderLunas = 0;
  const custLunasCrm = new Set();    // customer dengan >= 1 order eligible berstatus LUNAS tersimpan (indikator operasional, BUKAN bukti uang)
  for (const o of orders) {
    if (!leadSah.has(o.customerId) || o.penjualanKaryawanId || ORDER_EXCLUDED_STATUS.includes(o.status)) continue;
    if (o.paymentStatus === "LUNAS") custLunasCrm.add(o.customerId);
    const j = jejakPembayaran(kontribPerOrder.get(o.id) || [], o.tagihan != null ? o.tagihan : nilaiBersih(o), refundPerOrder.get(o.id) || []);
    if (j.status !== "LUNAS") continue;
    orderLunas++;
    const hari = j.hariLunas;
    const lama = perCustomer.get(o.customerId);
    if (!lama || hari < lama) perCustomer.set(o.customerId, hari);
  }
  const perBulan = {};
  for (const hari of perCustomer.values()) { const b = hari.slice(0, 7); perBulan[b] = (perBulan[b] || 0) + 1; }
  return { customerLunasTerbuktiLedger: perCustomer.size, orderLunasTerbuktiLedger: orderLunas, perBulanLunasPertama: perBulan, customerLunasMenurutCrm: custLunasCrm.size };
}

/**
 * MURNI. Menyusun laporan dari masukan yang sudah dimuat.
 * @param {object} p
 * @param {{dari,sampai,level,sinyal,rincian}} p.parameter
 * @param {Date} p.asOf
 * @param {Array} p.leadBaru        semua customer yang dibuat di rentang: {id,createdAt,pipelineStage,leadSource,isInternalStaff,staffUserId}
 * @param {Array} p.touchAkuisisi   touch customer-baru pada customer di atas: {id,customerId,adId,touchAt,evidenceSource,entryPointApp}
 * @param {Array} p.touchLain       touch lain di rentang (bukan akuisisi): {id,customerId,adId,touchAt,customerNewAtTouch}
 * @param {Map}   p.referensi       adId → {adSetId,campaignId,adName,adSetName,campaignName,syncedAt,source}
 * @param {object} p.masukan        {customers(+transitions),orders,kontribusi,refunds} hanya untuk customer teratribusi
 * @param {Date|null} p.mulaiAtribusiAt  touch_at paling awal di tabel (null = belum ada touch)
 * @param {{touch:number,customerUnik:number,padaCustomerBaru:number}|null} [p.audit]  ringkasan AD_REPLY_UNMARKED (tidak masuk atribusi)
 * @param {object} [p.meta]
 */
export function susunLaporanIklan({ parameter, asOf, leadBaru, touchAkuisisi, touchLain, touchLeadLain = [], referensi, masukan, mulaiAtribusiAt, audit = null, meta = {} }) {
  const { level } = parameter;
  const filter = parameter.filter || null;
  const refOf = (adId) => referensi.get(adId) || null;
  const lolosFilter = (adId) => {            // drilldown: hanya Ad yang referensinya ada dan cocok (tidak ada tebakan)
    if (!filter) return true;
    const r = refOf(adId);
    if (!r) return false;
    return (!filter.campaignId || r.campaignId === filter.campaignId) && (!filter.adSetId || r.adSetId === filter.adSetId);
  };

  // 1. akuisisi TERBUKTI: touch pertama per customer berstatus NEW (touch_at, lalu id). Touch berikutnya tidak menggeser kredit.
  const urut = [...touchAkuisisi].sort((a, b) => new Date(a.touchAt) - new Date(b.touchAt) || (a.id < b.id ? -1 : 1));
  const akuisisiSemua = new Map();
  for (const t of urut) if (!akuisisiSemua.has(t.customerId)) akuisisiSemua.set(t.customerId, t);
  const akuisisi = new Map([...akuisisiSemua].filter(([, t]) => lolosFilter(t.adId)));
  if (filter) touchLain = touchLain.filter((t) => lolosFilter(t.adId));

  // 1b. lead baru yang punya touch iklan TANPA akuisisi terbukti: UNKNOWN (tidak ada bukti kausal webhook membuat customer) atau sudah ada sebelum touch (EXISTING saja).
  //     UNKNOWN ditampilkan sebagai BARIS sendiri (tanpa kredit campaign); EXISTING-saja hanya dihitung di cakupan. Dengan filter drilldown keduanya tidak ditampilkan.
  const jejakLain = new Map();
  for (const t of touchLeadLain) (jejakLain.get(t.customerId) || jejakLain.set(t.customerId, []).get(t.customerId)).push(t);
  const unknownCids = [], sebelumnyaCids = [], unknownAds = new Set();
  for (const [cid, ts] of jejakLain) {
    if (akuisisiSemua.has(cid)) continue;
    if (ts.some((t) => t.customerStatusAtTouch === "UNKNOWN")) { unknownCids.push(cid); for (const t of ts) unknownAds.add(t.adId); } else sebelumnyaCids.push(cid);
  }
  const UNKNOWN = "UNKNOWN";
  const unknownTampil = filter ? [] : unknownCids;

  const kunciGrup = (adId) => {
    const r = refOf(adId);
    if (level === "ad") return adId;
    if (!r) return UNMAPPED;
    return level === "adset" ? r.adSetId : r.campaignId;
  };

  // 2. grup → customer
  const custById = new Map(masukan.customers.map((c) => [c.id, c]));
  const grupCust = new Map();
  const grupAds = new Map();
  for (const [cid, t] of akuisisi) {
    const k = kunciGrup(t.adId);
    (grupCust.get(k) || grupCust.set(k, []).get(k)).push(cid);
    (grupAds.get(k) || grupAds.set(k, new Set()).get(k)).add(t.adId);
  }
  if (unknownTampil.length) { grupCust.set(UNKNOWN, [...unknownTampil]); grupAds.set(UNKNOWN, new Set(unknownAds)); }
  const ordersBy = new Map();
  for (const o of masukan.orders) (ordersBy.get(o.customerId) || ordersBy.set(o.customerId, []).get(o.customerId)).push(o);

  const subMasukan = (cids) => {
    const set = new Set(cids);
    const orders = cids.flatMap((c) => ordersBy.get(c) || []);
    const oid = new Set(orders.map((o) => o.id));
    return {
      customers: cids.map((c) => custById.get(c)).filter(Boolean),
      orders,
      kontribusi: masukan.kontribusi.filter((k) => oid.has(k.orderId)),
      refunds: masukan.refunds.filter((r) => oid.has(r.orderId)),
      _set: set,
    };
  };

  // 3. label grup
  const labelGrup = (k, ads) => {
    if (k === UNKNOWN) return { status: UNKNOWN, kreditCampaign: false, campaign: null, adSet: null, ad: null };
    if (k === UNMAPPED) return { status: UNMAPPED, kreditCampaign: false, campaign: null, adSet: null, ad: null };
    const sampel = refOf([...ads][0]);
    if (level === "ad") return { status: sampel ? "MAPPED" : UNMAPPED, campaign: sampel ? { id: sampel.campaignId, nama: sampel.campaignName } : null, adSet: sampel ? { id: sampel.adSetId, nama: sampel.adSetName } : null, ad: { id: k, nama: sampel?.adName ?? null } };
    if (level === "adset") return { status: "MAPPED", campaign: { id: sampel.campaignId, nama: sampel.campaignName }, adSet: { id: k, nama: sampel.adSetName }, ad: null };
    return { status: "MAPPED", campaign: { id: k, nama: sampel.campaignName }, adSet: null, ad: null };
  };

  const sentuhanPerGrup = new Map();
  for (const t of touchLain) {
    const k = kunciGrup(t.adId);
    const g = sentuhanPerGrup.get(k) || sentuhanPerGrup.set(k, {
      touch: 0, customer: new Set(), customerLama: 0, customerBaru: 0, customerTidakDiketahui: 0,
      reaktivasi: { touch: 0, cust: new Set() }, assisted: { touch: 0, cust: new Set() }, tanpaBukti: { touch: 0, cust: new Set() },
    }).get(k);
    g.touch++; g.customer.add(t.customerId);
    // EXISTING = REAKTIVASI customer lama; NEW (bukan touch akuisisi terpilih) = ASSISTED touch pada customer yang sudah diakuisisi; selain itu = tanpa bukti
    if (t.customerStatusAtTouch === "NEW") { g.customerBaru++; g.assisted.touch++; g.assisted.cust.add(t.customerId); }
    else if (t.customerStatusAtTouch === "EXISTING") { g.customerLama++; g.reaktivasi.touch++; g.reaktivasi.cust.add(t.customerId); }
    else { g.customerTidakDiketahui++; g.tanpaBukti.touch++; g.tanpaBukti.cust.add(t.customerId); }
  }
  const ringkasSentuhan = (x) => ({ touch: x?.touch || 0, customerUnik: x?.cust?.size || 0 });

  const grup = [];
  const semuaGrupKey = new Set([...grupCust.keys()]);
  for (const k of semuaGrupKey) {
    const cids = grupCust.get(k);
    const sm = subMasukan(cids);
    const h = buildCohort({ customers: sm.customers, orders: sm.orders, kontribusi: sm.kontribusi, refunds: sm.refunds });
    const t = h.total;
    const per = h.luarKohort.perAlasan;
    const spam = per.SPAM?.customers || 0;
    const leadSah = sm.customers.filter((c) => !alasanBukanLead(c));
    const adsSet = grupAds.get(k) || new Set();
    const sent = sentuhanPerGrup.get(k);
    const closing = hitungClosingUtama({ customers: sm.customers, orders: sm.orders, kontribusi: sm.kontribusi, refunds: sm.refunds });
    grup.push({
      kunci: k,
      level,
      ...labelGrup(k, adsSet),
      jumlahAd: adsSet.size,
      lead: {
        unik: cids.length, spam, bukanSpam: cids.length - spam, leadSah: t.leads,
        dikecualikan: { SPAM: spam, B2B_DIRECT: per.B2B_DIRECT?.customers || 0, INTERNAL_STAFF: per.INTERNAL_STAFF?.customers || 0, PROFIL_KARYAWAN: per.PROFIL_KARYAWAN?.customers || 0 },
      },
      closingUtama: {
        definisi: "customer dengan >= 1 order eligible lunas terbukti ledger",
        customerLunasTerbuktiLedger: closing.customerLunasTerbuktiLedger,
        persenDariLeadSah: t.leads > 0 ? Math.round((closing.customerLunasTerbuktiLedger / t.leads) * 1000) / 10 : null,
        orderLunasTerbuktiLedger: closing.orderLunasTerbuktiLedger,
        perBulanLunasPertama: closing.perBulanLunasPertama,
      },
      // "Pernah ditandai PROSPECT" = stage PROSPECT/TRANSACTION/REVIEWED yang diset MANUAL oleh sales (bukan "qualified lead" terukur).
      pernahDitandaiProspek: { berTanggal: t.pernahDitandaiProspekBerTanggal, tanpaTanggal: t.pernahDitandaiProspekTanpaTanggal, jumlah: t.pernahDitandaiProspekBerTanggal + t.pernahDitandaiProspekTanpaTanggal },
      customerDenganOrder: t.customerDenganOrder,
      orderEligible: t.orders,
      orderPernahDp: t.orderPernahDp,
      orderDpSaatIniLedger: t.orderDpSaatIniLedger,
      customerLunasMenurutCrm: closing.customerLunasMenurutCrm,
      lunasMenurutCrm: { jumlah: t.lunasMenurutCrm.jumlah, nilai: t.lunasMenurutCrm.nilai, tanggalTidakPasti: t.lunasMenurutCrm.tanggalTidakPasti },
      lunasTerbuktiLedger: t.lunasTerbuktiLedger,
      buktiPelunasan: t.buktiPelunasan,
      bookedValue: t.nilaiOrder,
      uangLedger: t.uangLedger, refundDisetujui: t.refundDisetujui, uangBersihLedger: t.uangBersihLedger,
      cakupanLedger: { orderBerLedger: t.orderBerLedger, orderEligible: t.orders, persenOrderBerLedger: t.orders > 0 ? Math.round((t.orderBerLedger / t.orders) * 1000) / 10 : null },
      kematangan: hitungKematangan({ leadSah, orders: sm.orders, kontribusi: sm.kontribusi, refunds: sm.refunds, asOf }),
      sentuhanBerikutnya: sent ? { touch: sent.touch, customerUnik: sent.customer.size, padaCustomerBaru: sent.customerBaru, padaCustomerLama: sent.customerLama, padaCustomerTidakDiketahui: sent.customerTidakDiketahui } : { touch: 0, customerUnik: 0, padaCustomerBaru: 0, padaCustomerLama: 0, padaCustomerTidakDiketahui: 0 },
      reaktivasi: ringkasSentuhan(sent?.reaktivasi),
      assisted: ringkasSentuhan(sent?.assisted),
      touchTanpaBukti: ringkasSentuhan(sent?.tanpaBukti),
      biaya: { status: "BELUM_TERHUBUNG", cpa: null, roas: null },
      ...(parameter.rincian ? { rincian: { perBulanLead: h.perBulanLead, perBulanOrder: h.perBulanOrder, perBulanPembayaran: h.perBulanPembayaran } } : {}),
      _cohort: h,
    });
  }
  grup.sort((a, b) => b.lead.unik - a.lead.unik || (a.kunci < b.kunci ? -1 : 1));

  // 4. total teratribusi (satu kali buildCohort atas gabungan) — pembanding rekonsiliasi dan sumber peringatan Fase 1
  //    tercakup = akuisisi terbukti (campaign + UNMAPPED) + UNKNOWN. jumlahTeratribusi = HANYA akuisisi terbukti (yang boleh diberi kredit campaign).
  const semuaCids = [...akuisisi.keys()];
  const tercakupCids = [...semuaCids, ...unknownTampil];
  const hitung = (cids) => {
    const sm = subMasukan(cids);
    const args = { customers: sm.customers, orders: sm.orders, kontribusi: sm.kontribusi, refunds: sm.refunds };
    const h = buildCohort(args);
    return { sm, h, t: h.total, closing: hitungClosingUtama(args) };
  };
  const semua = hitung(tercakupCids);
  const pro = unknownTampil.length ? hitung(semuaCids) : semua;
  const smAll = semua.sm, hAll = semua.h, tAll = semua.t, closingAll = semua.closing;
  const tPro = pro.t, closingPro = pro.closing;

  const cek = [];
  const tambah = (id, a, b, ket) => cek.push({ id, ok: a === b, a, b, ket });
  tambah("lead_unik_grup_vs_tercakup", jumlahKunci(grup, (g) => g.lead.unik), tercakupCids.length, "Σ lead unik baris (campaign + UNMAPPED + UNKNOWN) = customer baru bertouch iklan yang tercakup (tiap customer tepat satu baris)");
  tambah("customer_unik_lintas_grup", new Set(grup.flatMap((g) => grupCust.get(g.kunci))).size, tercakupCids.length, "Tidak ada customer di dua baris");
  tambah("teratribusi_ditambah_unknown", akuisisi.size + unknownTampil.length, tercakupCids.length, "akuisisi terbukti + UNKNOWN = tercakup (UNKNOWN tidak pernah dikreditkan ke campaign)");
  if (!filter) tambah("unknown_tidak_bertabrakan_dengan_akuisisi", unknownCids.filter((c) => akuisisi.has(c)).length, 0, "customer UNKNOWN tidak punya touch akuisisi terbukti");
  tambah("lead_sah_grup_vs_total", jumlahKunci(grup, (g) => g.lead.leadSah), tAll.leads, "Σ lead sah grup = lead sah gabungan");
  tambah("customer_dengan_order_grup_vs_total", jumlahKunci(grup, (g) => g.customerDenganOrder), tAll.customerDenganOrder, "Σ customer dengan order = gabungan (tidak ganda)");
  tambah("order_grup_vs_total", jumlahKunci(grup, (g) => g.orderEligible), tAll.orders, "Σ order eligible = gabungan (order tidak dihitung ganda)");
  tambah("booked_grup_vs_total", jumlahKunci(grup, (g) => g.bookedValue), tAll.nilaiOrder, "Σ booked value = gabungan");
  tambah("lunas_crm_grup_vs_total", jumlahKunci(grup, (g) => g.lunasMenurutCrm.jumlah), tAll.lunasMenurutCrm.jumlah, "Σ lunas menurut CRM = gabungan");
  tambah("lunas_ledger_grup_vs_total", jumlahKunci(grup, (g) => g.lunasTerbuktiLedger.jumlah), tAll.lunasTerbuktiLedger.jumlah, "Σ lunas terbukti ledger = gabungan");
  tambah("closing_utama_grup_vs_total", jumlahKunci(grup, (g) => g.closingUtama.customerLunasTerbuktiLedger), closingAll.customerLunasTerbuktiLedger, "Σ closing utama (customer lunas terbukti ledger) grup = gabungan (customer tidak dihitung ganda)");
  tambah("closing_utama_order_vs_kohort", closingAll.orderLunasTerbuktiLedger, tAll.lunasTerbuktiLedger.jumlah, "order lunas terbukti ledger di balik closing utama = lunasTerbuktiLedger kohort Fase 1 (definisi tunggal)");
  tambah("closing_utama_tidak_melebihi_customer_order", closingAll.customerLunasTerbuktiLedger <= tAll.customerDenganOrder ? 1 : 0, 1, "closing utama <= customer dengan order");
  tambah("uang_grup_vs_total", jumlahKunci(grup, (g) => g.uangLedger), tAll.uangLedger, "Σ uang ledger = gabungan (pembayaran tidak dihitung ganda)");
  tambah("kohort_internal_grup", grup.every((g) => g._cohort.rekonsiliasi.ok) ? 1 : 0, 1, "Rekonsiliasi internal Fase 1 lolos untuk setiap grup");
  tambah("kohort_internal_total", hAll.rekonsiliasi.ok ? 1 : 0, 1, "Rekonsiliasi internal Fase 1 lolos untuk gabungan");

  // 5. cakupan atribusi (semua lead baru di rentang)
  //    Dengan filter drilldown, partisi seluruh lead tidak bermakna → cakupan/rekon META_ADS dihilangkan (null) dan pemeriksaannya dilewati.
  let mapped = 0, unmapped = 0;
  for (const t of akuisisi.values()) (refOf(t.adId) ? mapped++ : unmapped++);
  let cakupan = null, rekonMetaAds = null;
  if (!filter) {
    const sUnknown = new Set(unknownCids), sSebelumnya = new Set(sebelumnyaCids);
    const tanpa = leadBaru.filter((c) => !akuisisi.has(c.id) && !sUnknown.has(c.id) && !sSebelumnya.has(c.id));
    const leadSahAll = leadBaru.filter((c) => !alasanBukanLead(c)).length;
    cakupan = {
      leadBaruDalamRentang: leadBaru.length,
      leadSahDalamRentang: leadSahAll,
      denganTouchAkuisisi: akuisisi.size, terpetakan: mapped, tidakTerpetakan: unmapped,
      leadBaruTouchTanpaBukti: unknownCids.length,                 // baris UNKNOWN
      leadBaruTouchPadaCustomerSudahAda: sebelumnyaCids.length,    // touch iklan, tetapi customer sudah ada lebih dulu (mis. sales menghubungi duluan): bukan lead iklan
      tanpaTouch: tanpa.length,                                    // organik / non-CTWA / pola teks / iklan tanpa sourceID
      persenDenganTouch: leadBaru.length > 0 ? Math.round((akuisisi.size / leadBaru.length) * 1000) / 10 : null,
      persenTerpetakanDariTouch: akuisisi.size > 0 ? Math.round((mapped / akuisisi.size) * 1000) / 10 : null,
      leadLegacyMetaAdsTanpaTouch: tanpa.filter((c) => c.leadSource === "META_ADS").length,
    };
    tambah("cakupan_lead_lengkap", cakupan.denganTouchAkuisisi + cakupan.leadBaruTouchTanpaBukti + cakupan.leadBaruTouchPadaCustomerSudahAda + cakupan.tanpaTouch, cakupan.leadBaruDalamRentang,
      "akuisisi terbukti + UNKNOWN + customer sudah ada + tanpa touch = semua lead baru di rentang (partisi lengkap)");
    tambah("cakupan_mapped_unmapped", mapped + unmapped, akuisisi.size, "terpetakan + tidak terpetakan = customer dengan touch akuisisi terbukti");

    // Selisih terhadap SELURUH label META_ADS di CRM pada lead baru rentang yang sama (label CRM ≠ bukti touch; tidak ada kredit dari label).
    const meta = leadBaru.filter((c) => c.leadSource === "META_ADS");
    const idMeta = new Set(meta.map((c) => c.id));
    const bukanMetaTerbukti = [...akuisisi.keys()].filter((cid) => !idMeta.has(cid)).length;
    rekonMetaAds = {
      metaAdsCrmLeadBaru: meta.length,
      akuisisiTerbukti: meta.filter((c) => akuisisi.has(c.id)).length,
      touchTanpaBukti: meta.filter((c) => sUnknown.has(c.id)).length,
      touchPadaCustomerSudahAda: meta.filter((c) => sSebelumnya.has(c.id)).length,
      tanpaTouchIklan: meta.filter((c) => !akuisisi.has(c.id) && !sUnknown.has(c.id) && !sSebelumnya.has(c.id)).length,
      akuisisiTerbuktiTetapiLabelBukanMetaAds: bukanMetaTerbukti,
      keterangan: "Label META_ADS di CRM berasal dari sinyal clid/penanda, tautan terlacak, dan inferensi pola teks (sebagian tanpa Ad ID). Hanya 'akuisisiTerbukti' yang punya Ad ID dan dikreditkan ke campaign; sisanya TIDAK diberi kredit campaign.",
    };
    tambah("rekon_meta_ads_crm", rekonMetaAds.akuisisiTerbukti + rekonMetaAds.touchTanpaBukti + rekonMetaAds.touchPadaCustomerSudahAda + rekonMetaAds.tanpaTouchIklan, rekonMetaAds.metaAdsCrmLeadBaru, "lead baru berlabel META_ADS = terbukti + UNKNOWN + customer sudah ada + tanpa touch");
  }
  const tanpaBuktiCount = unknownTampil.length;

  // 6. iklan tidak terpetakan
  const unm = new Map();
  for (const t of akuisisi.values()) if (!refOf(t.adId)) {
    const u = unm.get(t.adId) || unm.set(t.adId, { adId: t.adId, leadAkuisisi: 0, pertama: t.touchAt, terakhir: t.touchAt }).get(t.adId);
    u.leadAkuisisi++; if (t.touchAt < u.pertama) u.pertama = t.touchAt; if (t.touchAt > u.terakhir) u.terakhir = t.touchAt;
  }
  for (const t of touchLain) if (!refOf(t.adId)) {
    const u = unm.get(t.adId) || unm.set(t.adId, { adId: t.adId, leadAkuisisi: 0, pertama: t.touchAt, terakhir: t.touchAt }).get(t.adId);
    if (t.touchAt < u.pertama) u.pertama = t.touchAt; if (t.touchAt > u.terakhir) u.terakhir = t.touchAt;
  }
  const wibStr = (d) => new Date(new Date(d).getTime() + 7 * 3600e3).toISOString().replace("T", " ").slice(0, 16);

  // 7. peringatan: dari kohort Fase 1 (gabungan) + khusus atribusi
  const bulanDari = parameter.dari.slice(0, 7), bulanSampai = parameter.sampai.slice(0, 7);
  const bulanLaporan = { dari: bulanDari, sampai: bulanSampai, bulanBerjalan: bulanWIB(asOf) };
  const fase1 = susunLaporan({ meta: meta.fase1 || {}, ...hAll }, bulanLaporan, { dihitungPada: asOf });
  const peringatan = [];
  const w = (kode, pesan, data) => peringatan.push({ kode, pesan, ...(data ? { data } : {}) });
  const mulaiHari = mulaiAtribusiAt ? hariWIB(mulaiAtribusiAt) : null;
  if (!mulaiAtribusiAt) w("ATRIBUSI_BELUM_MULAI", "Belum ada touch tersimpan (capture touch OFF atau belum ada sinyal iklan). Tidak ada atribusi campaign/ad untuk periode mana pun.");
  else if (parameter.dari < mulaiHari) w("RENTANG_SEBELUM_ATRIBUSI", `Rentang dimulai sebelum atribusi tersimpan (${mulaiHari} WIB). Lead sebelum tanggal itu TIDAK memiliki touch dan tidak dapat diatribusikan ke iklan (tidak ada backfill).`, { attributionStartDate: mulaiHari });
  if (cakupan && cakupan.leadBaruTouchTanpaBukti > 0) w("TOUCH_TANPA_BUKTI_AKUISISI", `${cakupan.leadBaruTouchTanpaBukti} lead baru punya touch iklan tetapi TANPA bukti kausal bahwa webhook yang membuat customer-nya (dibuat manual / jalur lain / tidak terbukti): TIDAK dihitung sebagai lead iklan.`, { jumlah: cakupan.leadBaruTouchTanpaBukti });
  if (cakupan && cakupan.tanpaTouch > 0) w("LEAD_TANPA_TOUCH", `${cakupan.tanpaTouch} dari ${cakupan.leadBaruDalamRentang} lead baru di rentang tidak memiliki touch akuisisi (organik, non-iklan, atau iklan tanpa sourceID). Total grup di bawah BUKAN total lead.`, { jumlah: cakupan.tanpaTouch, legacyMetaAds: cakupan.leadLegacyMetaAdsTanpaTouch });
  if (unmapped > 0) w("AD_ID_TIDAK_TERPETAKAN", `${unmapped} lead memiliki Ad ID yang belum terpetakan ke Ad Set/Campaign (${unm.size} Ad ID). Mereka dilaporkan sebagai UNMAPPED; impor pemetaan dari Ads Manager untuk menutupnya.`, { adIds: unm.size, lead: unmapped });
  const belumMatang = leadBaru.filter((c) => asOf.getTime() - new Date(c.createdAt).getTime() < 60 * DAY).length;
  if (belumMatang > 0) w("KOHORT_BELUM_MATANG", `${belumMatang} lead berumur < 60 hari: hasil lintas-tanggal masih bertambah. Gunakan blok kematangan (7/30/60 hari) untuk perbandingan yang adil antar-grup.`, { leadBelumMatang60: belumMatang });
  w("BIAYA_BELUM_TERHUBUNG", "Spend Meta belum terhubung dan direkonsiliasi: CPA dan ROAS sengaja null. Gunakan /api/atribusi/iklan/ekspor-id untuk menggabungkan dengan data spend per campaign.");
  for (const x of fase1.peringatan) if (x.kode !== "BULAN_BERJALAN" && x.kode !== "SELISIH_DASHBOARD_PENDING" && x.kode !== "PROSPEK_TANPA_TANGGAL") peringatan.push({ ...x, asal: "kohort-fase1" });
  if (!cek.every((c) => c.ok)) w("REKONSILIASI_GAGAL", "Pemeriksaan rekonsiliasi atribusi gagal; jangan pakai angka ini.", { gagal: cek.filter((c) => !c.ok).map((c) => c.id) });

  const bersih = grup.map(({ _cohort, ...g }) => g);
  return {
    versi: 1,
    dihitungPada: new Date(asOf).toISOString(),
    zonaWaktu: "Asia/Jakarta (UTC+7); semua hari WIB",
    rentangLead: { dari: parameter.dari, sampai: parameter.sampai, level, sinyal: "CTWA_AD", maksHari: MAKS_HARI, bawaan: !!parameter.bawaan, hariBawaan: HARI_BAWAAN, filter },
    atribusi: {
      aturanAkuisisi: "touch CTWA valid PERTAMA pada customer yang baru saat touch itu; touch berikutnya dan pada customer lama dilaporkan terpisah (sentuhanBerikutnya)",
      sinyalDipakai: [...SINYAL_UTAMA],
      attributionStartAt: mulaiAtribusiAt ? new Date(mulaiAtribusiAt).toISOString() : null,
      attributionStartWib: mulaiAtribusiAt ? wibStr(mulaiAtribusiAt) : null,
      historis: "TIDAK ADA — lead sebelum touch tersimpan tidak diatribusikan; berkas capture Fase 0 tidak memuat customer ID",
      adIdSumber: "contextInfo.externalAdReply.sourceID pada pesan inbound (bukan dari URL postingan)",
    },
    cakupan,
    rekonMetaAds,
    grup: bersih,
    // HANYA akuisisi terbukti (campaign + UNMAPPED) — yang boleh dikreditkan; baris UNKNOWN tidak ikut.
    jumlahTeratribusi: {
      leadUnik: akuisisi.size, leadSah: tPro.leads, customerLunasMenurutCrm: closingPro.customerLunasMenurutCrm,
      closingUtama: { customerLunasTerbuktiLedger: closingPro.customerLunasTerbuktiLedger, orderLunasTerbuktiLedger: closingPro.orderLunasTerbuktiLedger, perBulanLunasPertama: closingPro.perBulanLunasPertama },
      customerDenganOrder: tPro.customerDenganOrder, orderEligible: tPro.orders,
      orderPernahDp: tPro.orderPernahDp, lunasMenurutCrm: tPro.lunasMenurutCrm.jumlah, lunasTerbuktiLedger: tPro.lunasTerbuktiLedger.jumlah,
      buktiPelunasan: tPro.buktiPelunasan, bookedValue: tPro.nilaiOrder, uangLedger: tPro.uangLedger, refundDisetujui: tPro.refundDisetujui, uangBersihLedger: tPro.uangBersihLedger,
    },
    // Σ SEMUA baris (campaign + UNMAPPED + UNKNOWN) = tercakup. Selisih terhadap jumlahTeratribusi = baris UNKNOWN (tidak dikreditkan ke campaign).
    jumlahTercakup: {
      leadUnik: tercakupCids.length, leadSah: tAll.leads, closingUtama: { customerLunasTerbuktiLedger: closingAll.customerLunasTerbuktiLedger },
      customerDenganOrder: tAll.customerDenganOrder, orderEligible: tAll.orders, orderPernahDp: tAll.orderPernahDp, bookedValue: tAll.nilaiOrder, uangLedger: tAll.uangLedger,
    },
    tidakTerpetakan: { adIds: [...unm.values()].sort((a, b) => b.leadAkuisisi - a.leadAkuisisi).map((u) => ({ adId: u.adId, leadAkuisisi: u.leadAkuisisi, pertamaWib: wibStr(u.pertama), terakhirWib: wibStr(u.terakhir) })) },
    biaya: {
      status: "BELUM_TERHUBUNG", cpa: null, roas: null,
      alasan: "tidak ada integrasi spend Meta yang sah di backend (tanpa kredensial Marketing API/Windsor); ekspor ID tersedia untuk join di luar sistem",
      catatanAdSpendManual: "Input manual AdSpend per sumber per BULAN (Pengaturan) ada, tetapi bukan grain campaign/ad/tanggal; TIDAK dipakai untuk CPA campaign.",
      opsiIntegrasi: [
        "A. Meta Marketing API: system user token read-only (ads_read) di Business Manager, disimpan di env backend; job harian menarik insights level=ad, time_increment=1 (spend + messaging conversations) per account_id+ad_id+tanggal.",
        "B. Windsor.ai REST API dengan API key server-side (bukan koneksi Windsor milik ChatGPT/Claude); job harian dengan field yang sama.",
        "C. n8n terjadwal menarik dari A atau B lalu POST bertanda tangan ke endpoint ingest SANSS (idempoten per account_id+ad_id+tanggal).",
      ],
      penyebutCpa: "closingUtama.customerLunasTerbuktiLedger",
      syarat: "CPA/ROAS hanya boleh dihitung setelah spend per Campaign ID dan tanggal direkonsiliasi (ID + tanggal harus cocok dengan Ads Manager)",
      ekspor: "/api/atribusi/iklan/ekspor-id",
    },
    audit: {
      adReplyTanpaPenanda: { ...(audit || { touch: 0, customerUnik: 0, padaCustomerBaru: 0 }), masukAtribusi: false, keterangan: "balasan ke iklan tanpa penanda CTWA (mis. Status WhatsApp); direkam sebagai audit, tidak dihitung sebagai lead/closing iklan" },
    },
    rekonsiliasi: { ok: cek.every((c) => c.ok), cek },
    peringatan,
    definisi: [
      { id: "closing_utama", label: "Closing utama (keputusan biaya)", status: "SIAP", definisi: "Customer lead sah yang memiliki >= 1 order eligible lunas TERBUKTI LEDGER (ledger valid − refund disetujui >= tagihan > 0).", tanggal: "hari WIB lunas terbukti pertama customer (perBulanLunasPertama); kohort tetap menurut tanggal lead", catatan: ["Terpisah dari customerDenganOrder, orderPernahDp, dan lunasMenurutCrm.", "Satuan customer; order ada di orderLunasTerbuktiLedger.", "Histori sebelum ledger terisi tidak dapat menjadi closing utama (lihat cakupanLedger)."] },
      ...METRICS.filter((m) => ["unique_lead", "pernah_ditandai_prospek", "customer_dengan_order", "order", "nilai_order", "lunas_menurut_crm", "lunas_terbukti_ledger", "bukti_pelunasan", "uang_ledger", "cakupan_ledger", "order_dengan_dp"].includes(m.id))
        .map(({ id, label, status, definisi, tanggal, catatan }) => ({ id, label, status, definisi, tanggal, catatan })),
      { id: "akuisisi_iklan", label: "Akuisisi iklan", status: "SIAP", definisi: "Customer yang BARU saat pesan bersinyal iklan valid pertamanya diproses; Ad ID = sourceID pada webhook. Satu customer = satu grup.", tanggal: "Customer.createdAt (hari WIB) menentukan kohort", catatan: ["Customer lama yang klik iklan tidak menjadi lead baru; touch-nya dilaporkan terpisah."] },
      { id: "baris_unknown", label: "Baris UNKNOWN", status: "SIAP", definisi: "Lead baru di rentang yang punya touch iklan CTWA TETAPI tanpa bukti kausal bahwa webhook yang membuat customer-nya (customer sudah ada tanpa pesan dan tanpa clid cocok: dibuat manual/mulai-chat/B2B/jalur lain).", tanggal: "Customer.createdAt (hari WIB)", catatan: ["Ditampilkan sebagai baris sendiri; TIDAK dikreditkan ke campaign mana pun dan TIDAK masuk jumlahTeratribusi.", "Σ campaign + UNMAPPED + UNKNOWN = jumlahTercakup."] },
      { id: "reaktivasi_assisted", label: "Reaktivasi dan assisted touch", status: "SIAP", definisi: "Reaktivasi = touch iklan pada customer yang SUDAH ada (punya riwayat pesan). Assisted = touch berikutnya pada customer yang sudah diakuisisi (touch pertama yang sah tetap pemegang kredit). Touch tanpa bukti = status UNKNOWN.", tanggal: "tanggal touch (hari WIB)", catatan: ["Dihitung di campaign/ad yang disentuh, tetapi TIDAK menambah unique lead, closing, atau kredit.", "Customer lama yang klik iklan lagi tidak menjadi lead baru."] },
      { id: "prospek_manual", label: "Pernah ditandai PROSPECT", status: "SEBAGIAN", definisi: "Customer yang pernah berada di stage PROSPECT/TRANSACTION/REVIEWED. Stage diatur MANUAL oleh sales; ini bukan ukuran 'qualified lead' dan bisa berbeda antar sales.", tanggal: "PipelineTransition.createdAt (tanpaTanggal = transisi belum dicatat)", catatan: [] },
      { id: "kematangan", label: "Kematangan kohort 7/30/60 hari", status: "SIAP", definisi: "Hasil (order eligible, lunas CRM, lunas ledger, uang ledger) yang terjadi DALAM N hari sejak tanggal lead, hanya untuk lead berumur ≥ N hari; ledger dinilai pada akhir jendela.", tanggal: "tanggal lead + N hari", catatan: ["Membandingkan grup tanpa bias umur kohort."] },
      { id: "biaya", label: "CPA / ROAS", status: "BELUM_ADA_DATA", definisi: "Null: spend per Campaign ID dan tanggal belum terhubung dan direkonsiliasi. Penyebut CPA kelak = closing utama.", tanggal: "—", catatan: [] },
    ],
    batasan: [
      "Atribusi hanya untuk lead yang masuk SETELAH capture touch aktif; tidak ada atribusi historis.",
      "Ad ID adalah sourceID yang diverifikasi cocok dengan Ad ID Meta untuk 6 iklan awal; iklan baru wajib dipetakan lewat impor referensi (tanpa perubahan kode).",
      "Ad Set/Campaign berasal dari referensi terkini (label nama = snapshot); tidak pernah ditebak dari kemiripan nama atau angka.",
      "Atribusi utama hanya sinyal CTWA_AD; AD_REPLY_UNMARKED hanya audit.",
      "Closing utama = customer dengan order lunas terbukti ledger; customer dengan order, order pernah DP, dan lunas menurut CRM adalah metrik terpisah.",
      "Lunas menurut CRM dan lunas terbukti ledger adalah dua metrik berbeda; uang diterima hanya dari ledger valid; booked value bukan uang.",
      "Tanggal lead, tanggal order, dan tanggal pembayaran dipisah (blok `rincian`).",
    ],
    ...(meta.catatan ? { catatan: meta.catatan } : {}),
    jumlahGrup: bersih.length,
  };
}

/** Muat dari DB dalam transaksi READ ONLY (+ statement_timeout) lalu susun laporan. */
export async function hitungLaporanIklan(db, parameter, { now = new Date(), timeoutMs = 25_000 } = {}) {
  const dari = startOfDayWIB(parameter.dari);
  const sampai = endOfDayExclusiveWIB(parameter.sampai);
  const evidence = [...SINYAL_UTAMA];
  const tglDari = new Date(`${parameter.dari}T00:00:00.000Z`);
  const tglSampai = new Date(`${parameter.sampai}T00:00:00.000Z`);

  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(Number(timeoutMs)))}`);

    const leadBaru = await tx.customer.findMany({
      where: { createdAt: { gte: dari, lt: sampai } },
      select: { id: true, createdAt: true, pipelineStage: true, leadSource: true, isInternalStaff: true, staffUserId: true },
    });
    const akuisisi = await tx.attributionTouch.findMany({
      where: { customerStatusAtTouch: "NEW", evidenceSource: { in: evidence }, customer: { createdAt: { gte: dari, lt: sampai } } },
      select: { id: true, customerId: true, adId: true, touchAt: true, evidenceSource: true, entryPointApp: true },
      orderBy: [{ touchAt: "asc" }, { id: "asc" }],
    });
    // pilih satu per customer (sama dengan inti) agar `touchLain` tidak memuat touch akuisisi terpilih
    const terpilih = new Set();
    const pernah = new Set();
    for (const t of akuisisi) if (!pernah.has(t.customerId)) { pernah.add(t.customerId); terpilih.add(t.id); }
    const lainRaw = await tx.attributionTouch.findMany({
      where: { evidenceSource: { in: evidence }, touchDateWib: { gte: tglDari, lte: tglSampai } },
      select: { id: true, customerId: true, adId: true, touchAt: true, customerStatusAtTouch: true },
    });
    const touchLain = lainRaw.filter((t) => !terpilih.has(t.id));

    const idsIklan = [...new Set([...akuisisi.map((t) => t.adId), ...touchLain.map((t) => t.adId)])];
    const refRows = idsIklan.length ? await tx.metaAdReference.findMany({ where: { adId: { in: idsIklan } } }) : [];
    const referensi = new Map(refRows.map((r) => [r.adId, r]));

    const agg = await tx.attributionTouch.aggregate({ _min: { touchAt: true }, _count: { _all: true } });
    const auditRaw = await tx.attributionTouch.findMany({
      where: { evidenceSource: SINYAL_AUDIT, touchDateWib: { gte: tglDari, lte: tglSampai } },
      select: { customerId: true, customerStatusAtTouch: true },
    });
    const audit = {
      touch: auditRaw.length,
      customerUnik: new Set(auditRaw.map((t) => t.customerId)).size,
      padaCustomerBaru: auditRaw.filter((t) => t.customerStatusAtTouch === "NEW").length,
    };
    // touch iklan pada lead baru rentang yang BUKAN akuisisi terbukti (UNKNOWN / EXISTING): dasar baris UNKNOWN dan cakupan. Semua touch, bukan hanya yang jatuh di rentang.
    const touchLeadLain = await tx.attributionTouch.findMany({
      where: { evidenceSource: { in: evidence }, customerStatusAtTouch: { in: ["UNKNOWN", "EXISTING"] }, customer: { createdAt: { gte: dari, lt: sampai } } },
      select: { id: true, customerId: true, adId: true, touchAt: true, customerStatusAtTouch: true },
    });
    const idsLead = (touchLeadLain.length ? [...new Set(touchLeadLain.map((t) => t.customerId))] : []).filter((id) => !pernah.has(id));
    const idsIklan2 = [...new Set(touchLeadLain.map((t) => t.adId))].filter((id) => !idsIklan.includes(id));
    if (idsIklan2.length) for (const r of await tx.metaAdReference.findMany({ where: { adId: { in: idsIklan2 } } })) referensi.set(r.adId, r);
    const masukanMentah = await muatMasukanKohort(tx, { customerIds: [...pernah, ...idsLead] });
    const { meta, ...masukan } = masukanMentah;

    const laporan = susunLaporanIklan({
      parameter, asOf: now, leadBaru, touchAkuisisi: akuisisi, touchLain, touchLeadLain, referensi, masukan,
      mulaiAtribusiAt: agg._min.touchAt, audit, meta: { fase1: { gate: meta.gate }, catatan: { totalTouchTersimpan: agg._count._all } },
    });
    // Fase 3: spend harian (READ ONLY, satu sumber per tanggal+akun+Ad) + target KPI ADMIN → biaya/CPL/CPA/ROAS per baris. Tidak mengubah angka atribusi.
    const { spendPerAd, kesegaranMentah } = await muatSpendPerAd(tx, { dari: parameter.dari, sampai: parameter.sampai });
    const idsSpendBaru = spendPerAd.map((x) => x.adId).filter((id) => !referensi.has(id));
    if (idsSpendBaru.length) for (const r of await tx.metaAdReference.findMany({ where: { adId: { in: idsSpendBaru } } })) referensi.set(r.adId, r);
    const targetRow = await tx.attributionKpiTarget.findUnique({ where: { id: 1 } });
    const hariIni = hariWIB(now);
    const kesegaran = kesegaranSpend({ ...kesegaranMentah, hariIni, dari: parameter.dari, sampai: parameter.sampai });
    return terapkanBiaya(laporan, { spendPerAd, referensi, kesegaran, mulaiHari: agg._min.touchAt ? hariWIB(agg._min.touchAt) : null, target: normalisasiTarget(targetRow ? {
      maxCpl: targetRow.maxCpl, maxCostPerQualifiedLead: targetRow.maxCostPerQualifiedLead, maxCostPerCustomerOrder: targetRow.maxCostPerCustomerOrder, maxCpaClosing: targetRow.maxCpaClosing,
      minBookedRoas: targetRow.minBookedRoas, minCashRoas: targetRow.minCashRoas, minAcquisitionLeads: targetRow.minAcquisitionLeads, minClosings: targetRow.minClosings,
      minCohortAgeDays: targetRow.minCohortAgeDays, maxSpamSharePercent: targetRow.maxSpamSharePercent } : null), hariIni });
  }, { timeout: timeoutMs + 5_000, maxWait: 5_000 });
}

/** Ekspor ID (untuk join dengan Windsor/Ads Manager): satu baris per Ad ID yang pernah muncul, tanpa data customer. Baca-saja. */
export async function eksporIdIklan(db) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const g = await tx.attributionTouch.groupBy({ by: ["adId"], _count: { _all: true }, _min: { touchAt: true }, _max: { touchAt: true } });
    const refs = await tx.metaAdReference.findMany({ where: { adId: { in: g.map((x) => x.adId) } } });
    const m = new Map(refs.map((r) => [r.adId, r]));
    return g.map((x) => {
      const r = m.get(x.adId);
      return {
        campaignId: r?.campaignId ?? null, adSetId: r?.adSetId ?? null, adId: x.adId, status: r ? "MAPPED" : UNMAPPED,
        campaignName: r?.campaignName ?? null, adSetName: r?.adSetName ?? null, adName: r?.adName ?? null,
        touch: x._count._all, pertama: x._min.touchAt, terakhir: x._max.touchAt,
      };
    }).sort((a, b) => b.touch - a.touch);
  });
}
