// KLAIM LUNAS SALES — endpoint Sales (web + aplikasi) dan penyaji Bukti Pembayaran. Aturan & alasan: services/finance/klaimLunas.js.
//
//   GET    /api/klaim-lunas/order/:orderId        klaim order ini + apakah bisa diklaim (Sales: hanya miliknya; Admin: semua)
//   POST   /api/klaim-lunas/order/:orderId        buat draft (boleh tanpa bukti/catatan; idempoten per pemilik)
//   PATCH  /api/klaim-lunas/:id                   ubah isi (draft / diminta bukti / ditolak)
//   GET    /api/klaim-lunas/dari-pesan/:messageId/order   order pelanggan di chat itu yang bisa dicatat pembayarannya (pemilih order di Inbox)
//   POST   /api/klaim-lunas/order/:orderId/dari-pesan     jadikan FOTO/PDF chat sebagai bukti pada draf klaim order (body: { messageId }); lihat services/finance/klaimDariChat.js
//   POST   /api/klaim-lunas/:id/bukti             unggah SATU Bukti Pembayaran (multipart field "berkas") — JPG/PNG/WEBP/PDF, maks 8 MB
//   DELETE /api/klaim-lunas/:id/bukti/:evidenceId hapus bukti dari klaim yang belum diajukan
//   POST   /api/klaim-lunas/:id/ajukan            ajukan — server menolak yang tidak lengkap (422), apa pun yang dikirim UI
//   POST   /api/klaim-lunas/:id/tarik             tarik klaim sebelum diverifikasi
//   GET    /media/klaim-lunas/:file               berkas bukti: Bearer (pemilik klaim / Finance / Admin) ATAU URL bertanda-tangan 15 menit
//
// Aksi Finance (antrean, minta bukti, tolak, verifikasi) ada di routes/financePenerimaan.js (/api/finance/penerimaan/klaim-lunas/...).

import express from "express";
import multer from "multer";
import fs from "node:fs";
import { prisma } from "../db.js";
import { requireAuth, authenticateBearer } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { hasPermission, rolesOf, requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { createLimiter } from "../lib/rateLimit.js";
import {
  klaimUntukOrder, buatDraft, ubahKlaim, lampirkanBukti, hapusBukti, ajukanKlaim, tarikKlaim, klaimUntukResi, buatDraftResi, klaimGateAktif, KlaimError,
} from "../services/finance/klaimLunas.js";
import { ResiBayarError } from "../services/resiPembayaran.js";
import { kandidatOrderDariPesan, lampirkanDariPesan } from "../services/finance/klaimDariChat.js";
import { simpanBerkas, hapusBerkasDisk, BerkasError, MAKS_UKURAN_BYTE, POLA_NAMA, pathBerkas, tandaTanganSah } from "../services/finance/klaimLunasBerkas.js";

export const klaimLunasRouter = express.Router();
klaimLunasRouter.use(requireAuth);
klaimLunasRouter.use(idempotency);
klaimLunasRouter.use(requirePermission(P.ORDER_WRITE)); // Sales, Admin (dan peran lain yang boleh menulis order); DRIVER/HELPER/GUDANG ditolak 403

// Memori (bukan disk): isi berkas diperiksa dulu (magic bytes) baru ditulis dengan nama buatan server. Berkas ditolak tidak pernah menyentuh disk.
const unggah = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAKS_UKURAN_BYTE, files: 1 } });
const limiterUnggah = createLimiter({
  windowMs: 60_000, max: 30,
  keyFn: (req) => (req.user?.id ? `klaim-unggah:${req.user.id}` : null),
  message: "Terlalu banyak unggahan. Coba lagi sebentar lagi.",
});

function kirimGalat(e, res) {
  if (e instanceof ResiBayarError) return res.status(e.statusCode || 409).json({ error: e.message, ...(e.code && { code: e.code }) });
  if (e instanceof KlaimError || e instanceof BerkasError) {
    return res.status(e.statusCode).json({ error: e.message, ...(e.code && { code: e.code }), ...(e.kekurangan && { kekurangan: e.kekurangan }) });
  }
  if (e?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `Ukuran berkas maksimal ${MAKS_UKURAN_BYTE / 1024 / 1024} MB`, code: "BERKAS_TERLALU_BESAR" });
  if (e?.name === "MulterError") return res.status(400).json({ error: "Unggahan tidak valid", code: "UNGGAHAN_TIDAK_VALID" });
  if (e?.code === "P2002") return res.status(409).json({ error: "Data dengan kunci yang sama sudah ada", code: "DUPLIKAT" });
  console.error("[klaimLunas]", e);
  return res.status(500).json({ error: "Terjadi kesalahan di server" });
}

