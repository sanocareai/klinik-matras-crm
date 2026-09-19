// Job malam: kompres video chat yang sudah berumur >24 jam (lihat videoCompress.js untuk
// aturan & risikonya). Jalan jam 01:00 WIB — sepi traffic — dengan batas waktu 4 jam per malam
// supaya tidak merembet ke pagi. Backlog lama yang belum habis dilanjutkan malam berikutnya
// (progres tersimpan di uploads/.video-compress-state.json).
import cron from "node-cron";
import path from "path";
import { fileURLToPath } from "url";
import { compressUploadsBatch } from "./videoCompress.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "../../uploads");

export function startVideoCompressJob() {
  if (process.env.VIDEO_COMPRESS_JOB === "off") {
    console.log("[videoCompress] Job dimatikan lewat VIDEO_COMPRESS_JOB=off");
    return;
  }
  cron.schedule("0 1 * * *", async () => {
    console.log("[videoCompress] Cron fired — 01:00 WIB");
    try {
      const r = await compressUploadsBatch(uploadsDir, { apply: true, minAgeHours: 24, budgetMinutes: 240 });
      console.log("[videoCompress] Selesai:", JSON.stringify({
        ...r, hematMB: Math.round((r.bytesBefore - r.bytesAfter) / 1048576),
      }));
    } catch (err) {
      console.error("[videoCompress] Job gagal:", err.message);
    }
  }, { timezone: "Asia/Jakarta" });
  console.log("[videoCompress] Job terdaftar — jalan setiap 01:00 WIB (maks 4 jam)");
}
