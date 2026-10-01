// Side-effect: arahkan folder berkas Klaim Lunas ke folder sementara SEBELUM services/finance/klaimLunasBerkas.js dievaluasi (KLAIM_DIR dibaca saat impor).
// Import SETELAH env.js dan SEBELUM testApp.js. (Menulis process.env di tubuh file tes TIDAK cukup: import statis di-hoist.)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TMP_KLAIM_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "km-klaim-"));
process.env.KLAIM_LUNAS_DIR = TMP_KLAIM_DIR;
