// INVARIAN laporan Marketing (GET /api/atribusi/iklan/sumber) — fungsi MURNI, tanpa I/O. Dipakai oleh: (1) smoke pasca-switch dan rehearsal (disisipkan generator ke kode smoke; kata kunci `export` dibuang saat disisipkan),
// (2) tes unit backend/tests/marketingLaporanInvarian.test.js (fixture + mutasi). Setiap pemeriksaan = { n, ok, d }.
// Kebenaran = hubungan ANTAR angka di laporan dan terhadap hitungan SQL independen pada data yang sama, BUKAN angka tetap.
export const URUTAN_SUMBER = ["META", "TIKTOK", "GOOGLE", "WHATSAPP", "INSTAGRAM", "WEBSITE", "LAINNYA"];
const jml = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const KUNCI_RASIO = ["cpl", "cpa", "costPerProspekEksplisit", "bookedRoas", "cashRoas"];

/** Pemeriksaan struktural + hubungan antar-angka. `d` = isi respons /sumber. */
export function periksaLaporan(d) {
  const hasil = []; const rec = (n, ok, det = "") => hasil.push({ n, ok: !!ok, d: String(det).slice(0, 240) });
  const S = Array.isArray(d?.sumber) ? d.sumber : []; const T = d?.total ?? {};
  rec("bentuk: periode, total, dan tujuh sumber dalam urutan tetap (Google Ads terpisah dari Lainnya)", !!d?.periode && S.map((x) => x.id).join() === URUTAN_SUMBER.join(), S.map((x) => x.id).join());
  const g = S.find((x) => x.id === "GOOGLE"), l = S.find((x) => x.id === "LAINNYA");
  rec("Google Ads = sumber berbayar berlabel CRM GOOGLE_ADS; Lainnya tidak lagi memuat GOOGLE_ADS", g?.jenis === "IKLAN" && (g?.labelCrm ?? []).join() === "GOOGLE_ADS" && !(l?.labelCrm ?? []).includes("GOOGLE_ADS"), JSON.stringify([g?.jenis, g?.labelCrm, l?.labelCrm]));
  for (const k of ["lead", "spam", "leadSah", "berOrder", "membayar", "lunas"]) rec(`total.${k} = jumlah ${k} seluruh sumber`, T[k] === jml(S, (x) => x[k]), `${T[k]} vs ${jml(S, (x) => x[k])}`);
  rec("setiap sumber: lead = spam + dikecualikan lain + lead sah", S.every((x) => x.lead === x.spam + x.dikecualikanLain + x.leadSah), S.filter((x) => x.lead !== x.spam + x.dikecualikanLain + x.leadSah).map((x) => x.id).join());
  rec("setiap sumber: ber-order ≤ lead; membayar ≤ ber-order; lunas ≤ membayar", S.every((x) => x.berOrder <= x.lead && x.membayar <= x.berOrder && x.lunas <= x.membayar), "");
  // PROSPEK: eksplisit (utama) ≤ atau-lanjut (rincian) ≤ lead sah; selisih konsisten; jumlah antar-sumber = total
  const P = S.map((x) => ({ id: x.id, e: x.prospek?.prospekEksplisit?.jumlah, a: x.prospek?.pernahProspekAtauLanjut?.jumlah, sel: x.prospek?.selisihAtauLanjutMinusEksplisit, lang: x.prospek?.langsungKeTransaksiTanpaProspect, ls: x.leadSah }));
  rec("prospek ada pada setiap sumber dan total (angka bulat ≥ 0)", P.every((p) => Number.isInteger(p.e) && Number.isInteger(p.a) && p.e >= 0 && p.a >= 0) && Number.isInteger(T.prospek?.prospekEksplisit) && Number.isInteger(T.prospek?.pernahProspekAtauLanjut), JSON.stringify(P.filter((p) => !(Number.isInteger(p.e) && Number.isInteger(p.a))).map((p) => p.id)));
  rec("prospek eksplisit ≤ prospek atau lanjut ≤ lead sah (setiap sumber)", P.every((p) => p.e <= p.a && p.a <= p.ls), JSON.stringify(P.filter((p) => !(p.e <= p.a && p.a <= p.ls))));
  rec("selisih (atau-lanjut − eksplisit) = nilai yang dilaporkan dan ≥ lompat langsung ke transaksi", P.every((p) => p.a - p.e === p.sel && p.sel >= p.lang), JSON.stringify(P.filter((p) => !(p.a - p.e === p.sel && p.sel >= p.lang))));
  rec("total prospek eksplisit / atau-lanjut = jumlah antar-sumber; penyebut = total lead sah", T.prospek?.prospekEksplisit === jml(P, (p) => p.e) && T.prospek?.pernahProspekAtauLanjut === jml(P, (p) => p.a) && T.prospek?.penyebut === T.leadSah, JSON.stringify([T.prospek?.prospekEksplisit, jml(P, (p) => p.e), T.prospek?.penyebut, T.leadSah]));
  // PENGAMAN BIAYA: rasio kosong bila biaya belum lengkap atau mencakup hari berjalan; biaya per prospek eksplisit = spend ÷ eksplisit bila ada
  const bocor = []; const salah = []; const tanpaAlasan = [];
  for (const x of S) {
    const b = x.biaya; if (!b) continue; const tidakFinal = b.spendLengkap !== true || b.sementara === true;
    if (tidakFinal) for (const k of KUNCI_RASIO) if (b[k] !== null && b[k] !== undefined) bocor.push(`${x.id}.${k}`);
    if (typeof b.costPerProspekEksplisit === "number") { const e = x.prospek?.prospekEksplisit?.jumlah; if (!(e > 0) || !(b.spend > 0) || Math.abs(b.costPerProspekEksplisit - b.spend / e) > 1) salah.push(x.id); }
    else if (!b.alasanNull || typeof b.alasanNull.costPerProspekEksplisit !== "string") tanpaAlasan.push(x.id);
  }
  rec("pengaman biaya: CPL/CPA/biaya per prospek/ROAS KOSONG bila biaya belum lengkap atau hari berjalan parsial", bocor.length === 0, bocor.join());
  rec("biaya per prospek eksplisit = spend ÷ prospek eksplisit (±Rp1); bila kosong ada alasan", salah.length === 0 && tanpaAlasan.length === 0, JSON.stringify({ salah, tanpaAlasan }));
  const B = T.berbayar;
  rec("total berbayar kosong (CPA/ROAS) bila ada sumber berbayar yang biayanya belum lengkap", !B || B.lengkap === true || (B.cpa === null && B.bookedRoas === null && B.cashRoas === null), JSON.stringify([B?.lengkap, B?.cpa]));
  const ctr = jml(S, (x) => (x.uang?.nilaiOrderSaatIni)); rec("total nilai order = jumlah antar-sumber (kohort)", Math.abs((T.nilaiOrderSaatIni ?? 0) - ctr) <= 1, `${T.nilaiOrderSaatIni} vs ${ctr}`);
  rec("uang bersih = uang ledger − refund (setiap sumber) dan total = jumlah antar-sumber", S.every((x) => Math.abs((x.uang?.uangBersih ?? NaN) - ((x.uang?.uangLedger ?? NaN) - (x.uang?.refund ?? NaN))) <= 1) && Math.abs((T.uangBersih ?? NaN) - jml(S, (x) => x.uang?.uangBersih)) <= 1, `${T.uangBersih} vs ${jml(S, (x) => x.uang?.uangBersih)}`);
  return hasil;
}

