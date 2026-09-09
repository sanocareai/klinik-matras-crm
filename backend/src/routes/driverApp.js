// ═══ APK DRIVER — OTA self-hosted (@capgo/capacitor-updater) ══════════════
// 9 September 2026, jawaban langsung atas pertanyaan owner: "kenapa gabuat
// flow OTA kayak Sano Messenger (EAS + expo-updates)?" — Sano Messenger
// React Native asli, expo-updates memang dibuat utk itu. Driver app SENGAJA
// WebView Capacitor (reuse DriverJobs.jsx yang sudah lengkap — offline
// queue/kompresi foto/GPS/push, lihat plan driver app) — expo-updates tidak
// berlaku utk arsitektur ini. @capgo/capacitor-updater (MIT, open source,
// self-hosted, TANPA langganan Ionic Appflow) adalah versi Capacitor dari
// mekanisme yang sama: cek server utk bundle web baru, unduh, pasang, TANPA
// resideload APK. Endpoint di sini yang jadi "server sendiri" itu.
//
// KONTRAK diverifikasi LANGSUNG dari source plugin (BUKAN ditebak dari
// docs — WebFetch ke docs Capgo di sesi ini balik dengan info tidak
// presisi): driver-app/node_modules/@capgo/capacitor-updater/android/src/
// main/java/ee/forgr/capacitor_updater/CapgoUpdater.java baris ~1994-2010
// (body request native) dan .../dist/esm/definitions.d.ts (LatestVersion,
// UpdateResponseKind = 'up_to_date'|'blocked'|'failed'). Plugin native
// POST JSON, field yang DIPAKAI di sini cuma version_name (versi bundle
// yang SEDANG aktif di device) & defaultChannel (opsional) — field lain
// (device_id/platform/dst) DITERIMA tapi TIDAK disimpan/dipakai, app
// operasional kecil ini tidak butuh analytics per-device (prinsip "hemat,
// mudah dimaintain 1 orang").
//
// TANPA requireAuth SENGAJA — plugin cek update SAAT COLD START, SEBELUM
// user sempat login (sama seperti update-check Play Store/App Store).
// Tidak ada data sensitif yang terekspos, cuma "versi terbaru channel X".
import express from "express";
import { prisma } from "../db.js";

export const driverAppRouter = express.Router();

driverAppRouter.post("/update-check", async (req, res) => {
  try {
    const currentVersion = String(req.body?.version_name ?? "");
    const channel = req.body?.defaultChannel?.trim() || "production";

    const latest = await prisma.driverAppBundle.findFirst({
      where: { channel, active: true },
      orderBy: { buildNumber: "desc" },
    });

    // Belum pernah ada bundle dipublikasi utk channel ini — device tetap
    // pegang "builtin" (version: "0" di capacitor.config.json), tidak ada
    // yang bisa ditawarkan. Balikan SAMA dengan "sudah versi terbaru" —
    // dari sudut pandang device, dua kondisi ini sama-sama "tidak perlu
    // update sekarang".
    if (!latest || String(latest.buildNumber) === currentVersion) {
      return res.json({
        message: "No new version available",
        error: "no_new_version_available",
        kind: "up_to_date",
      });
    }

    res.json({
      version: String(latest.buildNumber),
      url: `https://app.sanomatrassehat.com/media/driver-app-bundles/${latest.zipFilename}`,
      checksum: latest.checksum,
    });
  } catch (err) {
    console.error("[driver-app] update-check error:", err);
    res.status(500).json({ error: "internal_error", kind: "failed", message: "Gagal cek update" });
  }
});
