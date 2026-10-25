// PERFORMA AKUISISI PER SUMBER (traffic/iklan) — ringkasan lead → customer ber-order → membayar → lunas per SUMBER, baca-saja.
//
// Sumber = LABEL CRM (Customer.leadSource), BUKAN bukti atribusi per klik. Hanya Meta yang juga punya atribusi terbukti (touch CTWA_AD); ia ditampilkan terpisah
// (`buktiAtribusi`) dan biaya/CPA/ROAS Meta memakai angka atribusi-terbukti yang sama dengan tab Iklan (Campaign). Sumber lain: biaya/CPA/ROAS selalu null (tidak ada sumber spend).
//
// Definisi (semua dari cohort.js — satu sumber kebenaran):
//   lead         = customer dibuat di rentang (WIB) dengan label sumber itu; spam = pipelineStage SPAM; leadSah = bukan spam/internal/B2B/karyawan.
//   berOrder     = leadSah dengan >= 1 order eligible (bukan batal/pending/penjualan karyawan).  nilai order = nilai order SAAT INI (bukan histori).
//   membayar     = berOrder yang punya >= 1 pembayaran sah (ledger; batal/gerbang verifikasi sudah disaring).
//   pernahDp / dpSaatIni / lunas = TIDAK eksklusif (customer bisa pernah DP lalu lunas). `kategoriEksklusif` memberi pembagian yang saling lepas (jumlahnya = berOrder).
//   konversi     = berOrder / leadSah dengan pembilang dan penyebut ditampilkan (sampel kecil bila leadSah < AMBANG_SAMPEL).
import { alasanBukanLead, jejakPembayaran } from "./cohort.js";
import { ORDER_EXCLUDED_STATUS } from "./cohortDefinitions.js";
import { nilaiBersih } from "../orderNilaiBersih.js";

export const AMBANG_SAMPEL = 30;
export const SUMBER = Object.freeze([
  { id: "META", label: "Meta Ads", jenis: "IKLAN", labelCrm: ["META_ADS"], bukti: "ATRIBUSI_TERBUKTI_TERSEDIA" },
  { id: "TIKTOK", label: "TikTok Ads", jenis: "IKLAN", labelCrm: ["TIKTOK_ADS"], bukti: "LABEL_CRM" },
  { id: "WHATSAPP", label: "WhatsApp Langsung", jenis: "ORGANIK", labelCrm: ["WHATSAPP_DIRECT"], bukti: "LABEL_CRM" },
  { id: "INSTAGRAM", label: "Instagram Organik", jenis: "ORGANIK", labelCrm: ["INSTAGRAM"], bukti: "LABEL_CRM" },
  { id: "WEBSITE", label: "Website Organik", jenis: "ORGANIK", labelCrm: ["WEBSITE_ORGANIC", "WEBSITE"], bukti: "LABEL_CRM" },
  { id: "LAINNYA", label: "Lainnya", jenis: "LAINNYA", labelCrm: ["OTHER", "ADS", "GOOGLE_ADS", "REFERRAL"], bukti: "LABEL_CRM" },
]);
/** Label yang BUKAN lead pemasaran (dikeluarkan dari semua sumber; dilaporkan terpisah). */
export const LABEL_BUKAN_LEAD = Object.freeze(["B2B_DIRECT", "PENJUALAN_KARYAWAN"]);
export const METRIK = Object.freeze({
  lead: { label: "Lead masuk", penyebut: null },
  leadSah: { label: "Lead sah (bukan spam)", penyebut: null },
  berOrder: { label: "Customer ber-order", penyebut: null },
  membayar: { label: "Customer membayar", penyebut: null },
  lunas: { label: "Customer lunas", penyebut: null },
  konversiOrder: { label: "Konversi ber-order", penyebut: "leadSah" },
  konversiLunas: { label: "Konversi lunas", penyebut: "leadSah" },
});
const rp = (x) => Math.round((Number(x) || 0) * 100) / 100;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 100 : null);

