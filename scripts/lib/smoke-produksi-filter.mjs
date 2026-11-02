import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA: filter daftar Order Produksi (posisi unit · PIC · target selesai) pada GET /api/production/work-orders, /work-orders/kelengkapan-hitung, dan /work-orders/export.xlsx.
// Tidak ada tulisan dan tidak ada data percobaan. Kebenaran diperiksa dengan INVARIAN atas data nyata (bukan angka tetap): partisi, hitungan = daftar, setiap baris hasil memenuhi filternya,
// halaman bertahap tidak menghilangkan/menggandakan unit di luar 50 pertama, ekspor = filter yang sama.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const pembaca = info.find((x) => bisa(x.rs, P.UNIT_READ))?.u;
const tanpaIzin = info.find((x) => !bisa(x.rs, P.UNIT_READ))?.u;
if (!pembaca) { rec("akun dengan unit:read tersedia", false); process.exit(1); }
const tok = await tokenUntuk(pembaca);
const W = "/api/production/work-orders";
const get = async (url, token = tok) => { const t0 = process.hrtime.bigint(); const r = await fetch(BASE + url, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; const ct = r.headers.get("content-type") ?? ""; if (/json/.test(ct)) { try { j = await r.json(); } catch { /* bukan JSON */ } } else await r.arrayBuffer(); return { status: r.status, json: j, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; };
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const tambah = (t, n) => new Date(Date.parse(t + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
const POSISI = ["MENUNGGU_DIJEMPUT", "DALAM_PENJEMPUTAN", "SUDAH_DIJEMPUT", "DI_WORKSHOP", "DI_WORKSHOP_TANPA_BUKTI", "DI_WORKSHOP_SIAP", "DALAM_PENGIRIMAN", "DI_PELANGGAN"];
const JEJAK = [["stock_movements", "select count(*)::int n from stock_movements"], ["biaya_beku", "select count(*)::int n from stock_movement_biaya_operasional"], ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["material_issues", "select count(*)::int n from material_issues"],
  ["jurnal", "select count(*)::int n from fin_journal_entries"], ["units", "select count(*)::int n from units"], ["pernyataan", "select count(*)::int n from unit_material_declarations"], ["runs", "select count(*)::int n from production_runs_v2"]];
const jejak = async () => Object.fromEntries(await Promise.all(JEJAK.map(async ([k, q]) => [k, await hitung(q)])));
const s0 = await jejak();
const nUnit = await hitung("select count(*)::int n from units"); const nBatal = await hitung("select count(*)::int n from units where status = 'CANCELLED'");
const hariIni = wib(new Date());

// ── izin dan validasi parameter ──
rec("daftar tanpa token = 401 (juga dengan filter baru)", (await get(`${W}?pic=x&target=terlambat`, null)).status === 401);
rec("hitungan tanpa token = 401", (await get(`${W}/kelengkapan-hitung?target=terlambat`, null)).status === 401);
if (tanpaIzin) { const tX = await tokenUntuk(tanpaIzin); rec("akun tanpa unit:read: daftar dengan filter = 403", (await get(`${W}?posisi=DI_WORKSHOP`, tX)).status === 403); } else skip("akun tanpa unit:read", "semua akun aktif punya unit:read");
rec("posisi tidak dikenal = 400 (ditolak, bukan diabaikan)", (await get(`${W}?posisi=SURGA`)).status === 400);
rec("target tidak dikenal = 400", (await get(`${W}?target=kapan_saja`)).status === 400);
rec("PIC terlalu panjang = 400", (await get(`${W}?pic=${"x".repeat(121)}`)).status === 400);
rec("hitungan juga menolak nilai tidak dikenal (400)", (await get(`${W}/kelengkapan-hitung?posisi=SURGA`)).status === 400);

// ── jumlah dasar: tanpa filter = seluruh unit (sama dengan tabel); semua jalur penuh tidak melampaui batas ──
const dasar = await get(`${W}?page=1&pageSize=1`);
rec(`daftar tanpa filter: total = unit di tabel (${nUnit})`, dasar.status === 200 && dasar.json.total === nUnit, `${dasar.json?.total}`);
const penuh = await get(`${W}?posisi=${POSISI.join(",")}&page=1&pageSize=1`);
if (penuh.status === 413) skip("partisi posisi unit", `unit > batas ${5000} untuk jalur penuh (dilaporkan 413 jujur)`);
else {
  // ── partisi posisi: Σ delapan posisi fisik + unit Dibatalkan = seluruh unit (tiap unit tepat satu posisi) ──
  let jumlah = 0; const per = {};
  for (const k of POSISI) { const r = await get(`${W}?posisi=${k}&page=1&pageSize=1`); per[k] = r.json?.total ?? 0; jumlah += per[k]; }
  rec(`partisi posisi unit: Σ 8 posisi (${jumlah}) + Dibatalkan (${nBatal}) = seluruh unit (${nUnit})`, jumlah + nBatal === nUnit, JSON.stringify(per));
  rec("posisi OR: dua posisi = jumlah keduanya (tanpa tumpang tindih)", (await get(`${W}?posisi=DI_WORKSHOP,DALAM_PENGIRIMAN&page=1&pageSize=1`)).json?.total === per.DI_WORKSHOP + per.DALAM_PENGIRIMAN);
  // setiap baris hasil memenuhi filternya (posisi berasal dari adopsi.posisi.key yang tampil di daftar)
  const tp = POSISI.find((k) => per[k] > 0);
  if (tp) { const r = await get(`${W}?posisi=${tp}&page=1&pageSize=200`); rec(`semua baris filter posisi ${tp} berposisi ${tp}`, r.json.units.length > 0 && r.json.units.every((u) => u.adopsi.posisi.key === tp)); }

  // ── PIC: partisi, hitungan = daftar, nama persis, Belum ditugaskan ──
  const h = await get(`${W}/kelengkapan-hitung`);
  rec("hitungan memuat faset PIC (pic[], tanpaPic) dan Σ = jumlah unit pada lingkup", h.status === 200 && Array.isArray(h.json.pic) && typeof h.json.tanpaPic === "number" && h.json.pic.reduce((a, p) => a + p.jumlah, 0) + h.json.tanpaPic === h.json.totalUnit, `${h.json?.totalUnit}`);
  const tanpa = await get(`${W}?pic=${encodeURIComponent("~tanpa")}&page=1&pageSize=200`);
  rec(`PIC Belum ditugaskan: total daftar = hitungan (${h.json?.tanpaPic}); semua baris tanpa PIC`, tanpa.status === 200 && tanpa.json.total === h.json.tanpaPic && tanpa.json.units.every((u) => !u.adopsi.pic), `${tanpa.json?.total}`);
  const picTop = [...(h.json?.pic ?? [])].sort((a, b) => b.jumlah - a.jumlah)[0];
  if (picTop) {
    const r = await get(`${W}?pic=${encodeURIComponent(picTop.nama)}&page=1&pageSize=200`);
    rec(`PIC ${picTop.nama}: total daftar = hitungan faset (${picTop.jumlah}); semua baris PIC itu`, r.status === 200 && r.json.total === picTop.jumlah && r.json.units.every((u) => u.adopsi.pic?.nama === picTop.nama), `${r.json?.total}`);
    const awalan = picTop.nama.slice(0, -1);
    if (awalan && !h.json.pic.some((p) => p.nama === awalan)) { const bagian = await get(`${W}?pic=${encodeURIComponent(awalan)}&page=1&pageSize=1`); rec("PIC dicocokkan PERSIS: awalan nama bukan PIC → 0 hasil", bagian.status === 200 && bagian.json.total === 0, `${bagian.json?.total}`); }
    // ── kombinasi AND + hitungan ikut filter ──
    const posTop = POSISI.map((k) => [k, per[k]]).sort((a, b) => b[1] - a[1])[0][0];
    const both = await get(`${W}?posisi=${posTop}&pic=${encodeURIComponent(picTop.nama)}&page=1&pageSize=200`);
    rec(`posisi ${posTop} DAN PIC ${picTop.nama}: semua baris memenuhi keduanya; total ≤ min(masing-masing)`, both.status === 200 && both.json.units.every((u) => u.adopsi.posisi.key === posTop && u.adopsi.pic?.nama === picTop.nama) && both.json.total <= Math.min(per[posTop], picTop.jumlah), `${both.json?.total}`);
    const hb = await get(`${W}/kelengkapan-hitung?posisi=${posTop}&pic=${encodeURIComponent(picTop.nama)}`);
    rec("hitungan mengikuti filter yang sama: totalUnit = total daftar", hb.status === 200 && hb.json.totalUnit === both.json.total, `${hb.json?.totalUnit} vs ${both.json?.total}`);
  } else skip("PIC", "tidak ada unit ber-PIC pada data");

  // ── target selesai (hari WIB) ──
  const tgt = {};
  for (const t of ["terlambat", "hari_ini", "tujuh_hari", "belum_ada"]) tgt[t] = await get(`${W}?target=${t}&page=1&pageSize=200`);
  rec("keempat filter target menjawab 200", Object.values(tgt).every((r) => r.status === 200), Object.entries(tgt).map(([k, r]) => `${k}=${r.json?.total}`).join(" "));
  const at = (u) => u.adopsi.targetSelesai?.at;
  rec("terlambat: setiap baris bertarget SEBELUM hari ini (WIB), unit belum Terkirim/Dibatalkan dan status kerja bukan Selesai", tgt.terlambat.json.units.every((u) => at(u) && wib(at(u)) < hariIni && !["DELIVERED", "CANCELLED"].includes(u.status) && !["SELESAI", "DIBATALKAN"].includes(u.adopsi.kerja.key)));
  rec("hari ini: setiap baris bertarget TEPAT hari ini (WIB)", tgt.hari_ini.json.units.every((u) => at(u) && wib(at(u)) === hariIni));
  rec("7 hari ke depan: setiap baris bertarget hari ini .. +6 hari (WIB); ⊇ hari ini", tgt.tujuh_hari.json.units.every((u) => at(u) && wib(at(u)) >= hariIni && wib(at(u)) <= tambah(hariIni, 6)) && tgt.tujuh_hari.json.total >= tgt.hari_ini.json.total);
  rec("belum ada target: setiap baris tanpa target; unit bertarget TIDAK masuk", tgt.belum_ada.json.units.every((u) => !at(u)));
  const hbT = await get(`${W}/kelengkapan-hitung?target=belum_ada`);
  rec("hitungan target=belum_ada: totalUnit = total daftar", hbT.status === 200 && hbT.json.totalUnit === tgt.belum_ada.json.total, `${hbT.json?.totalUnit} vs ${tgt.belum_ada.json?.total}`);

  // ── hasil di luar 50 unit pertama: halaman bertahap lengkap, tanpa duplikat, total/hasMore mengikuti filter ──
  const kandidat = [["posisi", `posisi=${POSISI.map((k) => [k, per[k]]).sort((a, b) => b[1] - a[1])[0][0]}`], ["target", "target=belum_ada"], ["target", "target=tujuh_hari"]];
  let diuji = false;
  for (const [, qs] of kandidat) {
    const satu = await get(`${W}?${qs}&page=1&pageSize=1`); const total = satu.json?.total ?? 0; if (total < 7) continue;
    const ukuran = total > 50 ? 50 : Math.max(2, Math.floor(total / 3)); const id = new Set(); let halaman = 1; let terakhir = null; let urut = true;
    for (;;) { const r = await get(`${W}?${qs}&page=${halaman}&pageSize=${ukuran}`); if (r.status !== 200) { urut = false; break; } for (const u of r.json.units) id.add(u.id); terakhir = r.json; if (!r.json.hasMore) break; halaman += 1; if (halaman > 200) { urut = false; break; } }
    rec(`halaman bertahap ${qs} (ukuran ${ukuran}${total > 50 ? ", >50 hasil" : ""}): ${halaman} halaman memuat ${id.size} unit = total ${total}; tanpa duplikat; hasMore salah di halaman terakhir`, urut && id.size === total && terakhir.hasMore === false && terakhir.total === total);
    diuji = true; if (total > 50) break;
  }
  if (!diuji) skip("halaman bertahap dengan filter", "tidak ada filter dengan ≥ 7 hasil pada data ini");

  // ── ekspor Excel memakai filter yang sama (dicatat di Info Ekspor) ──
  if (picTop) {
    const ex = await fetch(BASE + `${W}/export.xlsx?pic=${encodeURIComponent(picTop.nama)}&target=belum_ada`, { headers: { Authorization: "Bearer " + tok } });
    rec("ekspor dengan filter baru: 200, xlsx", ex.status === 200 && /spreadsheetml/.test(ex.headers.get("content-type") ?? ""), `${ex.status}`);
    if (ex.status === 200) {
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await ex.arrayBuffer())); const wi = wb.getWorksheet("Info Ekspor"); const baris = []; wi?.eachRow((row) => baris.push([String(row.getCell(1).value ?? ""), String(row.getCell(2).value ?? "")]));
      rec("Info Ekspor mencatat filter PIC dan target", baris.some(([k, v]) => k === "Filter: PIC" && v === picTop.nama) && baris.some(([k, v]) => k === "Filter: target selesai" && v === "Belum ada target"), JSON.stringify(baris.filter(([k]) => /^Filter: (PIC|target)/.test(k))));
    }
  }
}

// ── tanpa jejak tulis ──
const s1 = await jejak(); const turun = Object.keys(s0).filter((k) => s1[k] < s0[k]);
rec("TIDAK ada jejak tulis destruktif: stok, biaya beku, harga berlaku, Material Issue, jurnal, unit, pernyataan, run tidak berkurang selama smoke", turun.length === 0, turun.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(" "));
const naik = Object.keys(s0).filter((k) => s1[k] > s0[k]); if (naik.length) console.log("  (info: bertambah selama smoke karena pengguna lain/aplikasi hidup — smoke ini hanya GET: " + naik.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(" ") + ")");
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
