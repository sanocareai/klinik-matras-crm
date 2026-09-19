// Kompres video chat di disk server (hemat storage — uploads/ mencapai 29 GB,
// ±68% di antaranya video mp4/mov).
//
// PRINSIP: kompres DI TEMPAT, nama file TIDAK berubah. Pesan menyimpan
// mediaUrl "/uploads/<nama>.mp4" — kalau nama berubah, seluruh referensi di DB
// harus ikut dimigrasi (dan link yang sudah pernah dibagikan patah). Jadi hasil
// kompresi ditulis ke file sementara lalu rename() atomik menimpa file asli;
// pembaca yang sedang mengunduh file lama tetap aman (Linux).
//
// ⚠️ TIDAK BISA DIBATALKAN: file asli ditimpa. Kualitas video turun. Karena itu:
//  - file hasil WAJIB lolos validasi (durasi sama, benar-benar lebih kecil),
//    kalau tidak file asli dibiarkan utuh;
//  - hanya file lebih tua dari `minAgeHours` (default 24 jam) — supaya video
//    yang baru masuk tidak berebut dengan forward/kirim ulang/generate poster;
//  - hasil tiap file dicatat di uploads/.video-compress-state.json sehingga
//    tidak pernah diproses dua kali (termasuk yang "tidak cukup hemat").
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const TAG = "SANO-COMPRESSED-v1";
const EXT_FORMAT = { ".mp4": "mp4", ".mov": "mov" };
const MIN_SIZE_BYTES_DEFAULT = 1.5 * 1024 * 1024; // di bawah ini tidak sepadan dengan CPU-nya
const MAX_RATIO = 0.85;                            // hasil harus ≥15% lebih kecil, kalau tidak dibuang
const ENCODE_TIMEOUT_MS = 15 * 60 * 1000;

export function stateFilePath(uploadsDir) {
  return path.join(uploadsDir, ".video-compress-state.json");
}

export function loadState(uploadsDir) {
  try {
    return JSON.parse(fs.readFileSync(stateFilePath(uploadsDir), "utf8"));
  } catch {
    return { done: {}, skipped: {} };
  }
}

export function saveState(uploadsDir, state) {
  const tmp = stateFilePath(uploadsDir) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, stateFilePath(uploadsDir));
}

async function probe(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ], { timeout: 30000 });
  const j = JSON.parse(stdout);
  const v = (j.streams || []).find((s) => s.codec_type === "video");
  return {
    hasVideo: !!v,
    width: v?.width || 0,
    height: v?.height || 0,
    duration: parseFloat(j.format?.duration) || 0,
    tagged: String(j.format?.tags?.comment || "").includes(TAG),
  };
}

/**
 * Kompres SATU file. Return { status, before, after? , reason? }.
 * status: "compressed" | "skipped" | "failed" | "dry-run"
 */
export async function compressVideoInPlace(absPath, { apply = false, minSizeBytes = MIN_SIZE_BYTES_DEFAULT } = {}) {
  const ext = path.extname(absPath).toLowerCase();
  const fmt = EXT_FORMAT[ext];
  if (!fmt) return { status: "skipped", reason: "ekstensi_tidak_didukung" };

  const before = fs.statSync(absPath).size;
  if (before < minSizeBytes) return { status: "skipped", reason: "terlalu_kecil", before };

  let info;
  try {
    info = await probe(absPath);
  } catch {
    return { status: "failed", reason: "ffprobe_gagal", before };
  }
  if (!info.hasVideo) return { status: "skipped", reason: "bukan_video", before };
  if (info.tagged) return { status: "skipped", reason: "sudah_dikompres", before };
  if (!apply) return { status: "dry-run", before };

  const tmp = `${absPath}.compress-tmp`;
  const args = [
    "-y", "-nostdin", "-v", "error", "-i", absPath,
    "-map", "0:v:0", "-map", "0:a:0?",
    // Sisi terpanjang maksimal 1280px, tidak pernah diperbesar, rasio tetap.
    "-vf", "scale=w=min(iw\\,1280):h=min(ih\\,1280):force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-maxrate", "1500k", "-bufsize", "3000k",
    "-pix_fmt", "yuv420p", "-threads", "1",
    "-c:a", "aac", "-b:a", "64k", "-ac", "2",
    "-movflags", "+faststart", "-map_metadata", "-1", "-metadata", `comment=${TAG}`,
    "-f", fmt, tmp,
  ];
  try {
    // nice 19: server 2-core ini juga menjalankan aplikasi, kompresi tidak boleh
    // menyaingi request user.
    await execFileAsync("nice", ["-n", "19", "ffmpeg", ...args], { timeout: ENCODE_TIMEOUT_MS });

    const out = await probe(tmp);
    const after = fs.statSync(tmp).size;
    if (!out.hasVideo) throw new Error("hasil tanpa stream video");
    if (info.duration > 0 && Math.abs(out.duration - info.duration) > Math.max(1, info.duration * 0.03)) {
      throw new Error(`durasi berbeda (${info.duration.toFixed(1)}s → ${out.duration.toFixed(1)}s)`);
    }
    if (after > before * MAX_RATIO) {
      fs.rmSync(tmp, { force: true });
      return { status: "skipped", reason: "tidak_cukup_hemat", before, after };
    }
    fs.renameSync(tmp, absPath); // atomik
    return { status: "compressed", before, after };
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    return { status: "failed", reason: String(err.message || err).slice(0, 200), before };
  }
}