const petaLabel = new Map(); for (const s of SUMBER) for (const l of s.labelCrm) petaLabel.set(l, s.id);
export const sumberDariLabel = (label) => (LABEL_BUKAN_LEAD.includes(label) ? null : petaLabel.get(label) ?? "LAINNYA");

const kosong = () => ({ lead: 0, spam: 0, dikecualianLain: 0, leadSah: 0, berOrder: 0, membayar: 0, pernahDp: 0, dpSaatIni: 0, lunas: 0, eksklusif: { belumBayar: 0, dpSaatIni: 0, lunas: 0 }, orderEligible: 0, orderBerLedger: 0, orderDp: 0, orderLunas: 0, nilaiOrder: 0, uangLedger: 0, refund: 0, uangBersih: 0 });

/**
 * MURNI. customers: {id, createdAt, pipelineStage, leadSource, isInternalStaff, staffUserId}; orders: {id, customerId, status, value, tagihan, penjualanKaryawanId};
 * kontribusi: [{id, orderId, amount, createdAt}] (sudah disaring batal + gerbang); refunds: [{orderId, amount, status, approvedAt, date}].
 */
export function hitungSumber({ customers, orders, kontribusi, refunds }) {
  const per = new Map(SUMBER.map((s) => [s.id, kosong()]));
  const cust = new Map(); let bukanLeadPemasaran = 0;
  for (const c of customers) {
    const sid = sumberDariLabel(c.leadSource);
    if (!sid) { bukanLeadPemasaran++; continue; }
    cust.set(c.id, { c, sid }); const x = per.get(sid); x.lead++;
    const alasan = alasanBukanLead(c);
    if (alasan === "SPAM") x.spam++; else if (alasan) x.dikecualianLain++; else x.leadSah++;
  }
  const kPer = new Map(); for (const k of kontribusi) (kPer.get(k.orderId) || kPer.set(k.orderId, []).get(k.orderId)).push(k);
  const rPer = new Map(); for (const r of refunds) if (r.status === "DISETUJUI") (rPer.get(r.orderId) || rPer.set(r.orderId, []).get(r.orderId)).push(r);
  const dedupe = new Map();   // customerId -> {order, bayar, dp, dpKini, lunas}
  for (const o of orders) {
    const e = cust.get(o.customerId); if (!e || alasanBukanLead(e.c) || o.penjualanKaryawanId || ORDER_EXCLUDED_STATUS.includes(o.status)) continue;
    const x = per.get(e.sid); const j = jejakPembayaran(kPer.get(o.id) || [], o.tagihan != null ? o.tagihan : nilaiBersih(o), rPer.get(o.id) || []);
    x.orderEligible++; x.nilaiOrder += rp(nilaiBersih(o)); x.uangLedger += j.kotor; x.refund += j.refund; x.uangBersih += j.bersih;
    if (j.jumlahPembayaran > 0) x.orderBerLedger++; if (j.pernahDp) x.orderDp++; if (j.status === "LUNAS") x.orderLunas++;
    const d = dedupe.get(o.customerId) || dedupe.set(o.customerId, { sid: e.sid, bayar: false, dp: false, dpKini: false, lunas: false }).get(o.customerId);
    if (j.jumlahPembayaran > 0) d.bayar = true; if (j.pernahDp) d.dp = true; if (j.status === "DP") d.dpKini = true; if (j.status === "LUNAS") d.lunas = true;
  }
  for (const d of dedupe.values()) {
    const x = per.get(d.sid); x.berOrder++; if (d.bayar) x.membayar++; if (d.dp) x.pernahDp++; if (d.dpKini) x.dpSaatIni++; if (d.lunas) x.lunas++;
    if (d.lunas) x.eksklusif.lunas++; else if (d.dpKini) x.eksklusif.dpSaatIni++; else x.eksklusif.belumBayar++;
  }
  return { per, bukanLeadPemasaran };
}

