// Training & Operational Readiness (P12B) — skenario latihan + kredensial sekali-tampil untuk STAGING QA-PV2.
// Library ini TIDAK membaca env sendiri: pemanggil (CLI qa-pv2.js) wajib sudah lolos assertQaPv2Safe() (hanya APP_ENV=staging|test + DB bertanda staging).
// Perubahan produksi tetap lewat endpoint command ASLI (ensureUnit/advance milik seeder P12A) — tidak ada SQL tulis langsung kecuali master data.
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PREFIX, qaCode } from "./qaPv2Safety.js";
import { accountEmail, ensureUnit } from "./qaPv2Seed.js";

// Peran peserta → kunci akun staging (ACCOUNTS di qaPv2Seed.js). Hanya akun QA-PV2 (@staging.invalid), BUKAN user production.
export const TRAINING_ROLES = Object.freeze([
  { key: "owner", peran: "Owner", modul: "Admin/Production Lead" },
  { key: "admin", peran: "Admin", modul: "Admin/Production Lead" },
  { key: "lead", peran: "Production Lead", modul: "Admin/Production Lead" },
  { key: "meja1", peran: "Operator Meja 1", modul: "Operator Meja" },
  { key: "meja2", peran: "Operator Meja 2", modul: "Operator Meja" },
  { key: "meja3", peran: "Operator Meja 3", modul: "Operator Meja" },
  { key: "meja4", peran: "Operator Meja 4", modul: "Operator Meja" },
  { key: "corner1", peran: "PIC Corner 1", modul: "PIC Corner" },
  { key: "corner2", peran: "PIC Corner 2", modul: "PIC Corner" },
  { key: "qc", peran: "QC", modul: "QC" },
  { key: "gudang", peran: "Gudang", modul: "Gudang" },
  { key: "dokumentasi", peran: "Dokumenter", modul: "Dokumenter" },
]);

// Tujuh skenario wajib. Unit latihan = QA-PV2-U21…U29 (U01–U12 dipakai matriks demo P12A; dua dataset TIDAK dicampur: jalankan `reset --yes` lalu `training`).
// Tiap unit berhenti DI AWAL tugas peserta; sisa alur dikerjakan peserta lewat UI sesuai runbook.
export const SCENARIOS = Object.freeze([
  { id: "S1", nama: "Normal", n: 21, cust: "Latihan S1 Normal", city: "Jakarta Selatan", sales: "Rifki", svc: "Paket Upgrade Fondasi + Lapisan MS", note: "Latihan alur normal: dari pickup sampai siap kirim.", kg: 70, comp: ["PEGAL_PEGAL"], size: "160 × 200", stage: "perjalanan", photo: "pickup", prio: 0, station: null,
    mulai: "Unit dalam perjalanan (pickup selesai, belum dikonfirmasi tiba). Gudang konfirmasi tiba → Lead jadwalkan → Meja kerjakan tahap 1–9 → QC → Corner 10–12 → Gudang terima barang jadi." },
  { id: "S2", nama: "Ganti Kain", n: 22, cust: "Latihan S2 Ganti Kain", city: "Bandung", sales: "Fadlan", svc: "Ganti Kain", note: "Kain rajut abu-abu polos tanpa motif, list hitam. Wajib sama persis dengan contoh kain pilihan customer.", kg: 58, comp: [], size: "180 × 200", stage: "tiba", photo: "pickup", prio: 1, station: null,
    mulai: "Unit sudah tiba. Pastikan layanan Sales 'Ganti Kain' + catatan kain terlihat di kartu Rencana, Status, dan antrean Meja/Corner." },
  { id: "S3a", nama: "Prioritas — Normal", n: 23, cust: "Latihan S3 Prioritas Normal", city: "Depok", sales: "Ervina", svc: "Service Fondasi + Tambah Busa", note: "Prioritas Normal.", kg: 62, comp: [], size: "160 × 200", stage: "tiba", photo: "pickup", prio: 0, station: null, mulai: "Tiba, belum dijadwalkan, prioritas Normal." },
  { id: "S3b", nama: "Prioritas — Tinggi", n: 24, cust: "Latihan S3 Prioritas Tinggi", city: "Bekasi", sales: "Kiki", svc: "Service Fondasi + Tambah Busa", note: "Prioritas Tinggi.", kg: 66, comp: [], size: "160 × 200", stage: "tiba", photo: "pickup", prio: 1, station: null, mulai: "Tiba, belum dijadwalkan, prioritas Tinggi." },
  { id: "S3c", nama: "Prioritas — Mendesak", n: 25, cust: "Latihan S3 Prioritas Mendesak", city: "Bogor", sales: "Fadlan", svc: "Service Fondasi + Tambah Busa", note: "Prioritas Mendesak — pelanggan pindah rumah akhir pekan.", kg: 72, comp: [], size: "160 × 200", stage: "tiba", photo: "pickup", prio: 2, station: null,
    mulai: "Tiba, belum dijadwalkan, prioritas Mendesak. Jadwalkan ketiganya ke satu meja lalu atur urutan manual: urutan manual harus menang, peringatan inversi muncul bila Mendesak di bawah Normal." },
  { id: "S4", nama: "Bahan kurang", n: 26, cust: "Latihan S4 Bahan Kurang", city: "Tangerang", sales: "Rifki", svc: "Service Fondasi + Tambah Busa", note: "Latihan bahan kurang: pakai Busa Langka saat diagnosis.", kg: 60, comp: ["SAKIT_PINGGANG"], size: "160 × 200", stage: "diagnosa", photo: "pickup", prio: 0, station: "TABLE_1", op: 0, corner: 0, day: 0,
    mulai: "Tahap 1–4 selesai, diagnosis (tahap 5) menunggu Operator Meja 1. Pilih bahan 'Busa Langka' (stok 1) qty 4 → reservasi gagal → Gudang menambah stok → lanjut." },
  { id: "S5", nama: "QC gagal", n: 27, cust: "Latihan S5 QC Gagal", city: "Jakarta Timur", sales: "Ervina", svc: "Paket Upgrade Fondasi + Lapisan MS", note: "Latihan QC FAIL → rework → QC ulang → PASS.", kg: 85, comp: [], size: "200 × 200", stage: "menunggu_qc", photo: "pickup", prio: 0, station: "TABLE_2", op: 1, corner: 0, day: 0,
    mulai: "Menunggu QC. QC putuskan FAIL (foto wajib + alasan) → Meja rework (bahan tambahan bila perlu) → QC ulang → PASS." },
  { id: "S6", nama: "Dokumentasi offline", n: 28, cust: "Latihan S6 Dokumentasi", city: "Depok", sales: "Kiki", svc: "Paket Upgrade Fondasi + Lapisan MS", note: "Latihan foto offline: simpan draf, sambungkan kembali, terkirim sekali.", kg: 68, comp: [], size: "180 × 200", stage: "siap_kirim", photo: "pickup", prio: 0, station: "TABLE_3", op: 2, corner: 0, day: 0, docs: "kurang",
    mulai: "Produksi selesai, dokumentasi baru sebagian. Dokumenter melengkapi kategori foto saat OFFLINE lalu kembali ONLINE: terkirim tepat satu kali." },
  { id: "S7", nama: "Retur sisa", n: 29, cust: "Latihan S7 Retur Sisa", city: "Bandung", sales: "Fadlan", svc: "Service Fondasi + Tambah Busa", note: "Latihan retur sisa bahan sebelum barang jadi diterima.", kg: 77, comp: [], size: "160 × 200", stage: "menunggu_retur", photo: "pickup", prio: 0, station: "TABLE_4", op: 3, corner: 0, day: 0, docs: "kurang",
    mulai: "Tahap 12 selesai; barang jadi TERTAHAN karena retur sisa PENDING. Gudang terima retur (catatan wajib bila selisih) → barang jadi bisa diterima." },
]);

