// Side-effect: arahkan folder bukti tahap produksi V2 (P8) ke folder sementara SEBELUM src/lib/productionEvidenceStore.js dievaluasi
// (PRODUCTION_EVIDENCE_DIR dibaca saat impor). Import SETELAH env.js dan SEBELUM testApp.js.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TMP_EVIDENCE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "km-evidence-"));
process.env.PRODUCTION_EVIDENCE_DIR = TMP_EVIDENCE_DIR;