/** Sorotan yang dihitung server dari data (bukan hardcode): setiap kategori memilih sumber tertinggi di antara yang memenuhi sampel minimum. */
export function sorotan(daftar) {
  const layak = daftar.filter((s) => !s.sampelKecil && s.leadSah > 0);
  const maks = (arr, f) => arr.reduce((b, s) => (b === null || f(s) > f(b) ? s : b), null);
  const out = [];
  const vol = maks(daftar.filter((s) => s.lead > 0), (s) => s.lead); if (vol) out.push({ id: "VOLUME", label: "Volume lead terbesar", sumberId: vol.id, nilai: vol.lead, penyebut: null });
  const bo = maks(daftar.filter((s) => s.berOrder > 0), (s) => s.berOrder); if (bo) out.push({ id: "ORDER_TERBANYAK", label: "Customer ber-order terbanyak", sumberId: bo.id, nilai: bo.berOrder, penyebut: null });
  const ko = maks(layak.filter((s) => s.konversiOrder.nilai !== null && s.berOrder > 0), (s) => s.konversiOrder.nilai); if (ko) out.push({ id: "KONVERSI_ORDER", label: `Konversi ber-order tertinggi (sampel ≥ ${AMBANG_SAMPEL} lead sah)`, sumberId: ko.id, nilai: ko.konversiOrder.nilai, pembilang: ko.berOrder, penyebut: ko.leadSah });
  const lu = maks(daftar.filter((s) => s.lunas > 0), (s) => s.lunas); if (lu) out.push({ id: "LUNAS_TERBANYAK", label: "Customer lunas (ledger) terbanyak", sumberId: lu.id, nilai: lu.lunas, penyebut: null });
  return out;
}

