// Side-effect: arahkan folder bukti transfer refund ke folder sementara SEBELUM services/finance/refundBukti.js dievaluasi (REFUND_BUKTI_DIR dibaca saat impor).
// Import SETELAH env.js dan SEBELUM testApp.js.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TMP_REFUND_BUKTI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "km-refund-bukti-"));
process.env.REFUND_BUKTI_DIR = TMP_REFUND_BUKTI_DIR;
process.on("exit", () => { try { fs.rmSync(TMP_REFUND_BUKTI_DIR, { recursive: true, force: true }); } catch { /* sudah hilang */ } });