const lihatSemua = (user) => rolesOf(user).includes("ADMIN");

// Status sakelar rollout — dibaca klien (web & aplikasi Sales) untuk memilih UI lama vs klaim berbukti.
klaimLunasRouter.get("/status", async (req, res) => {
  try { res.json({ aktif: await klaimGateAktif(prisma) }); } catch (e) { kirimGalat(e, res); }
});

klaimLunasRouter.get("/order/:orderId", async (req, res) => {
  try {
    res.json(await klaimUntukOrder(prisma, { orderId: req.params.orderId, user: req.user, lihatSemua: lihatSemua(req.user) }));
  } catch (e) { kirimGalat(e, res); }
});

klaimLunasRouter.post("/order/:orderId", async (req, res) => {
  try {
    const hasil = await buatDraft(prisma, { orderId: req.params.orderId, user: req.user, data: req.body || {} });
    res.status(hasil.dibuatBaru ? 201 : 200).json(hasil);
  } catch (e) { kirimGalat(e, res); }
});

// ── Klaim level RESI (satu klaim untuk seluruh Resi; alokasi ke child hanya oleh helper kanonis server saat Finance memverifikasi) ──
klaimLunasRouter.get("/resi/:groupId", async (req, res) => {
  try {
    res.json(await klaimUntukResi(prisma, { groupId: req.params.groupId, user: req.user, lihatSemua: lihatSemua(req.user) }));
  } catch (e) { kirimGalat(e, res); }
});

// ── Dari chat: foto bukti transfer di Inbox → draf klaim ────────────────────────────────────────────────────────────
// Membaca pesan chat → wajib izin baca percakapan SELAIN izin tulis order (router sudah mewajibkan ORDER_WRITE).
const wajibBacaChat = (req, res, next) => (hasPermission(req.user, P.CONVERSATION_READ)
  ? next() : res.status(403).json({ error: "Anda tidak punya akses ke percakapan ini", code: "TIDAK_ADA_AKSES_CHAT" }));

klaimLunasRouter.get("/dari-pesan/:messageId/order", wajibBacaChat, async (req, res) => {
  try {
    res.json(await kandidatOrderDariPesan(prisma, { messageId: req.params.messageId, user: req.user }));
  } catch (e) { kirimGalat(e, res); }
});

klaimLunasRouter.post("/order/:orderId/dari-pesan", wajibBacaChat, limiterUnggah, async (req, res) => {
  try {
    const hasil = await lampirkanDariPesan(prisma, { orderId: req.params.orderId, messageId: req.body?.messageId, user: req.user });
    res.status(hasil.duplikat ? 200 : 201).json(hasil);
  } catch (e) { kirimGalat(e, res); }
});

klaimLunasRouter.post("/resi/:groupId", async (req, res) => {
  try {
    const hasil = await buatDraftResi(prisma, { groupId: req.params.groupId, user: req.user, data: req.body || {} });
    res.status(hasil.dibuatBaru ? 201 : 200).json(hasil);
  } catch (e) { kirimGalat(e, res); }
});

klaimLunasRouter.patch("/:id", async (req, res) => {
  try {
    const { versi, ...data } = req.body || {};
    res.json({ klaim: await ubahKlaim(prisma, { claimId: req.params.id, user: req.user, data, versi }) });
  } catch (e) { kirimGalat(e, res); }
});

// Galat multer (mis. berkas terlalu besar) ditangkap di sini supaya dijawab JSON yang jelas, bukan 500 dari penanganan galat bawaan Express.
const terimaBerkas = (req, res, next) => unggah.single("berkas")(req, res, (e) => {
  if (!e) return next();
  // Apa pun galat pengurai multipart (header rusak, bagian tak terduga, dsb.) = unggahan dari klien yang tidak valid → 400, bukan 500.
  if (e?.code === "LIMIT_FILE_SIZE") return kirimGalat(e, res);
  return res.status(400).json({ error: "Unggahan tidak valid", code: "UNGGAHAN_TIDAK_VALID" });
});

