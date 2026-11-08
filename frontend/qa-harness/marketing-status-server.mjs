// Backend ASLI tanpa seed, di atas DB uji yang sudah diisi marketing-server.mjs: untuk menguji keadaan konfigurasi/flag lewat env berbeda. Nilai env hanya tiruan.
process.env.JWT_SECRET ||= "qa-marketing-jwt-secret";
import "../../backend/tests/integration/setup/env.js";
import { buildTestApp } from "../../backend/tests/integration/setup/testApp.js";
const { attributionAdsRouter } = await import("../../backend/src/routes/attributionAds.js");
const app = buildTestApp();
app.use("/api/atribusi/iklan", attributionAdsRouter);
app.listen(Number(process.env.PORT), "127.0.0.1", () => console.log("siap"));
