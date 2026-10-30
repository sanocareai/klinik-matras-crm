// QA Marketing di atas SALINAN backup produksi yang dipulihkan ke database lokal terisolasi (nama wajib mengandung "test"). TIDAK menulis produksi; TIDAK mengisi/menghapus data customer/order/pembayaran.
//   TEST_DATABASE_URL=postgresql://klinik:...@localhost:5432/km_prodcopy_20261030_test PORT=4021 OUT=C:/tmp/km-mkt-prodcopy node frontend/qa-harness/marketing-prodcopy-server.mjs
// Satu-satunya penulisan: dua baris user QA (ADMIN dan SALES) di salinan lokal, untuk membuat token. Data pelanggan nyata di salinan TIDAK dicetak ke log.
process.env.JWT_SECRET ||= "qa-marketing-jwt-secret";
import "../../backend/tests/integration/setup/env.js";
import fs from "node:fs"; import path from "node:path";
import { testPrisma } from "../../backend/tests/integration/setup/testDb.js";
import { createTestUser } from "../../backend/tests/integration/setup/fixtures.js";
import { buildTestApp } from "../../backend/tests/integration/setup/testApp.js";
const { attributionAdsRouter } = await import("../../backend/src/routes/attributionAds.js");

const PORT = Number(process.env.PORT || 4021); const OUT = process.env.OUT || "C:/tmp/km-mkt-prodcopy";
fs.mkdirSync(OUT, { recursive: true });
const T = {};
for (const [k, roles, nama] of [["admin", ["ADMIN"], "Admin QA Salinan"], ["sales", ["SALES"], "Sales QA Salinan"]]) {
  const { user, token } = await createTestUser({ roles });
  await testPrisma.user.update({ where: { id: user.id }, data: { name: nama } });
  T[k] = { token, user: { id: user.id, name: nama, email: user.email, role: roles[0], roles } };
}
fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(T, null, 2));
const app = buildTestApp();
app.use("/api/atribusi/iklan", attributionAdsRouter);
app.get("/api/health", (req, res) => res.json({ ok: true, salinanProduksi: true }));
app.listen(PORT, "127.0.0.1", () => console.log(`[qa-marketing-salinan] server siap di http://127.0.0.1:${PORT} — DB ${process.env.TEST_DATABASE_URL.split("/").pop()} (SALINAN backup produksi)`));
