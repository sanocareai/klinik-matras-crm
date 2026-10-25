// /api/atribusi/iklan/biaya-sumber — biaya iklan TINGKAT SUMBER (manual harian / total rentang). HANYA ADMIN (router induk memasang requireAuth + requireAdmin).
//   GET  /biaya-sumber?dari&sampai[&sumber][&batal=1]   entri + cakupan per sumber pada rentang (baca-saja)
//   PUT  /biaya-sumber                                  buat/ubah entri (kunci: sumber+jenis+dari+sampai+akun). dryRun:true = hanya rencana. Alasan wajib. Idempoten.
//   POST /biaya-sumber/:id/batalkan                     batalkan entri (tidak dihapus; revisi tercatat). Alasan wajib.
//   GET  /biaya-sumber/:id/riwayat                      jejak revisi append-only
// Tidak ada token/secret yang diminta atau disimpan. Tidak menyentuh meta_ad_daily_spend, campaign, budget, pembayaran, atau label customer.
import { prisma } from "../db.js";
import { SUMBER_BERBIAYA, daftarEntri, riwayatEntri, simpanEntri, batalkanEntri, muatBiayaSumber, hariIniWib, tglValid, selisihHari, ErrBiaya, MAKS_HARI_ENTRI } from "../services/attribution/biayaSumber.js";

function galat(res, err) {
  if (err instanceof ErrBiaya) return res.status(err.statusCode).json({ error: err.message, code: err.code, ...(err.data ? { data: err.data, details: err.data } : {}) });
  console.error("atribusi/iklan/biaya-sumber error:", err?.code || err?.name || "ERROR");
  return res.status(500).json({ error: "Gagal memproses biaya iklan sumber" });
}
export function pasangRuteBiayaSumber(router) {
  router.get("/biaya-sumber", async (req, res) => {
    try {
      const hariIni = hariIniWib();
      const dari = String(req.query.dari ?? ""), sampai = String(req.query.sampai ?? "");
      if (!tglValid(dari) || !tglValid(sampai) || dari > sampai || sampai > hariIni || selisihHari(dari, sampai) + 1 > 93) return res.status(400).json({ error: "dari/sampai harus YYYY-MM-DD (WIB), dari <= sampai, tidak di masa depan, maks 93 hari", code: "TANGGAL_TIDAK_VALID" });
      const sumber = req.query.sumber ? String(req.query.sumber).toUpperCase() : null;
      if (sumber && !SUMBER_BERBIAYA.includes(sumber)) return res.status(400).json({ error: "sumber tidak berbiaya", code: "SUMBER_TIDAK_BERBIAYA" });
      const batal = req.query.batal === "1" || req.query.batal === "true";
      const entri = await daftarEntri(prisma, { sumber, dari, sampai, termasukBatal: batal });
      const cak = await muatBiayaSumber(prisma, { dari, sampai, hariIni });
      res.set("Cache-Control", "no-store");
      return res.json({
        rentang: { dari, sampai, hariIni }, sumberBerbiaya: SUMBER_BERBIAYA, maksHariEntri: MAKS_HARI_ENTRI, entri,
        cakupan: Object.fromEntries([...cak.entries()].filter(([k]) => !sumber || k === sumber).map(([k, v]) => [k, v.cakupan])),
        aturan: [
          "Biaya manual bertingkat SUMBER; tidak dialokasikan ke campaign/ad.",
          "Detail Ad (Windsor/API/CSV) dan manual untuk hari yang sama TIDAK dijumlah: detail Ad menang kecuali entri manual ditandai 'ganti detail Ad' (alasan wajib).",
          "Total rentang hanya dipakai bila rentang laporan memuat seluruh rentangnya; tidak pernah diprorata.",
          "Rp0 harus dikonfirmasi; tanpa entri = belum diisi. Hari hilang atau rentang tidak cocok membuat CPA/ROAS null.",
        ],
      });
    } catch (e) { return galat(res, e); }
  });
  router.put("/biaya-sumber", async (req, res) => {
    try { const r = await simpanEntri(prisma, req.body ?? {}, { aktor: req.user }); res.set("Cache-Control", "no-store"); return res.status(r.aksi === "BARU" && r.ditulis ? 201 : 200).json(r); } catch (e) { return galat(res, e); }
  });
  router.post("/biaya-sumber/:id/batalkan", async (req, res) => {
    try { return res.json(await batalkanEntri(prisma, { id: req.params.id, alasan: req.body?.alasan, aktor: req.user })); } catch (e) { return galat(res, e); }
  });
  router.get("/biaya-sumber/:id/riwayat", async (req, res) => {
    try {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) return res.status(404).json({ error: "Entri tidak ditemukan", code: "TIDAK_ADA" });
      res.set("Cache-Control", "no-store"); return res.json({ id: req.params.id, riwayat: await riwayatEntri(prisma, req.params.id) });
    } catch (e) { return galat(res, e); }
  });
}