klaimLunasRouter.post("/:id/bukti", limiterUnggah, terimaBerkas, async (req, res) => {
  let tersimpan = null;
  try {
    // Kepemilikan & status dicek SEBELUM menulis ke disk — tidak ada berkas yatim untuk klaim milik orang lain / yang sudah diajukan.
    const { klaim } = await klaimUntukKlaim(req);
    if (!klaim) throw new KlaimError("Klaim tidak ditemukan", 404, "KLAIM_TIDAK_ADA");
    tersimpan = simpanBerkas(req.file);
    const hasil = await lampirkanBukti(prisma, { claimId: req.params.id, user: req.user, berkas: tersimpan });
    if (hasil.duplikat) hapusBerkasDisk(tersimpan.storedName); // isi identik sudah ada pada klaim ini — tidak menyimpan dua salinan
    res.status(hasil.duplikat ? 200 : 201).json(hasil);
  } catch (e) {
    if (tersimpan) hapusBerkasDisk(tersimpan.storedName); // gagal mencatat → tidak meninggalkan berkas tanpa baris
    kirimGalat(e, res);
  }
});

async function klaimUntukKlaim(req) {
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { klaim: null };
  const k = await prisma.orderPaymentClaim.findUnique({ where: { id }, select: { id: true, createdById: true, status: true } });
  if (!k || (k.createdById !== req.user.id && !lihatSemua(req.user))) return { klaim: null };
  return { klaim: k };
}

klaimLunasRouter.delete("/:id/bukti/:evidenceId", async (req, res) => {
  try {
    res.json(await hapusBukti(prisma, { claimId: req.params.id, evidenceId: req.params.evidenceId, user: req.user }));
  } catch (e) { kirimGalat(e, res); }
});

klaimLunasRouter.post("/:id/ajukan", async (req, res) => {
  try {
    const hasil = await ajukanKlaim(prisma, { claimId: req.params.id, user: req.user });
    res.status(hasil.diulang ? 200 : 201).json(hasil);
  } catch (e) { kirimGalat(e, res); }
});

klaimLunasRouter.post("/:id/tarik", async (req, res) => {
  try {
    res.json(await tarikKlaim(prisma, { claimId: req.params.id, user: req.user }));
  } catch (e) { kirimGalat(e, res); }
});

// ── penyaji berkas (di luar /api, seperti /media/bukti-pembayaran) ──────────────────────────────────────────────────
const TIPE = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };

async function bolehLihat(user, file) {
  if (hasPermission(user, P.FINANCE_READ) || rolesOf(user).includes("ADMIN")) return true;
  // Pemilik klaim (Sales pembuat) — berkas terikat ke SATU klaim lewat stored_name unik.
  const e = await prisma.orderPaymentClaimEvidence.findUnique({ where: { storedName: file }, select: { claim: { select: { createdById: true } } } });
  return !!e && e.claim.createdById === user.id;
}

export const klaimLunasFilePathRouter = express.Router();
klaimLunasFilePathRouter.get("/:file", async (req, res) => {
  try {
    const file = String(req.params.file);
    if (!POLA_NAMA.test(file)) return res.status(404).json({ error: "Bukti tidak ditemukan" });
    if (req.query.sig) {
      if (!tandaTanganSah(file, req.query.exp, req.query.sig)) return res.status(403).json({ error: "Tautan bukti tidak valid atau sudah kedaluwarsa" });
    } else {
      const user = await authenticateBearer(req);
      if (!user) return res.status(401).json({ error: "Belum login" });
      if (!(await bolehLihat(user, file))) return res.status(403).json({ error: "Anda tidak punya akses untuk melihat bukti ini" });
    }
    const abs = pathBerkas(file);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "Bukti tidak ditemukan" });
    res.setHeader("Content-Type", TIPE[file.split(".").pop()]);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox"); // berkas bukti tidak boleh menjalankan apa pun di origin aplikasi
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, max-age=300");
    fs.createReadStream(abs).on("error", () => res.destroy()).pipe(res);
  } catch (e) {
    console.error("[klaimLunas] media:", e);
    if (!res.headersSent) res.status(500).json({ error: "Terjadi kesalahan di server" });
  }
});
