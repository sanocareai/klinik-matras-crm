// Tangkapan layar tab Marketing pada SALINAN backup produksi (dist hasil build): ringkasan, kualitas data, Meta campaign → ad set → ad, TikTok, mobile 390 px, gelap.
//   BASE=http://127.0.0.1:5193 API=http://127.0.0.1:4021 OUT=C:/tmp/km-mkt-prodcopy DARI=2026-10-01 SAMPAI=2026-10-29 node frontend/qa-harness/marketing-foto-salinan.cjs
const U = require("./qa-util.cjs"); const { tunggu, tidur, buka, foto } = U;
const DARI = process.env.DARI || "2026-10-01", SAMPAI = process.env.SAMPAI || "2026-10-29"; const P = `dari=${DARI}&sampai=${SAMPAI}`;
(async () => {
  const meta = (await U.apiGet("admin", `/api/atribusi/iklan?${P}&level=campaign`)).json;
  const camp = meta.grup.filter((g) => g.status === "MAPPED").sort((a, b) => (b.lead?.unik || 0) - (a.lead?.unik || 0))[0].campaign.id;
  const adset = (await U.apiGet("admin", `/api/atribusi/iklan?${P}&level=adset&campaignId=${camp}`)).json.grup.find((g) => g.status === "MAPPED").adSet.id;
  const b = await U.mulai();
  try {
    let p = await buka(b, "admin", `/laporan?tab=Marketing&${P}`);
    await tunggu(p, '[data-testid="tabel-sumber"]', 90000); await p.waitForSelector(".recharts-wrapper", { timeout: 60000 }).catch(() => {}); await tidur(1500);
    await foto(p, "P1-ringkasan-salinan");
    await p.click('[data-testid="bagian-kualitas"] button'); await tunggu(p, '[data-butir="rekonMeta"]', 90000); await tidur(1000); await foto(p, "P2-kualitas-data-salinan");
    await p.goto(U.BASE + `/laporan?tab=Marketing&${P}&sumber=META`, { waitUntil: "domcontentloaded" }); await tunggu(p, '[data-testid="tabel-meta"] tbody tr', 90000); await tidur(1500); await foto(p, "P3-meta-campaign-salinan");
    await p.goto(U.BASE + `/laporan?tab=Marketing&${P}&sumber=META&level=adset&campaign=${camp}`, { waitUntil: "domcontentloaded" }); await tunggu(p, '[data-testid="tabel-meta"] tbody tr', 90000); await tidur(1000); await foto(p, "P4-meta-adset-salinan");
    await p.goto(U.BASE + `/laporan?tab=Marketing&${P}&sumber=META&level=ad&campaign=${camp}&adset=${adset}`, { waitUntil: "domcontentloaded" }); await tunggu(p, '[data-testid="tabel-meta"] tbody tr', 90000); await tidur(1000); await foto(p, "P5-meta-ad-salinan");
    await p.goto(U.BASE + `/laporan?tab=Marketing&${P}&sumber=TIKTOK`, { waitUntil: "domcontentloaded" }); await tunggu(p, '[data-testid="detail-marketing"]', 90000); await tidur(1000); await foto(p, "P6-tiktok-salinan");
    await p.close();
    p = await buka(b, "admin", `/laporan?tab=Marketing&${P}`, { lebar: 390, tinggi: 844, hp: true });
    await tunggu(p, '[data-testid="kartu-ringkas"]', 90000); await tidur(2500); await foto(p, "P7-mobile-ringkasan-salinan");
    await p.goto(U.BASE + `/laporan?tab=Marketing&${P}&sumber=META`, { waitUntil: "domcontentloaded" }); await tunggu(p, '[data-testid="tabel-meta"] tbody tr', 90000); await tidur(1500); await foto(p, "P8-mobile-meta-salinan");
    const lebar = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); console.log("mobile tanpa gulir mendatar:", lebar);
    await p.close();
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