/** Bandingkan laporan dengan hitungan SQL independen. `sql` = { SUMBER_ID: { lead, spam, leadSah, eksplisit, atauLanjut } } untuk semua tujuh sumber. */
export function banding(d, sql) {
  const hasil = []; const rec = (n, ok, det = "") => hasil.push({ n, ok: !!ok, d: String(det).slice(0, 300) });
  const beda = [];
  for (const x of d?.sumber ?? []) {
    const q = sql?.[x.id] ?? { lead: 0, spam: 0, leadSah: 0, eksplisit: 0, atauLanjut: 0 };
    const api = { lead: x.lead, spam: x.spam, leadSah: x.leadSah, eksplisit: x.prospek?.prospekEksplisit?.jumlah, atauLanjut: x.prospek?.pernahProspekAtauLanjut?.jumlah };
    for (const k of Object.keys(api)) if (Number(api[k]) !== Number(q[k])) beda.push(`${x.id}.${k}: api=${api[k]} sql=${q[k]}`);
  }
  rec("SQL independen = laporan: lead, spam, lead sah, prospek eksplisit, prospek atau lanjut — per sumber (Google Ads terpisah)", beda.length === 0, beda.slice(0, 8).join(" | "));
  return hasil;
}

/** SQL independen (psql/Prisma) untuk `banding`. Parameter: $1 = awal (timestamp UTC tanpa zona), $2 = batas akhir eksklusif. Kolom Customer.createdAt = timestamp(3) UTC tanpa zona. */
export const SQL_BANDING = `WITH k AS (
  SELECT c.id, c."pipelineStage"::text AS stage,
    CASE WHEN c."leadSource"::text IN ('B2B_DIRECT','PENJUALAN_KARYAWAN') THEN 'BUKAN_LEAD'
         WHEN c."leadSource"::text='META_ADS' THEN 'META' WHEN c."leadSource"::text='TIKTOK_ADS' THEN 'TIKTOK' WHEN c."leadSource"::text='GOOGLE_ADS' THEN 'GOOGLE'
         WHEN c."leadSource"::text='WHATSAPP_DIRECT' THEN 'WHATSAPP' WHEN c."leadSource"::text='INSTAGRAM' THEN 'INSTAGRAM'
         WHEN c."leadSource"::text IN ('WEBSITE_ORGANIC','WEBSITE') THEN 'WEBSITE' ELSE 'LAINNYA' END AS sid,
    CASE WHEN c."pipelineStage"::text='SPAM' THEN 'SPAM' WHEN c."leadSource"::text IN ('B2B_DIRECT','PENJUALAN_KARYAWAN') THEN 'BUKAN_LEAD'
         WHEN c.is_internal_staff THEN 'INTERNAL' WHEN c.staff_user_id IS NOT NULL THEN 'PROFIL_KARYAWAN' ELSE 'SAH' END AS alasan
  FROM "Customer" c WHERE c."createdAt" >= $1::timestamp AND c."createdAt" < $2::timestamp),
tr AS (SELECT t.customer_id AS cid, bool_or(t.to_stage::text IN ('PROSPECT','TRANSACTION','REVIEWED')) AS lanjut, bool_or(t.to_stage::text='PROSPECT') AS eks
  FROM pipeline_transitions t WHERE t.customer_id IN (SELECT id FROM k) GROUP BY 1)
SELECT k.sid, count(*) FILTER (WHERE k.alasan<>'BUKAN_LEAD')::int AS lead, count(*) FILTER (WHERE k.alasan='SPAM')::int AS spam, count(*) FILTER (WHERE k.alasan='SAH')::int AS lead_sah,
  count(*) FILTER (WHERE k.alasan='SAH' AND (coalesce(tr.eks,false) OR (NOT coalesce(tr.lanjut,false) AND k.stage='PROSPECT')))::int AS eksplisit,
  count(*) FILTER (WHERE k.alasan='SAH' AND (coalesce(tr.lanjut,false) OR k.stage IN ('PROSPECT','TRANSACTION','REVIEWED')))::int AS atau_lanjut
FROM k LEFT JOIN tr ON tr.cid=k.id WHERE k.sid<>'BUKAN_LEAD' GROUP BY k.sid`;

/** Baris hasil SQL → peta per sumber (tujuh sumber selalu ada, 0 bila tidak ada baris). */
export function petaSql(baris) {
  const o = Object.fromEntries(URUTAN_SUMBER.map((id) => [id, { lead: 0, spam: 0, leadSah: 0, eksplisit: 0, atauLanjut: 0 }]));
  for (const r of baris ?? []) if (o[r.sid]) o[r.sid] = { lead: Number(r.lead), spam: Number(r.spam), leadSah: Number(r.lead_sah), eksplisit: Number(r.eksplisit), atauLanjut: Number(r.atau_lanjut) };
  return o;
}
