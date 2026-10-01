// LAPORAN DIVISI (Fase 2) — endpoint. Semua angka dari services/finance/laporanDivisi/* (satu mesin untuk layar Finance pusat, workspace divisi, drill-down, dan Export Excel).
// Izin & scope DITEGAKKAN DI SINI (server), bukan menu frontend. Sakelar laporan_divisi_aktif DEFAULT MATI.
//
//   GET    /api/laporan-divisi/akses                 hak akses + sakelar + daftar kategori untuk filter
//   GET    /api/laporan-divisi/laporan               ringkasan per divisi (?from&to&divisi=A,B&kategori=&status=&proyek=)
//   GET    /api/laporan-divisi/dokumen               drill-down dokumen sumber SATU divisi (leader/Finance saja; anggota biasa 403)
//   GET    /api/laporan-divisi/anggaran              daftar versi anggaran (Finance semua; leader hanya divisinya)
//   POST   /api/laporan-divisi/anggaran              buat/ubah DRAF (Finance: semua divisi; leader: divisinya)
//   DELETE /api/laporan-divisi/anggaran/:id          hapus DRAF
//   POST   /api/laporan-divisi/anggaran/:id/setujui  setujui DRAF (finance:approve; pembuat ≠ penyetuju kecuali Admin)
//   GET    /api/laporan-divisi/dry-run               dry-run atribusi (Finance Admin; berjalan walau sakelar MATI)
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { hasPermission, rolesOf, PERMISSIONS as P } from "../middleware/authorize.js";
import { bangunLaporan } from "../services/finance/laporanDivisi/laporan.js";
import { muatAkses, tetapkanScope, bolehRinci, adalahAdminFinance, AksesError, LEVEL } from "../services/finance/laporanDivisi/akses.js";
import { simpanDraf, setujui, hapusDraf, daftarAnggaran, bentukAnggaran, AnggaranError } from "../services/finance/laporanDivisi/anggaran.js";
import { dryRunAtribusi } from "../services/finance/laporanDivisi/dryRun.js";
import { SEMUA_KELOMPOK, LABEL_DIVISI, DIVISI } from "../services/finance/laporanDivisi/divisi.js";

export const laporanDivisiRouter = express.Router();
laporanDivisiRouter.use(requireAuth);

const TGL = /^\d{4}-\d{2}-\d{2}$/;
const hariIniWIB = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

function rentang(q) {
  const wib = hariIniWIB();
  const from = TGL.test(String(q.from || "")) ? String(q.from) : `${wib.slice(0, 7)}-01`;
  const akhir = new Date(Date.UTC(Number(wib.slice(0, 4)), Number(wib.slice(5, 7)), 0)).getUTCDate();
  const to = TGL.test(String(q.to || "")) ? String(q.to) : `${wib.slice(0, 7)}-${String(akhir).padStart(2, "0")}`;
  return { from, to };
}
const dafar = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

function filterDari(q) {
  const f = {};
  if (q.kategori) f.kategori = String(q.kategori).slice(0, 80);
  if (q.status) f.status = String(q.status).slice(0, 40);
  if (q.proyek) f.proyek = String(q.proyek).slice(0, 80);
  return f;
}

function tangani(err, res, label) {
  if (err instanceof AksesError || err instanceof AnggaranError) return res.status(err.statusCode).json({ error: err.message, code: err.code });
  if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
  console.error(`[laporan-divisi] ${label}:`, err);
  return res.status(500).json({ error: "Gagal memproses Laporan Divisi" });
}

laporanDivisiRouter.get("/akses", async (req, res) => {
  try {
    const akses = await muatAkses(prisma, req.user);
    const kategori = akses.semua || akses.level === LEVEL.LEADER
      ? (await prisma.finExpenseCategory.findMany({ where: { active: true }, select: { code: true, name: true, division: true }, orderBy: { name: "asc" } })).map((k) => ({ kode: k.code, nama: k.name, divisi: k.division }))
      : [];
    res.json({
      sakelar: akses.sakelar, level: akses.level, scopes: Object.fromEntries(akses.scopes),
      divisi: SEMUA_KELOMPOK.filter((s) => akses.scopes.has(s)).map((s) => ({ scope: s, label: LABEL_DIVISI[s], peran: akses.scopes.get(s), rinci: bolehRinci(akses, s) })),
      kategori, bolehKelolaFlag: adalahAdminFinance(req.user), bolehSetujuiAnggaran: hasPermission(req.user, P.FINANCE_APPROVE) || adalahAdminFinance(req.user),
    });
  } catch (e) { tangani(e, res, "akses"); }
});

laporanDivisiRouter.get("/laporan", async (req, res) => {
  try {
    const akses = await muatAkses(prisma, req.user);
    const { from, to } = rentang(req.query);
    res.json(await bangunLaporan(prisma, { from, to, scopeDiminta: dafar(req.query.divisi), filter: filterDari(req.query), akses }));
  } catch (e) { tangani(e, res, "laporan"); }
});

