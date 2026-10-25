// SSO Task & Meeting (D-200) — /api/hub/*. Kontrak lengkap: docs/HUB-SSO.md.
//
//   POST /api/hub/handoff            pengguna login (Bearer JWT) → kode sekali-pakai
//   POST /api/hub/internal/exchange  HUB (server) menukar kode → identitas
//   POST /api/hub/internal/introspect HUB memvalidasi ulang: aktif? peran?
//   POST /api/hub/internal/revoke    cabut kode yang belum terpakai milik pengguna
//
// SELURUHNYA di balik HUB_SSO_ENABLED (default mati → 404, seolah tidak ada;
// tidak ada baris tertulis, tidak ada audit). Enabled tapi konfigurasi cacat →
// 503. Ini TIDAK mengubah alur login mana pun: tidak ada field baru di respons
// /auth/login, /auth/me, portals, maupun capabilities.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { clientIp, createLimiter } from "../lib/rateLimit.js";
import {
  hubSsoConfig,
  isInternalRequest,
  safeEqualToken,
} from "../lib/domain/hubSso.js";
import {
  auditServiceDenied,
  exchangeHandoff,
  introspectUser,
  issueHandoff,
  revokeHandoffs,
} from "../services/hubSso.js";

export const hubSsoRouter = express.Router();

let misconfigLogged = false;

function noStore(_req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
}

/** Pintu utama fitur. Dibaca dari env PER REQUEST (bukan saat impor) supaya tes dan operator bisa membalik flag. */
function requireHubSsoEnabled(req, res, next) {
  const config = hubSsoConfig();
  if (!config.enabled) return res.status(404).json({ error: "Tidak ditemukan" });
  if (!config.ready) {
    if (!misconfigLogged) {
      misconfigLogged = true;
      console.error(`[hubSso] HUB_SSO_ENABLED=true tapi konfigurasi tidak valid: ${config.problems.join("; ")}`);
    }
    return res.status(503).json({ error: "SSO Task & Meeting belum dikonfigurasi", code: "HUB_SSO_MISCONFIGURED" });
  }
  req.hubSso = config;
  next();
}

hubSsoRouter.use(noStore);
hubSsoRouter.use(requireHubSsoEnabled);

// ─── Pengguna: minta kode ───────────────────────────────────────────────────

const handoffLimiter = createLimiter({
  windowMs: 60_000,
  max: 10,
  keyFn: (req) => (req.user?.id ? `hub-handoff:${req.user.id}` : null),
  message: "Terlalu sering membuka Task & Meeting. Coba lagi sebentar lagi.",
});

hubSsoRouter.post("/handoff", requireAuth, handoffLimiter, async (req, res) => {
  try {
    // `stateHash` WAJIB (D-200 tahap 4) — SHA-256(state) yang HUB buat di
    // GET /sso/start dan kirim ke halaman peluncuran SANSS lewat query
    // string. Diteruskan apa adanya; bentuknya divalidasi di issueHandoff.
    const result = await issueHandoff({
      userId: req.user.id,
      next: req.body?.next,
      stateHash: req.body?.stateHash,
      ip: clientIp(req),
    });

    if (!result.ok) {
      if (result.reason === "destination_not_allowed") {
        return res.status(400).json({ error: "Tujuan tidak diizinkan", code: "DESTINATION_NOT_ALLOWED" });
      }
      if (result.reason === "invalid_state") {
        return res.status(400).json({ error: "Permintaan tidak lengkap — buka Task & Meeting lagi dari awal", code: "INVALID_STATE" });
      }
      // Nonaktif / tanpa izin / tak dikenal: satu pesan yang sama (rinciannya di audit saja).
      return res.status(403).json({ error: "Akses ke Task & Meeting tidak tersedia untuk akun ini", code: "HUB_ACCESS_DENIED" });
    }

    // Alamat HANYA dari env (HUB_BASE_URL). Kode dikirim lewat form POST dari
    // browser — bukan di URL — supaya tidak masuk log, riwayat, atau Referer.
    res.json({
      method: "POST",
      postUrl: `${req.hubSso.baseUrl}/sso/callback`,
      fields: { code: result.code },
      expiresInSec: 60,
    });
  } catch (err) {
    console.error("[hubSso] handoff gagal:", err.message);
    res.status(500).json({ error: "Gagal menyiapkan akses Task & Meeting" });
  }
});

// ─── Server-ke-server ───────────────────────────────────────────────────────

const internal = express.Router();

// Batas per IP sebelum autentikasi, supaya penolakan (yang diaudit) tidak bisa
// dipakai membanjiri activity_events.
const internalLimiter = createLimiter({
  windowMs: 60_000,
  max: 120,
  keyFn: (req) => `hub-internal:${clientIp(req)}`,
  message: "Terlalu banyak permintaan.",
});

async function requireHubService(req, res, next) {
  const ip = clientIp(req);
  const deny = async (status, reason, body) => {
    try {
      await auditServiceDenied({ reason, path: req.originalUrl?.split("?")[0], ip });
    } catch (err) {
      console.error("[hubSso] audit penolakan layanan gagal:", err.message);
    }
    return res.status(status).json(body);
  };

  // Datang lewat proxy/internet: pura-pura tidak ada.
  if (!isInternalRequest(req)) return deny(404, "not_internal", { error: "Tidak ditemukan" });

  const token = req.get("x-hub-service-token");
  if (!token) return deny(401, "token_missing", { error: "Token layanan diperlukan", code: "SERVICE_TOKEN_REQUIRED" });
  if (!safeEqualToken(token, req.hubSso.serviceToken)) {
    return deny(401, "token_invalid", { error: "Token layanan tidak valid", code: "SERVICE_TOKEN_INVALID" });
  }
  next();
}

internal.use(internalLimiter, requireHubService);

internal.post("/exchange", async (req, res) => {
  try {
    const result = await exchangeHandoff({ code: req.body?.code, ip: clientIp(req) });
    if (result.ok) return res.json(result.identity);
    if (result.kind === "denied") {
      return res.status(403).json({ error: "Akses tidak diizinkan", code: "ACCESS_DENIED" });
    }
    // Tak dikenal / terpakai / kedaluwarsa / dicabut / cacat: SATU jawaban (bedanya ada di audit).
    return res.status(401).json({ error: "Kode tidak valid", code: "INVALID_CODE" });
  } catch (err) {
    console.error("[hubSso] exchange gagal:", err.message);
    res.status(500).json({ error: "Gagal menukar kode" });
  }
});

internal.post("/introspect", async (req, res) => {
  try {
    const sub = req.body?.sub;
    if (typeof sub !== "string" || !sub || sub.length > 64) {
      return res.status(400).json({ error: "sub wajib diisi", code: "SUB_REQUIRED" });
    }
    res.json(await introspectUser({ sub, ip: clientIp(req) }));
  } catch (err) {
    console.error("[hubSso] introspect gagal:", err.message);
    res.status(500).json({ error: "Gagal memeriksa pengguna" });
  }
});

internal.post("/revoke", async (req, res) => {
  try {
    const { userId, reason } = req.body || {};
    if (typeof userId !== "string" || !userId || userId.length > 64) {
      return res.status(400).json({ error: "userId wajib diisi", code: "USER_ID_REQUIRED" });
    }
    res.json(await revokeHandoffs({ userId, reason, ip: clientIp(req) }));
  } catch (err) {
    console.error("[hubSso] revoke gagal:", err.message);
    res.status(500).json({ error: "Gagal mencabut kode" });
  }
});

hubSsoRouter.use("/internal", internal);