/**
 * Proses banyak file di uploadsDir. Terbesar dulu (hemat terbanyak per menit CPU).
 * opts: apply, limit, minAgeHours, minSizeMb, maxSizeMb, budgetMinutes, log
 */
export async function compressUploadsBatch(uploadsDir, opts = {}) {
  const {
    apply = false, limit = Infinity, minAgeHours = 24, minSizeMb = 1.5, maxSizeMb = Infinity,
    budgetMinutes = Infinity, log = () => {},
  } = opts;
  const state = loadState(uploadsDir);
  const cutoff = Date.now() - minAgeHours * 3600 * 1000;
  const minSizeBytes = minSizeMb * 1024 * 1024;

  const kandidat = fs.readdirSync(uploadsDir)
    .filter((n) => EXT_FORMAT[path.extname(n).toLowerCase()] && !state.done[n] && !state.skipped[n])
    .map((n) => {
      const st = fs.statSync(path.join(uploadsDir, n));
      return { n, size: st.size, mtime: st.mtimeMs };
    })
    .filter((f) => f.size >= minSizeBytes && f.size <= maxSizeMb * 1024 * 1024 && f.mtime < cutoff)
    .sort((a, b) => b.size - a.size);

  const ringkas = { kandidat: kandidat.length, compressed: 0, skipped: 0, failed: 0, dryRun: 0, bytesBefore: 0, bytesAfter: 0 };
  const mulai = Date.now();

  for (const f of kandidat) {
    if (ringkas.compressed + ringkas.skipped + ringkas.failed + ringkas.dryRun >= limit) break;
    if ((Date.now() - mulai) / 60000 > budgetMinutes) { log(`Anggaran waktu ${budgetMinutes} menit habis, berhenti.`); break; }

    const r = await compressVideoInPlace(path.join(uploadsDir, f.n), { apply, minSizeBytes });
    if (r.status === "compressed") {
      ringkas.compressed++; ringkas.bytesBefore += r.before; ringkas.bytesAfter += r.after;
      state.done[f.n] = { before: r.before, after: r.after, at: new Date().toISOString() };
      log(`OK   ${f.n}  ${(r.before / 1048576).toFixed(1)}MB → ${(r.after / 1048576).toFixed(1)}MB`);
    } else if (r.status === "skipped") {
      ringkas.skipped++;
      if (apply) state.skipped[f.n] = r.reason;
      log(`SKIP ${f.n}  ${r.reason}`);
    } else if (r.status === "failed") {
      ringkas.failed++; // TIDAK dicatat ke state: boleh dicoba lagi (mungkin gagal sementara)
      log(`GAGAL ${f.n}  ${r.reason}`);
    } else {
      ringkas.dryRun++;
      log(`(dry-run) ${f.n}  ${(r.before / 1048576).toFixed(1)}MB`);
    }
    if (apply && (ringkas.compressed + ringkas.skipped) % 10 === 0) saveState(uploadsDir, state);
  }
  if (apply) saveState(uploadsDir, state);
  return ringkas;
}
