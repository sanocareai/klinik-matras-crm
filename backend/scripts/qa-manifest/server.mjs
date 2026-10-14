// Server QA lokal: router ASLI (auth, armada, delivery V2, delivery-control) tanpa cron/WAHA/Socket.IO.
// DATABASE_URL diambil dari QA_DATABASE_URL (WAJIB km_qa_*_test). DELIVERY_UNIT_CONFIRM_REQUIRED diteruskan dari env (default MATI).
//   QA_DATABASE_URL=postgresql://klinik:klinik123@localhost:5432/km_qa_manifest_test PORT=4100 node scripts/qa-manifest/server.mjs
import { assertQaDb } from "./lib.mjs";
const url = process.env.QA_DATABASE_URL;
if (!url) throw new Error("QA_DATABASE_URL wajib diisi.");
assertQaDb(url);
process.env.TEST_DATABASE_URL = url; // dibaca tests/integration/setup/env.js (pagar tambahan: nama harus mengandung "test")
const { buildTestApp } = await import("../../tests/integration/setup/testApp.js");
const port = Number(process.env.PORT || 4100);
const app = buildTestApp();
const { createServer } = await import("node:http");
const srv = createServer(app).listen(port, "0.0.0.0", () => {
  console.log(`[qa-manifest] server QA siap di :${port} (gerbang muat: ${process.env.DELIVERY_UNIT_CONFIRM_REQUIRED || "MATI"})`);
});
process.on("SIGINT", () => srv.close(() => process.exit(0)));
