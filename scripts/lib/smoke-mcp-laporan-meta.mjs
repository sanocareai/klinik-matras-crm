import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 260) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap server hidup lewat JALUR AUTH YANG SEBENARNYA (HTTP /mcp, /mcp-chatgpt, /api/atribusi/iklan). Token dibuat di dalam proses ini dari rahasia lingkungan
// kontainer (tidak pernah dicetak/disimpan). Tidak ada tulisan: semua tool read-only; jumlah baris tabel kunci dan sidik referensi harus identik sebelum vs sesudah.
// BEDA dengan discovery konektor: smoke ini membuktikan kode server + auth + hasil, BUKAN bahwa klien (claude.ai / ChatGPT) sudah menyegarkan daftar tool-nya — itu langkah pasca-rilis manual.
const { oauthConfigured, signAccessToken, publicUrl } = await imp("src/mcp/oauthCrypto.js");
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const jwtUser = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } });
let admin = null, biasa = null;
for (const u of users) { const rs = await rolesDari(u); if (!admin && rs.has("ADMIN")) admin = u; if (!biasa && !rs.has("ADMIN")) biasa = u; }
if (!admin) { rec("akun ADMIN aktif tersedia", false); process.exit(1); }

const TABEL = { customer: 'select count(*)::int n from "Customer"', order: 'select count(*)::int n from "Order"', pembayaran: "select count(*)::int n from payments", touch: "select count(*)::int n from attribution_touches", spend: "select count(*)::int n from meta_ad_daily_spend",
  impor: "select count(*)::int n from meta_spend_imports", referensi: "select count(*)::int n from meta_ad_references", biayaSumber: "select count(*)::int n from ad_source_spend_entries", jurnal: "select count(*)::int n from fin_journal_entries" };
const jejak = async () => { const o = {}; for (const [k, q] of Object.entries(TABEL)) o[k] = await hitung(q); o.sidikReferensi = String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(r::text, '|' order by r.ad_id)), '-') as n from meta_ad_references r"))[0].n); return o; };
const j0 = await jejak();

let rid = 0;
const rpc = async (jalur, token, method, params = {}) => {
  const r = await fetch(BASE + jalur, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, params }) });
  const t = await r.text(); const baris = t.split("\n").find((l) => l.startsWith("data:")) ?? t; let json = null; try { json = JSON.parse(baris.replace(/^data:\s*/, "")); } catch { /* bukan JSON */ }
  return { status: r.status, json };
};
const panggil = async (jalur, token, name, args = {}) => { const r = await rpc(jalur, token, "tools/call", { name, arguments: args }); const h = r.json?.result; let data = null; try { data = JSON.parse(h?.content?.[0]?.text ?? "null"); } catch { /* bukan JSON */ } return { status: r.status, isError: !!h?.isError, data }; };
const endpoint = async (p, token) => { const r = await fetch(BASE + "/api/atribusi/iklan" + p, { headers: { Authorization: "Bearer " + token } }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };

// ── jalur auth yang tersedia (bukti jalur yang SEBENARNYA dipakai konektor) ──────────────────────────────────────────────────────────────────────
const JALUR = [];   // { nama, jalur, token, awalan }
if (oauthConfigured()) {
  JALUR.push({ nama: "ChatGPT (OAuth ADMIN, audience /mcp-chatgpt)", jalur: "/mcp-chatgpt", token: signAccessToken({ userId: admin.id, clientId: "smoke-baca-saja", resource: `${publicUrl()}/mcp-chatgpt` }), awalan: "sales_" });
  JALUR.push({ nama: "Claude (OAuth ADMIN, audience /mcp)", jalur: "/mcp", token: signAccessToken({ userId: admin.id, clientId: "smoke-baca-saja", resource: `${publicUrl()}/mcp` }), awalan: "" });
} else skip("jalur OAuth (ChatGPT dan claude.ai)", "MCP_OAUTH_JWT_SECRET tidak terisi di lingkungan ini");
const statik = (process.env.MCP_API_TOKEN ?? "").trim();
if (statik) JALUR.push({ nama: "Claude Code/Desktop (token statis)", jalur: "/mcp", token: statik, awalan: "" }); else skip("jalur token statis /mcp", "MCP_API_TOKEN tidak terisi di lingkungan ini");
rec("minimal satu jalur auth konektor yang sebenarnya dapat diuji", JALUR.length >= 1, JALUR.map((j) => j.nama).join(" | "));

const BARU = ["performa_campaign_meta", "rekap_harian_meta", "kesehatan_atribusi_meta"];
const SEMBILAN = ["sales_daftar_produk", "sales_kesehatan_atribusi_meta", "sales_performa_campaign_meta", "sales_performa_iklan", "sales_rekap_harian_meta", "sales_ringkasan_penjualan", "sales_ringkasan_pipeline", "sales_ringkasan_sumber_lead", "sales_tren_traffic_lead"];

// ── 1. penolakan auth ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const jl of ["/mcp", "/mcp-chatgpt"]) {
  rec(`${jl}: tanpa token = 401`, (await rpc(jl, null, "tools/list")).status === 401);
  rec(`${jl}: token ngawur = 401`, (await rpc(jl, "token-ngawur-smoke", "tools/list")).status === 401);
  rec(`${jl}: JWT sesi pengguna (bukan token MCP) = 401`, (await rpc(jl, await jwtUser(admin), "tools/list")).status === 401);
}
if (oauthConfigured()) {
  const tokChatKePlain = signAccessToken({ userId: admin.id, clientId: "smoke-baca-saja", resource: `${publicUrl()}/mcp` });
  rec("token OAuth audience /mcp ditolak di /mcp-chatgpt (tidak bisa dipakai lintas resource)", (await rpc("/mcp-chatgpt", tokChatKePlain, "tools/list")).status === 401);
  if (biasa) rec("token OAuth akun NON-ADMIN ditolak di /mcp-chatgpt (403)", (await rpc("/mcp-chatgpt", signAccessToken({ userId: biasa.id, clientId: "smoke-baca-saja", resource: `${publicUrl()}/mcp-chatgpt` }), "tools/list")).status === 403);
  else skip("akun non-ADMIN ditolak di /mcp-chatgpt", "tidak ada akun non-ADMIN aktif");
}