laporanDivisiRouter.get("/dokumen", async (req, res) => {
  try {
    const akses = await muatAkses(prisma, req.user);
    const scope = String(req.query.divisi || "");
    if (!scope) return res.status(400).json({ error: "Parameter divisi wajib untuk drill-down dokumen" });
    const { from, to } = rentang(req.query);
    // SERVER yang menegakkan: hanya Finance & leader yang boleh melihat daftar dokumen; anggota biasa hanya ringkasan. Dicek SEBELUM menghitung apa pun.
    tetapkanScope(akses, [scope]);
    if (!bolehRinci(akses, scope)) throw new AksesError("Rincian dokumen hanya untuk Finance dan leader divisi.", 403, "RINCIAN_DILARANG");
    const lap = await bangunLaporan(prisma, { from, to, scopeDiminta: [scope], filter: filterDari(req.query), akses, denganBaris: true });
    const kelompok = req.query.kelompok ? String(req.query.kelompok) : null;
    const tahap = req.query.tahap ? String(req.query.tahap) : null;
    let baris = lap.baris.filter((b) => b.scope === scope);
    if (tahap) baris = baris.filter((b) => b.tahap === tahap);
    if (kelompok) baris = baris.filter((b) => b.kategori?.kode === kelompok || b.sumber === kelompok);
    baris.sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1));
    const maks = 500;
    res.json({
      periode: lap.periode, scope, basis: lap.basis, jumlah: baris.length, terpotong: baris.length > maks,
      baris: baris.slice(0, maks).map((b) => ({ ...b, dokumen: b.dokumen ? { modul: b.dokumen.modul, id: b.dokumen.id, nomor: b.dokumen.nomor } : null })),
      komitmen: lap.komitmenRinci.filter((k) => k.atribusi.bagian.some((x) => x.scope === scope)).map((k) => ({ modul: k.modul, id: k.id, nomor: k.nomor, tanggal: k.tanggal, status: k.status, jumlah: k.jumlah, jenis: k.jenis, kategori: k.atribusi.kategori })),
    });
  } catch (e) { tangani(e, res, "dokumen"); }
});

// ── Anggaran ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function scopeAnggaran(req) {
  const akses = await muatAkses(prisma, req.user);
  if (!akses.sakelar.aktif) throw new AksesError("Laporan Divisi belum diaktifkan oleh Admin Finance.", 403, "LAPORAN_DIVISI_MATI");
  const boleh = [...akses.scopes.entries()].filter(([s, peran]) => DIVISI.includes(s) && ["SEMUA", "LEADER"].includes(peran)).map(([s]) => s);
  if (boleh.length === 0) throw new AksesError("Anggaran hanya untuk Finance dan leader divisi.", 403, "ANGGARAN_DILARANG");
  return { akses, boleh };
}

laporanDivisiRouter.get("/anggaran", async (req, res) => {
  try {
    const { boleh } = await scopeAnggaran(req);
    const minta = dafar(req.query.divisi);
    const divisions = minta.length ? minta.filter((d) => boleh.includes(d)) : boleh;
    if (minta.length && divisions.length !== minta.length) throw new AksesError("Anda tidak punya akses ke anggaran divisi ini.", 403, "SCOPE_DILARANG");
    res.json({ anggaran: await daftarAnggaran(prisma, { divisions, from: req.query.from || null, to: req.query.to || null, status: req.query.status || null }) });
  } catch (e) { tangani(e, res, "anggaran-daftar"); }
});

laporanDivisiRouter.post("/anggaran", async (req, res) => {
  try {
    const { boleh } = await scopeAnggaran(req);
    const b = req.body || {};
    if (!boleh.includes(b.division)) throw new AksesError("Anda tidak boleh mengatur anggaran divisi ini.", 403, "SCOPE_DILARANG");
    const baru = await prisma.$transaction((tx) => simpanDraf(tx, { division: b.division, categoryId: b.categoryId || null, projectKey: b.projectKey || null, period: b.period, amount: b.amount, reason: b.reason ?? null, userId: req.user.id }));
    res.status(201).json({ anggaran: bentukAnggaran(baru) });
  } catch (e) { tangani(e, res, "anggaran-simpan"); }
});

laporanDivisiRouter.delete("/anggaran/:id", async (req, res) => {
  try {
    const { boleh } = await scopeAnggaran(req);
    const b = await prisma.finDivisionBudget.findUnique({ where: { id: req.params.id }, select: { division: true } });
    if (!b || !boleh.includes(b.division)) return res.status(404).json({ error: "Anggaran tidak ditemukan" });
    await prisma.$transaction((tx) => hapusDraf(tx, { id: req.params.id, userId: req.user.id }));
    res.json({ ok: true });
  } catch (e) { tangani(e, res, "anggaran-hapus"); }
});

laporanDivisiRouter.post("/anggaran/:id/setujui", async (req, res) => {
  try {
    await scopeAnggaran(req);
    const adminFinance = adalahAdminFinance(req.user);
    if (!(hasPermission(req.user, P.FINANCE_APPROVE) || adminFinance) || rolesOf(req.user).length === 0) throw new AksesError("Hanya Finance (penyetuju) yang dapat menyetujui anggaran.", 403, "BUKAN_PENYETUJU");
    const b = await prisma.$transaction((tx) => setujui(tx, { id: req.params.id, userId: req.user.id, adminFinance }));
    res.json({ anggaran: bentukAnggaran(b) });
  } catch (e) { tangani(e, res, "anggaran-setujui"); }
});

// ── Dry-run atribusi (Finance Admin; BACA-SAJA; tetap bisa dijalankan saat sakelar MATI) ─────────────────────────────────
laporanDivisiRouter.get("/dry-run", async (req, res) => {
  try {
    if (!adalahAdminFinance(req.user)) throw new AksesError("Dry-run atribusi hanya untuk Admin Finance.", 403, "BUKAN_ADMIN");
    const from = TGL.test(String(req.query.from || "")) ? String(req.query.from) : "2026-01-01";
    const to = TGL.test(String(req.query.to || "")) ? String(req.query.to) : hariIniWIB();
    res.json(await dryRunAtribusi(prisma, { from, to }));
  } catch (e) { tangani(e, res, "dry-run"); }
});

