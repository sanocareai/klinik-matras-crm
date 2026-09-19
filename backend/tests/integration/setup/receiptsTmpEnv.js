// Side-effect: arahkan penyimpanan foto nota ke folder sementara SEBELUM
// services/finance/receipts.js dievaluasi (RECEIPTS_DIR dibaca saat impor).
// Import file ini SETELAH env.js dan SEBELUM testApp.js.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TMP_RECEIPTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "km-receipts-"));
process.env.FINANCE_RECEIPTS_DIR = TMP_RECEIPTS_DIR;
