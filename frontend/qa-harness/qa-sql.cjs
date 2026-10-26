// Pembantu QA: jalankan SATU kueri SQL ke database QA terisolasi lewat TCP (tanpa docker CLI) dan cetak nilai kolom pertama baris pertama.
//   QA_DB_URL=postgresql://klinik:klinik123@localhost:55442/km_koreksi_saldo_qa_test node qa-sql.cjs "select count(*) from stock_adjustment_requests"
// Pagar: nama database wajib mengandung "test".
const url = process.env.QA_DB_URL || "postgresql://klinik:klinik123@localhost:55442/km_koreksi_saldo_qa_test";
if (!/\/[^/?]*test[^/?]*(\?|$)/i.test(url)) { console.error("Menolak: nama database QA harus mengandung 'test'"); process.exit(2); }
const { PrismaClient } = require("../../backend/node_modules/@prisma/client");
const p = new PrismaClient({ datasources: { db: { url } } });
const q = process.argv[2];
const jam = setTimeout(() => { console.error("timeout 20 dtk"); process.exit(3); }, 20000);
(async () => {
  try {
    if (/^\s*(select|with)\b/i.test(q)) { const r = await p.$queryRawUnsafe(q); const b = r[0]; if (b) { const v = Object.values(b)[0]; console.log(v === null || v === undefined ? "" : String(v)); } }
    else { await p.$executeRawUnsafe(q); }
  } catch (e) { console.error(String(e).slice(0, 400)); process.exit(1); } finally { clearTimeout(jam); await p.$disconnect(); }
})();
