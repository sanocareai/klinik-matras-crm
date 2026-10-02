// Side-effect: arahkan folder unggahan CHAT ke folder sementara SEBELUM services/finance/klaimDariChat.js dievaluasi (UPLOADS_DIR dibaca saat impor).
// Import SETELAH env.js dan SEBELUM testApp.js (import statis di-hoist; menulis process.env di tubuh tes tidak cukup).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TMP_CHAT_UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), "km-chat-uploads-"));
process.env.CHAT_UPLOADS_DIR = TMP_CHAT_UPLOADS;
process.on("exit", () => { try { fs.rmSync(TMP_CHAT_UPLOADS, { recursive: true, force: true }); } catch { /* sudah hilang */ } });
