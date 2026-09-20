// Side-effect: arahkan folder bukti pembayaran ke folder sementara SEBELUM routes/financeMedia.js dievaluasi
// (PAYMENT_PROOFS_DIR dibaca saat impor). Import SETELAH env.js dan SEBELUM testApp.js.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TMP_PROOFS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "km-proofs-"));
process.env.PAYMENT_PROOFS_DIR = TMP_PROOFS_DIR;