// Penanda di berkas kredensial seeder: entri TETAP ada (truthy) supaya ensureMaster() tidak merotasi ulang password yang sudah dibagikan.
export const ISSUED_MARK = "(diterbitkan sekali-tampil; tidak disimpan)";
export const SCARCE = Object.freeze({ code: "BSA-LANGKA", name: "Busa Langka (latihan bahan kurang)", unit: "SHEET", stok: 1 });

// Bahan langka untuk skenario 4: stok SENGAJA 1 (bahan lain 500). Idempoten.
export async function ensureScarceMaterial(ctx) {
  const { prisma } = ctx; const full = qaCode(SCARCE.code);
  let m = await prisma.material.findUnique({ where: { code: full } });
  if (!m) {
    m = await prisma.material.create({ data: { code: full, name: `${PREFIX} ${SCARCE.name}`, unit: SCARCE.unit, category: "RAW_MATERIAL", active: true } });
    await prisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: SCARCE.stok, note: `${PREFIX} stok awal (sengaja sedikit)` } });
  }
  return m;
}

export async function seedTraining(ctx, W) {
  await ensureScarceMaterial(ctx);
  const out = [];
  for (const spec of SCENARIOS) out.push({ skenario: spec.id, nama: spec.nama, ...(await ensureUnit(ctx, W, { ...spec, label: `${spec.id} ${spec.nama}` })) });
  return out;
}

const credsFile = (ctx) => path.resolve(ctx.dataDir, "qa-pv2-credentials.json");

/**
 * Kredensial SEKALI-TAMPIL: merotasi password akun latihan dan MENGEMBALIKANNYA ke pemanggil untuk dicetak sekali di terminal pelatih.
 * Password TIDAK ditulis ke log/berkas/repo; entri di berkas kredensial seeder diganti penanda (tidak ada sisa plaintext usang).
 * Menjalankan ulang = password lama TIDAK berlaku lagi (satu-satunya salinan ada di tangan pelatih).
 */
export async function issueCredentials(ctx, keys = null) {
  const { prisma } = ctx;
  const roles = TRAINING_ROLES.filter((r) => !keys || keys.includes(r.key));
  if (!roles.length) throw new Error("tidak ada peran yang cocok");
  let file = {}; try { file = JSON.parse(fs.readFileSync(credsFile(ctx), "utf8")); } catch { /* belum ada */ }
  const issued = [];
  for (const r of roles) {
    const email = accountEmail(r.key);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`akun ${email} belum ada — jalankan 'training' dulu`);
    const password = crypto.randomBytes(9).toString("base64url");
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 10), active: true } });
    file[email] = ISSUED_MARK;
    issued.push({ key: r.key, peran: r.peran, email, password });
  }
  if (fs.existsSync(credsFile(ctx))) fs.writeFileSync(credsFile(ctx), JSON.stringify(file, null, 2), { mode: 0o600 });
  return issued;
}