/** Susun jawaban. `biayaMeta` = blok biaya atribusi-terbukti dari laporan iklan (null bila tidak dihitung). */
export function susunSumber({ parameter, hasil, biayaMeta = null, provenMeta = null, asOf, mulaiHari = null, hariIni = null }) {
  const daftar = SUMBER.map((s) => {
    const x = hasil.per.get(s.id);
    const konv = (a) => ({ nilai: pct(a, x.leadSah), pembilang: a, penyebut: x.leadSah });
    const sampelKecil = x.leadSah < AMBANG_SAMPEL;
    const adaMeta = s.id === "META";
    return {
      id: s.id, label: s.label, jenis: s.jenis, labelCrm: s.labelCrm, sampelKecil, ambangSampel: AMBANG_SAMPEL,
      lead: x.lead, spam: x.spam, spamPersen: { nilai: pct(x.spam, x.lead), pembilang: x.spam, penyebut: x.lead }, dikecualikanLain: x.dikecualianLain, leadSah: x.leadSah,
      berOrder: x.berOrder, membayar: x.membayar, lunas: x.lunas,
      pernahDp: x.pernahDp, dpSaatIni: x.dpSaatIni,
      kategoriEksklusif: { ...x.eksklusif, catatan: "saling lepas: lunas > DP saat ini > belum bayar; jumlahnya = customer ber-order. pernahDp/dpSaatIni/lunas di atas BOLEH overlap — jangan dijumlahkan." },
      konversiOrder: konv(x.berOrder), konversiMembayar: konv(x.membayar), konversiLunas: konv(x.lunas),
      order: { eligible: x.orderEligible, berLedger: x.orderBerLedger, persenBerLedger: pct(x.orderBerLedger, x.orderEligible), pernahDp: x.orderDp, lunas: x.orderLunas },
      uang: { nilaiOrderSaatIni: rp(x.nilaiOrder), uangLedger: rp(x.uangLedger), refund: rp(x.refund), uangBersih: rp(x.uangBersih), catatan: "nilai order = nilai SAAT INI, bukan histori; uang = pembayaran sah di ledger" },
      buktiAtribusi: adaMeta
        ? { jenis: "ATRIBUSI_TERBUKTI_TERSEDIA", akuisisiTerbukti: provenMeta?.akuisisiTerbukti ?? null, catatan: "Hanya Meta yang punya touch CTWA terbukti; angka label CRM dan angka terbukti bisa berbeda. Rincian per campaign: tab Iklan (Campaign)." }
        : { jenis: "LABEL_CRM", akuisisiTerbukti: null, catatan: "Sumber hanya label CRM (tanpa bukti per klik dan tanpa data spend)." },
      biaya: adaMeta && biayaMeta ? { dasar: "ATRIBUSI_TERBUKTI", status: biayaMeta.status, spend: biayaMeta.spend, cpa: biayaMeta.cpa, cpl: biayaMeta.cpl, bookedRoas: biayaMeta.bookedRoas, cashRoas: biayaMeta.cashRoas, alasanNull: biayaMeta.alasanNull ?? {}, costPerPlatformConversation: biayaMeta.costPerPlatformConversation ?? null }
        : { dasar: adaMeta ? "BELUM_DIHITUNG" : "TIDAK_ADA_SUMBER_SPEND", status: adaMeta ? "BELUM_DIHITUNG" : "TIDAK_ADA_SUMBER_SPEND", spend: null, cpa: null, cpl: null, bookedRoas: null, cashRoas: null, alasanNull: { cpa: adaMeta ? "BELUM_DIHITUNG" : "TIDAK_ADA_SUMBER_SPEND", bookedRoas: adaMeta ? "BELUM_DIHITUNG" : "TIDAK_ADA_SUMBER_SPEND" } },
    };
  });
  const total = daftar.reduce((a, s) => { for (const f of ["lead", "spam", "leadSah", "berOrder", "membayar", "lunas"]) a[f] += s[f]; a.uangLedger = rp(a.uangLedger + s.uang.uangLedger); a.nilaiOrderSaatIni = rp(a.nilaiOrderSaatIni + s.uang.nilaiOrderSaatIni); a.orderEligible += s.order.eligible; a.orderBerLedger += s.order.berLedger; return a; }, { lead: 0, spam: 0, leadSah: 0, berOrder: 0, membayar: 0, lunas: 0, uangLedger: 0, nilaiOrderSaatIni: 0, orderEligible: 0, orderBerLedger: 0 });
  const peringatan = [];
  const w = (kode, pesan, data) => peringatan.push({ kode, pesan, ...(data ? { data } : {}) });
  if (parameter.termasukHariBerjalan) w("HARI_BERJALAN", "Rentang mencakup hari ini: angka lead/order masih bertambah dan biaya per hasil sengaja kosong.");
  if (total.orderEligible > 0 && total.orderBerLedger < total.orderEligible) w("LEDGER_TIDAK_LENGKAP", `Hanya ${total.orderBerLedger} dari ${total.orderEligible} order yang punya pembayaran di ledger: "Customer membayar" adalah batas bawah, bukan total pasti.`, { orderBerLedger: total.orderBerLedger, orderEligible: total.orderEligible });
  w("SUMBER_LABEL_CRM", "Sumber = label CRM. Hanya Meta yang punya atribusi per klik terbukti; TikTok, WhatsApp, Instagram, Website, dan Lainnya tanpa bukti per klik dan tanpa data spend.");
  if (mulaiHari && parameter.dari < mulaiHari) w("RENTANG_SEBELUM_ATRIBUSI", `Rentang dimulai sebelum atribusi per klik tersimpan (${mulaiHari} WIB): jumlah lead per label tetap valid, tetapi bukti atribusi Meta tidak mencakup seluruh rentang.`, { atribusiMulai: mulaiHari });
  const sp = biayaMeta;
  if (sp && sp.status && !["SIAP_DIEVALUASI", "BELUM_ADA_KONVERSI", "DATA_BELUM_MATANG"].includes(sp.status)) w("SPEND_BELUM_LENGKAP", "Spend Meta belum lengkap/sebanding untuk rentang ini — CPA dan ROAS belum dapat dinilai.", { statusBiaya: sp.status });
  if (bukanLeadAda(hasil)) w("BUKAN_LEAD_PEMASARAN", `${hasil.bukanLeadPemasaran} customer berlabel B2B/penjualan karyawan dikeluarkan dari semua sumber.`, { jumlah: hasil.bukanLeadPemasaran });
  const statusSpend = !biayaMeta ? "BELUM_DIHITUNG" : biayaMeta.status;
  return {
    versi: 1, dihitungPada: asOf instanceof Date ? asOf.toISOString() : asOf, zonaWaktu: "Asia/Jakarta",
    periode: { dari: parameter.dari, sampai: parameter.sampai, hariIni, termasukHariBerjalan: !!parameter.termasukHariBerjalan, bawaan: !!parameter.bawaan },
    status: { spend: statusSpend, ledger: { orderEligible: total.orderEligible, orderBerLedger: total.orderBerLedger, persen: pct(total.orderBerLedger, total.orderEligible) }, atribusi: { mulaiHari, metaAkuisisiTerbukti: provenMeta?.akuisisiTerbukti ?? null, metaLabelCrm: daftar[0].lead } },
    total, sumber: daftar, sorotan: sorotan(daftar), metrik: Object.fromEntries(Object.entries(METRIK).map(([k, v]) => [k, v.label])), peringatan,
    definisi: { sumber: "Label CRM (Customer.leadSource), bukan bukti per klik.", konversi: "Customer ber-order ÷ lead sah (bukan spam); pembilang dan penyebut ditampilkan.", overlap: "pernahDp, dpSaatIni, dan lunas tidak eksklusif; gunakan kategoriEksklusif untuk pembagian yang jumlahnya = ber-order.", ledger: "Pembayaran sah di ledger sistem; pembayaran di luar sistem tidak terlihat." },
    batasan: ["Nilai order = nilai saat ini.", "Peringkat memakai metrik terpilih; sumber dengan lead sah < ambang diberi tanda sampel kecil dan tidak masuk sorotan konversi."],
  };
}
const bukanLeadAda = (h) => h.bukanLeadPemasaran > 0;

