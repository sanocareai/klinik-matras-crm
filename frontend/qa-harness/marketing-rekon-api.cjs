// Rekonsiliasi API (SEBELUM): angka yang dikonsumsi tab lama (Traffic = /analytics/traffic, Akuisisi = /atribusi/iklan/sumber, Iklan = /atribusi/iklan) pada snapshot yang sama,
// dibandingkan dengan hitungan langsung dari database fixture (rekon.json). Menulis OUT/rekon-api.json untuk dibandingkan dengan angka di layar Marketing (marketing-browser.cjs).
const fs = require("fs"); const path = require("path");
const API = process.env.API || "http://127.0.0.1:4020"; const OUT = process.env.OUT || "C:/tmp/km-mkt-qa";
const DARI = process.env.DARI || "2026-10-01", SAMPAI = process.env.SAMPAI || "2026-10-10";
const T = JSON.parse(fs.readFileSync(path.join(OUT, "tokens.json"), "utf8")); const ref = JSON.parse(fs.readFileSync(path.join(OUT, "rekon.json"), "utf8"));
const get = async (p, siapa = "admin") => { const r = await fetch(API + p, { headers: { Authorization: `Bearer ${T[siapa].token}` } }); return { status: r.status, json: await r.json().catch(() => null) }; };
(async () => {
  const tabelSql = JSON.stringify(ref.tabel);
  const traffic = (await get(`/api/analytics/traffic?from=${DARI}&to=${SAMPAI}`)).json;
  const sumber = (await get(`/api/atribusi/iklan/sumber?dari=${DARI}&sampai=${SAMPAI}`)).json;
  const meta = (await get(`/api/atribusi/iklan?dari=${DARI}&sampai=${SAMPAI}&level=campaign`)).json;
  const t = sumber.total; const jt = meta.jumlahTeratribusi;
  const acuan = {
    periode: { dari: DARI, sampai: SAMPAI },
    sebelum: {
      traffic: { totalLead: traffic.totalLeads, jumlahHarian: traffic.daily.reduce((a, d) => a + d.value, 0) },
      akuisisi: { lead: t.lead, spam: t.spam, leadSah: t.leadSah, berOrder: t.berOrder, membayar: t.membayar, lunas: t.lunas, nilaiOrder: t.nilaiOrderSaatIni, uangBersih: t.uangBersih, orderEligible: t.orderEligible, spendBerbayar: t.berbayar.spend },
      iklan: { leadTerbukti: jt.leadUnik, berOrder: jt.customerDenganOrder, membayar: jt.customerPernahMembayar, lunas: jt.closingUtama.customerLunasTerbuktiLedger, nilaiOrder: jt.bookedValue, uangBersih: jt.uangBersihLedger, spend: meta.biaya.spend, rekonOk: meta.rekonsiliasi.ok, jumlahCek: meta.rekonsiliasi.cek.length },
      perSumber: Object.fromEntries(sumber.sumber.map((s) => [s.id, { lead: s.lead, spam: s.spam, berOrder: s.berOrder, membayar: s.membayar, lunas: s.lunas, nilai: s.uang.nilaiOrderSaatIni, uang: s.uang.uangBersih, spend: s.biaya.spend }])),
    },
    db: { customerDibuat: ref.customerDibuat, spam: ref.spam, b2bKaryawan: ref.b2bKaryawan, tabel: ref.tabel },
  };
  const cek = [];
  const ok = (n, c, d = "") => { cek.push({ n, ok: !!c, d }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
  ok("Akuisisi: total lead = customer dibuat di DB − B2B/penjualan karyawan", t.lead === ref.customerDibuat - ref.b2bKaryawan, `${t.lead} = ${ref.customerDibuat} − ${ref.b2bKaryawan}`);
  ok("Akuisisi: spam = spam di DB (selain B2B/karyawan)", t.spam === ref.spam, `${t.spam} vs ${ref.spam}`);
  ok("Traffic: total lead = lead Akuisisi − spam (definisi sama, snapshot sama)", traffic.totalLeads === t.lead - t.spam, `traffic ${traffic.totalLeads} vs ${t.lead} − ${t.spam} = ${t.lead - t.spam}`);
  ok("Traffic: Σ harian = total", acuan.sebelum.traffic.jumlahHarian === traffic.totalLeads, `${acuan.sebelum.traffic.jumlahHarian} vs ${traffic.totalLeads}`);
  ok("Iklan (Meta terbukti) ⊂ Akuisisi: Σ per sumber META berOrder ≥ ber-order terbukti campaign", sumber.sumber.find((s) => s.id === "META").berOrder >= jt.customerDenganOrder);
  ok("Iklan: rekonsiliasi server OK", meta.rekonsiliasi.ok === true, `${meta.rekonsiliasi.cek.length} pemeriksaan`);
  ok("Σ lead per sumber = total lead", sumber.sumber.reduce((a, s) => a + s.lead, 0) === t.lead);
  ok("SALES ditolak (403) di /sumber, /atribusi/iklan; tidak ada data bocor", (await get(`/api/atribusi/iklan/sumber?dari=${DARI}&sampai=${SAMPAI}`, "sales")).status === 403 && (await get(`/api/atribusi/iklan?dari=${DARI}&sampai=${SAMPAI}`, "sales")).status === 403);
  acuan.cek = cek;
  fs.writeFileSync(path.join(OUT, "rekon-api.json"), JSON.stringify(acuan, null, 2));
  console.log(JSON.stringify(acuan.sebelum, null, 1).slice(0, 1800));
  process.exit(cek.every((c) => c.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