// ── 1b. akses /gpt-actions dan penjaga ADMIN tiga tool laporan (diizinkan vs ditolak, jalur auth sebenarnya) ───────────────────────
const TIGA = ["performa_campaign_meta", "rekap_harian_meta", "kesehatan_atribusi_meta"];
const gpt = async (token, name, body = { dari: "2026-10-01", sampai: "2026-10-02" }) => { const r = await fetch(BASE + "/gpt-actions/tools/" + name, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }); const t = await r.text(); return { status: r.status, teks: t }; };
rec("/gpt-actions: tanpa token = 401", (await gpt(null, TIGA[0])).status === 401);
rec("/gpt-actions: token ngawur = 401", (await gpt("token-ngawur-smoke", TIGA[0])).status === 401);
rec("/gpt-actions: JWT sesi pengguna (bukan token MCP) = 401", (await gpt(await jwtUser(admin), TIGA[0])).status === 401);
const stat0 = (process.env.MCP_API_TOKEN ?? "").trim();
if (stat0) { for (const t of TIGA) rec(`/gpt-actions: token statis memanggil ${t} (200, tanpa data pribadi)`, await (async () => { const r = await gpt(stat0, t); return r.status === 200 && !/ctwaClid|customerId|phone|email/i.test(r.teks); })()); }
else skip("/gpt-actions dengan token statis", "MCP_API_TOKEN tidak terisi di lingkungan ini");
if (oauthConfigured()) {
  const aud = (u, p) => signAccessToken({ userId: u.id, clientId: "smoke-baca-saja", resource: `${publicUrl()}${p}` });
  rec("/gpt-actions: token OAuth audience /mcp-chatgpt ditolak (401)", (await gpt(aud(admin, "/mcp-chatgpt"), TIGA[0])).status === 401);
  for (const t of TIGA) rec(`/gpt-actions: OAuth ADMIN aktif memanggil ${t} (200)`, (await gpt(aud(admin, "/mcp"), t)).status === 200);
  if (biasa) {
    for (const t of TIGA) {
      rec(`/gpt-actions: OAuth akun NON-ADMIN ditolak untuk ${t} (403)`, (await gpt(aud(biasa, "/mcp"), t)).status === 403);
      rec(`/mcp: OAuth akun NON-ADMIN ditolak untuk ${t} (403)`, (await rpc("/mcp", aud(biasa, "/mcp"), "tools/call", { name: t, arguments: {} })).status === 403);
    }
  } else skip("akun non-ADMIN ditolak untuk tiga tool di /mcp dan /gpt-actions", "tidak ada akun non-ADMIN aktif");
}

