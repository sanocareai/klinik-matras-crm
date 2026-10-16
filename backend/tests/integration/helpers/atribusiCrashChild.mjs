// PROSES ANAK untuk uji crash atribusi: menjalankan webhookRouter ASLI (kode produksi) di Express, di database tes sekali-pakai milik induk.
// Titik kematian diatur induk lewat env CRASH_AT:
//   "stmt:N"       → SIGKILL tepat SESUDAH statement ke-N di dalam transaksi pesan (model call atau raw SQL, termasuk SAVEPOINT) selesai dieksekusi
//   "after-commit" → SIGKILL tepat sesudah transaksi pesan ter-COMMIT
//   ""             → tidak mati (proses "dihidupkan kembali")
// SIGKILL = mati mendadak tanpa handler (tidak ada finally/cleanup), sama seperti OOM-kill atau kehilangan daya.
// Catatan: handler webhook membalas 200 SEBELUM memproses (res.sendStatus di awal), jadi induk tidak melihat kegagalan HTTP.
import fs from "node:fs";

process.env.WAHA_BASE_URL = "http://127.0.0.1:9";
await import("../setup/env.js");
const { default: express } = await import("express");
const { prisma } = await import("../../../src/db.js");
const { webhookRouter } = await import("../../../src/routes/webhooks.js");
const { _getTouchStats } = await import("../../../src/services/attribution/touchCapture.js");

const CRASH_AT = process.env.CRASH_AT || "";
const mati = () => {
  fs.writeSync(1, `CRASH_POINT ${CRASH_AT}\n`);          // penanda eksplisit: di Windows SIGKILL tidak mengisi `signal` pada exit
  process.kill(process.pid, "SIGKILL");
};
const RAW = new Set(["$executeRawUnsafe", "$executeRaw", "$queryRaw", "$queryRawUnsafe"]);

if (CRASH_AT) {
  const asli = prisma.$transaction.bind(prisma);
  prisma.$transaction = (fn, opts) => {
    if (typeof fn !== "function") return asli(fn, opts);
    return asli(async (tx) => {
      let n = 0;
      const sesudah = () => { n++; if (CRASH_AT === `stmt:${n}`) mati(); };
      const bungkus = (target, nama) => async (...args) => { const hasil = await target[nama](...args); sesudah(); return hasil; };
      const proksi = new Proxy(tx, {
        get(t, prop) {
          const v = t[prop];
          if (typeof prop === "string" && RAW.has(prop)) return bungkus(t, prop);
          if (v && typeof v === "object" && typeof prop === "string" && !prop.startsWith("$")) {
            return new Proxy(v, { get(m, op) { return typeof m[op] === "function" ? bungkus(m, op) : m[op]; } });
          }
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
      return fn(proksi);
    }, opts).then((hasil) => { if (CRASH_AT === "after-commit") mati(); return hasil; });
  };
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use("/api/webhooks", webhookRouter);
app.get("/_stats", (_req, res) => res.json(_getTouchStats()));
const server = app.listen(0, "127.0.0.1", () => console.log(`PORT ${server.address().port}`));
process.on("SIGTERM", async () => { server.close(); await prisma.$disconnect().catch(() => {}); process.exit(0); });
