// Impor referensi Ad → Ad Set → Campaign dari file Windsor (references[]), lewat JALUR APLIKASI (POST /api/atribusi/iklan/referensi). Dijalankan DI DALAM container backend via stdin.
//   payload stdin: { references:[{adId,adSetId,campaignId,adName,adSetName,campaignName}], csv:"…" }   env: REF_MODE=dry|commit
// Gerbang commit: pemeriksaan silang ke CSV spend (setiap Ad referensi ada di CSV dengan Ad Set/Campaign IDENTIK; setiap Ad ID di CSV punya referensi — sudah ada atau baru), dry-run aplikasi 0 konflik/0 ditolak.
// Sumber referensi di tabel = "MANUAL" (enum referensi tidak memuat WINDSOR_API; konsisten dengan impor sebelumnya). Tidak menimpa referensi lama (izinkanKoreksi tidak pernah dikirim).
"use strict";
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const ID = /^\d{5,32}$/;
function parseCsv(teks) {
  const s = String(teks).replace(/^﻿/, ""); const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) { const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; } else cell += c; }
  row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row); return rows;
}
(async () => {
  const MODE = process.env.REF_MODE || "dry";
  const stdin = await new Promise((res) => { let b = ""; process.stdin.on("data", (c) => (b += c)); process.stdin.on("end", () => res(b)); });
  const { references, csv } = JSON.parse(stdin);
  const out = { mode: MODE, galat: [] };
  const t = parseCsv(csv); const h = t[0].map((x) => x.trim().toLowerCase().replace(/\s+/g, "_")); const ix = (n) => h.indexOf(n);
  const hierCsv = new Map();
  for (const r of t.slice(1)) { const a = r[ix("ad_id")]; const x = [r[ix("adset_id")], r[ix("campaign_id")]]; const l = hierCsv.get(a); if (l && (l[0] !== x[0] || l[1] !== x[1])) out.galat.push(`CSV: Ad ${a} hierarki ganda`); hierCsv.set(a, x); }
  for (const r of references) {
    for (const k of ["adId", "adSetId", "campaignId"]) if (!ID.test(String(r[k] ?? ""))) out.galat.push(`referensi ${r.adId}: ${k} bukan ID digit`);
    const x = hierCsv.get(r.adId);
    if (!x) out.galat.push(`referensi ${r.adId}: tidak ada di CSV`); else if (x[0] !== r.adSetId || x[1] !== r.campaignId) out.galat.push(`referensi ${r.adId}: hierarki beda dari CSV`);
  }
  const adaDb = await prisma.metaAdReference.findMany({ select: { adId: true, adSetId: true, campaignId: true } });
  const petaDb = new Map(adaDb.map((r) => [r.adId, r]));
  const baru = new Set(references.map((r) => r.adId));
  for (const a of hierCsv.keys()) {
    const d = petaDb.get(a);
    if (d) { const x = hierCsv.get(a); if (d.adSetId !== x[0] || d.campaignId !== x[1]) out.galat.push(`Ad ${a}: referensi produksi BEDA dari CSV`); }
    else if (!baru.has(a)) out.galat.push(`Ad ${a}: tanpa referensi (tidak di produksi, tidak di file referensi baru)`);
  }
  out.cakupanSebelum = { adIdCsv: hierCsv.size, adaDiProduksi: [...hierCsv.keys()].filter((a) => petaDb.has(a)).length, dariFileBaru: [...hierCsv.keys()].filter((a) => !petaDb.has(a) && baru.has(a)).length };
  const adm = await prisma.user.findFirst({ where: { active: true, role: "ADMIN" } });
  const token = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: [adm.role] }, process.env.JWT_SECRET, { expiresIn: "3m" });
  const post = async (dryRun) => { const r = await fetch("http://127.0.0.1:4000/api/atribusi/iklan/referensi", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ rows: references, dryRun, sumber: "MANUAL", namaBerkas: "windsor-new-ad-references-2026-10-01-to-14.json" }) }); return { s: r.status, j: await r.json() }; };
  const dr = await post(true);
  out.dryRun = { http: dr.s, ringkasan: dr.j.ringkasan, ditolak: dr.j.ditolak, konflik: dr.j.konflik, koreksi: dr.j.koreksi, importId: dr.j.importId || null };
  const bersih = out.galat.length === 0 && dr.s === 200 && dr.j.ringkasan.konflik === 0 && dr.j.ringkasan.ditolak === 0 && dr.j.ringkasan.koreksi === 0;
  out.gerbangBersih = bersih;
  if (MODE === "commit") {
    if (!bersih) out.komit = "DIBATALKAN: gerbang tidak bersih; tidak ada yang ditulis";
    else { const k = await post(false); out.komit = { http: k.s, ringkasan: k.j.ringkasan, importId: k.j.importId ? "ada" : null, waktuWib: new Date(Date.now() + 7 * 3600e3).toISOString().replace("T", " ").slice(0, 19) + " WIB" }; }
  }
  const sesudah = await prisma.metaAdReference.findMany({ select: { adId: true, adSetId: true, campaignId: true } });
  const ps = new Map(sesudah.map((r) => [r.adId, r]));
  out.sesudah = { refTotal: sesudah.length, adIdCsvTerpetakan: [...hierCsv.keys()].filter((a) => ps.has(a)).length, adIdCsv: hierCsv.size, hierarkiBedaDariCsv: [...hierCsv.keys()].filter((a) => ps.has(a) && (ps.get(a).adSetId !== hierCsv.get(a)[0] || ps.get(a).campaignId !== hierCsv.get(a)[1])).length, imporRef: await prisma.metaAdReferenceImport.count() };
  console.log(JSON.stringify(out, null, 1));
  await prisma.$disconnect();
})().catch((e) => { console.log("ERROR " + String(e.message).slice(0, 200)); process.exit(1); });
