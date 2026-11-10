// Pembantu UJI untuk suite lama (sebelum aturan ADMIN Nov 2026): pencatatan pemakaian oleh non-ADMIN kini menghasilkan PENGAJUAN (202). Suite lama menguji PERILAKU JALUR TULIS
// (saldo, satuan, pengecualian stok, HPP, jurnal, pengaman SO) — jalur yang SAMA dijalankan saat ADMIN lain memverifikasi. Pembungkus ini meneruskan permintaan, dan bila jawabannya
// pengajuan, langsung memverifikasinya lewat ADMIN uji lain lalu mengembalikan hasil jalur tulis dengan bentuk lama (201 + pergerakan, 200 + hasil V2, dst.).
// Semantik pengajuan sendiri (tertunda, ditahan, ditolak, konkurensi) diuji di pengajuanPemakaianProduksi.integration.test.js dan productionBuildTrack.integration.test.js.
import jwt from "jsonwebtoken";
import { testPrisma } from "./testDb.js";
import { makeClient } from "./httpClient.js";

const VERIFIKATOR_EMAIL = "verifikator-otomatis-uji@example.test";
async function tokenVerifikator() {
  let u = await testPrisma.user.findUnique({ where: { email: VERIFIKATOR_EMAIL } });
  if (!u) u = await testPrisma.user.create({ data: { name: "Verifikator ADMIN uji", email: VERIFIKATOR_EMAIL, passwordHash: "x", role: "ADMIN" } });
  return jwt.sign({ id: u.id, name: u.name, role: "ADMIN", roles: ["ADMIN"] }, process.env.JWT_SECRET, { expiresIn: "1h" });
}
const json = (x) => JSON.parse(JSON.stringify(x));

async function jadikanLangsung(baseUrl, r) {
  if (!(r.status === 202 || r.status === 200) || !r.body?.menungguVerifikasi || !r.body?.pengajuan?.id) return r;
  const p = r.body.pengajuan;
  const admin = makeClient(baseUrl, await tokenVerifikator());
  const v = await admin.post("/api/production/pengajuan-pemakaian/verifikasi", { item: [{ id: p.id, ...(p.hargaAmbigu ? { konfirmasiHarga: "verifikasi otomatis uji" } : {}) }] });
  const h = v.body?.hasil?.[0];
  if (!h || h.status !== "DISETUJUI") {
    const b = h?.beda?.[0];
    return { status: 409, body: { error: b?.pesan ?? h?.pesan ?? "pengajuan tidak disahkan", code: b?.kode ?? h?.kode ?? b?.jenis ?? "PENGAJUAN_DITAHAN", pengajuan: h }, headers: r.headers };
  }
  const ulang = r.body.ulang || h.ulang;
  if (p.jalur === "UNIT_BAHAN") {
    const mv = h.hasil?.pergerakanId ? await testPrisma.stockMovement.findUnique({ where: { id: h.hasil.pergerakanId } }) : null;
    const headers = new Headers(r.headers); if (ulang) headers.set("Idempotent-Replay", "true");
    return { status: ulang ? 200 : 201, body: json(mv), headers };
  }
  if (p.jalur === "PERUBAHAN") return { status: ulang || h.hasil?.ulang ? 200 : 201, body: json(h.hasil), headers: r.headers };
  return { status: 200, body: json(h.hasil), headers: r.headers }; // RUN_V2
}

/** Bungkus klien uji: POST pencatatan pemakaian yang menjadi pengajuan langsung diverifikasi ADMIN uji lain. */
export function denganVerifikasiOtomatis(client, baseUrl) {
  return { ...client, post: async (path, body, headers) => jadikanLangsung(baseUrl, await client.post(path, body, headers)) };
}