// ── 2. discovery: tools/list lewat jalur auth sebenarnya ───────────────────────────────────────────────────────────────────────────────────────────
for (const jl of JALUR) {
  const init = await rpc(jl.jalur, jl.token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke-baca-saja", version: "1" } });
  rec(`[${jl.nama}] initialize 200, versi server 1.1.0`, init.status === 200 && init.json?.result?.serverInfo?.version === "1.1.0", `${init.status} ${init.json?.result?.serverInfo?.name}@${init.json?.result?.serverInfo?.version}`);
  const ls = await rpc(jl.jalur, jl.token, "tools/list");
  const tools = ls.json?.result?.tools ?? []; const nama = tools.map((t) => t.name);
  rec(`[${jl.nama}] tools/list memuat tiga tool baru${jl.awalan ? " (awalan sales_)" : ""}`, ls.status === 200 && BARU.every((b) => nama.includes(jl.awalan + b)), nama.filter((x) => /meta/.test(x)).join(","));
  rec(`[${jl.nama}] semua tool read-only dan tanpa 'unmask' di schema ChatGPT`, tools.length > 0 && tools.every((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false) && (jl.awalan ? tools.every((t) => !("unmask" in (t.inputSchema?.properties ?? {}))) : true));
  rec(`[${jl.nama}] tool lama performa_iklan tetap ada dan parameternya tidak berubah`, (() => { const lama = tools.find((t) => t.name === jl.awalan + "performa_iklan"); return !!lama && JSON.stringify(Object.keys(lama.inputSchema.properties).sort()) === JSON.stringify(jl.awalan ? ["dari", "hanyaDikonfirmasi", "sampai"] : ["dari", "hanyaDikonfirmasi", "sampai"]); })());
  if (jl.awalan) rec(`[${jl.nama}] tepat sembilan tool aktif (allowlist ChatGPT)`, JSON.stringify([...nama].sort()) === JSON.stringify(SEMBILAN), nama.length);
}

// ── 3. hasil tool = endpoint pada snapshot yang sama (periode tertutup 7 hari, berakhir 3 hari lalu) ───────────────────────────────────────────────────
const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const geser = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const P = { dari: process.env.SMOKE_DARI ?? geser(hariIni, -9), sampai: process.env.SMOKE_SAMPAI ?? geser(hariIni, -3) };   // SMOKE_DARI/SAMPAI hanya untuk uji lokal pada data fixture
const tA = await jwtUser(admin);
const kolomTool = (b) => [b.status, b.akuisisi.leadTerbukti, b.akuisisi.spam, b.order.customerBerOrder, b.order.jumlahOrderEligible, b.order.nilaiOrder, b.order.customerPernahMembayar, b.order.customerLunasTerbuktiLedger, b.uang.uangLedgerBersih, b.biaya.spend, b.biaya.cpaLunas];
const kolomEp = (g) => [g.status, g.lead.unik, g.lead.spam, g.customerDenganOrder, g.orderEligible, g.bookedValue, g.customerPernahMembayar, g.closingUtama.customerLunasTerbuktiLedger, g.uangBersihLedger, g.biaya.spend, g.biaya.cpa];
async function bandingkan(jl, level) {
  const ep = await endpoint(`/?dari=${P.dari}&sampai=${P.sampai}&level=${level}`, tA);
  const tl = await panggil(jl.jalur, jl.token, jl.awalan + "performa_campaign_meta", { ...P, level, batas: 100 });
  if (ep.status !== 200 || tl.status !== 200 || tl.isError) return { ok: false, d: `endpoint ${ep.status} tool ${tl.status}${tl.isError ? " isError" : ""}` };
  const semua = [...tl.data.baris, ...tl.data.tidakTerpetakan, ...(tl.data.unknown ? [tl.data.unknown] : [])];
  const t = ep.json.jumlahTeratribusi;
  const selisih = [];
  if (semua.length !== ep.json.grup.length) selisih.push(`baris ${semua.length}≠${ep.json.grup.length}`);
  for (const g of ep.json.grup) { const b = semua.find((x) => x.kunci === g.kunci); if (!b) { selisih.push(`hilang ${g.kunci}`); continue; } if (JSON.stringify(kolomTool(b)) !== JSON.stringify(kolomEp(g))) selisih.push(`beda ${g.kunci}`); }
  const tt = [tl.data.total.akuisisi.leadTerbukti, tl.data.total.order.customerBerOrder, tl.data.total.order.customerPernahMembayar, tl.data.total.order.customerLunasTerbuktiLedger, tl.data.total.order.nilaiOrder, tl.data.total.uang.uangLedgerBersih];
  const te = [t.leadUnik, t.customerDenganOrder, t.customerPernahMembayar, t.closingUtama.customerLunasTerbuktiLedger, t.bookedValue, t.uangBersihLedger];
  if (JSON.stringify(tt) !== JSON.stringify(te)) selisih.push(`total ${tt}≠${te}`);
  return { ok: selisih.length === 0 && tl.data.rekonsiliasi.ok === true && ep.json.rekonsiliasi.ok === true, d: `${semua.length} baris; ${selisih.join("; ") || "identik"}` };
}
for (const jl of JALUR) {
  for (const level of ["campaign", "adset", "ad"]) {
    let hasil = null;
    for (let i = 0; i < 3; i++) { hasil = await bandingkan(jl, level); if (hasil.ok) break; await new Promise((r) => setTimeout(r, 3000)); }   // data produksi hidup: ulangi bila ada tulisan sah di antara dua pembacaan
    rec(`[${jl.nama}] ${level} ${P.dari}..${P.sampai}: hasil tool == endpoint (kolom per baris + total) dan rekonsiliasi lolos`, hasil.ok, hasil.d);
  }
}
const jl0 = JALUR[0];
if (jl0) {
  const rk = await panggil(jl0.jalur, jl0.token, jl0.awalan + "rekap_harian_meta", { dari: geser(P.sampai, -2), sampai: P.sampai });
  rec("rekap_harian_meta: 3 hari penuh, Σ harian = akumulasi (pemeriksaan aditif tidak ada yang gagal), tampilan kohort", !rk.isError && rk.data?.harian?.length === 3 && rk.data.pemeriksaanAditif.cek.every((c) => c.ok !== false) && rk.data.tampilan === "KOHORT_AKUISISI", rk.isError ? JSON.stringify(rk.data).slice(0, 160) : "");
  const ks = await panggil(jl0.jalur, jl0.token, jl0.awalan + "kesehatan_atribusi_meta", { ...P, periksaLintasLevel: true });
  rec("kesehatan_atribusi_meta: campaign = Σ ad set = Σ ad lolos; capture terbaca; tanpa data customer", !ks.isError && ks.data?.rekonsiliasiLintasLevel?.ok === true && typeof ks.data.capture?.captureAktif === "boolean", ks.isError ? JSON.stringify(ks.data).slice(0, 160) : `${ks.data?.rekonsiliasiLintasLevel?.jumlahCek} pemeriksaan`);
  const lama = await panggil(jl0.jalur, jl0.token, jl0.awalan + "performa_iklan", { dari: P.dari, sampai: P.sampai });
  rec("tool lama performa_iklan masih berfungsi dengan bentuk lama", !lama.isError && ["periode", "totalLead", "perSumberLead", "perKreatifIklanMeta", "cakupanCtwa", "catatan"].every((k) => k in (lama.data ?? {})));
  const salah = await panggil(jl0.jalur, jl0.token, jl0.awalan + "performa_campaign_meta", { dari: P.dari });
  rec("parameter salah → isError dengan kode PARAMETER_TIDAK_VALID (bukan crash)", salah.isError === true && salah.data?.kode === "PARAMETER_TIDAK_VALID");
  const teks = JSON.stringify([rk.data, ks.data]);
  const ids = [...(await prisma.$queryRawUnsafe('select id::text id from "Customer" order by random() limit 40')).map((r) => r.id), ...(await prisma.$queryRawUnsafe('select phone p from "Customer" where phone is not null order by random() limit 40')).map((r) => r.p)];
  rec("respons tidak memuat ID/nomor customer (40+40 sampel acak)", ids.every((x) => !teks.includes(String(x))));
}

// ── 4. READ-ONLY: tidak ada baris berubah ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const j1 = await jejak();
// Produksi HIDUP: tabel lalu lintas (WhatsApp masuk, order, pembayaran) boleh bertambah selama smoke → hanya tidak boleh BERKURANG. Tabel yang bisa ditulis tool laporan yang salah
// (spend, impor spend, referensi Ad, biaya sumber) harus IDENTIK (jumlah + sidik referensi); perubahan di sini hanya mungkin karena aksi Admin yang bersamaan (diulang sekali sebelum gagal).
const MONOTON = ["customer", "order", "pembayaran", "touch", "jurnal"]; const STRIK = ["spend", "impor", "referensi", "biayaSumber", "sidikReferensi"];
let turun = MONOTON.filter((k) => j1[k] < j0[k]); let beda = STRIK.filter((k) => j0[k] !== j1[k]);
if (beda.length) { await new Promise((r) => setTimeout(r, 4000)); const j2 = await jejak(); beda = STRIK.filter((k) => j0[k] !== j2[k]); Object.assign(j1, j2); }
rec("TIDAK ada jejak tulis: spend, impor spend, referensi Ad, biaya sumber, dan sidik referensi IDENTIK sebelum vs sesudah smoke; Customer/Order/pembayaran/touch/jurnal tidak berkurang (lalu lintas sah boleh bertambah)", beda.length === 0 && turun.length === 0, [...beda.map((k) => `${k}:${j0[k]}→${j1[k]}`), ...turun.map((k) => `turun ${k}`)].join(",") || "identik/monoton");
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