// ── pemuat (READ ONLY) ─────────────────────────────────────────────────────────────────────────────────────
import { startOfDayWIB, endOfDayExclusiveWIB } from "../../utils/wib.js";
import { muatMasukanKohort } from "./cohortLoader.js";
import { hitungLaporanIklan } from "./iklanReport.js";

export async function hitungSumberPerforma(db, parameter, { now = new Date(), timeoutMs = 25_000, denganMeta = true } = {}) {
  const { dari, sampai, hariIni } = parameter;
  const { meta, ...m } = await muatMasukanKohort(db, { leadFrom: dari, leadTo: sampai });
  const hasil = hitungSumber({ customers: m.customers, orders: m.orders, kontribusi: m.kontribusi, refunds: m.refunds });
  let biayaMeta = null, provenMeta = null, mulaiHari = null;
  const agg = await db.attributionTouch.aggregate({ _min: { touchAt: true } });
  if (agg._min.touchAt) mulaiHari = new Date(new Date(agg._min.touchAt).getTime() + 7 * 3600e3).toISOString().slice(0, 10);
  if (denganMeta) {
    const lap = await hitungLaporanIklan(db, { dari, sampai, level: "campaign", sinyal: "CTWA_AD", rincian: false, hariIni, bawaan: false, filter: null }, { now, timeoutMs });
    biayaMeta = { status: lap.biaya.status, spend: lap.biaya.spend, cpa: lap.biaya.cpa, cpl: lap.biaya.cpl, bookedRoas: lap.biaya.bookedRoas, cashRoas: lap.biaya.cashRoas, alasanNull: lap.biaya.alasanNull, costPerPlatformConversation: lap.biaya.costPerPlatformConversation };
    provenMeta = { akuisisiTerbukti: lap.jumlahTeratribusi?.leadUnik ?? null };
    parameter = { ...parameter, termasukHariBerjalan: lap.periode?.termasukHariBerjalan === true };
  } else parameter = { ...parameter, termasukHariBerjalan: sampai >= hariIni };
  return susunSumber({ parameter, hasil, biayaMeta, provenMeta, asOf: now, mulaiHari, hariIni });
}
