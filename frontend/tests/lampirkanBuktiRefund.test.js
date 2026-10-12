// "Lampirkan Bukti" pada refund (tanpa koreksi): logika murni + pemasangan layar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KALIMAT_LAMPIR, kesiapanLampir, bodyLampirBukti, bisaLampirBukti } from "../src/features/finance/refundKoreksiLogic.js";
import { aksiRefund, ALASAN_ADMIN } from "../src/features/finance/matriksAksi.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");
const cari = (d, key) => d.find((x) => x.key === key);

test("logika murni: butuh ≥1 bukti, alasan ≥5 karakter, tak ada unggahan berjalan, total ≤10; body hanya alasan + id bukti", () => {
  assert.equal(kesiapanLampir({ jumlahSudah: 0, jumlahBaru: 1, alasan: "bukti menyusul" }).siap, true);
  assert.match(kesiapanLampir({ jumlahSudah: 0, jumlahBaru: 0, alasan: "bukti menyusul" }).pesan, /minimal satu bukti/);
  assert.match(kesiapanLampir({ jumlahSudah: 0, jumlahBaru: 1, alasan: "abc" }).pesan, /minimal 5 karakter/);
  assert.match(kesiapanLampir({ jumlahSudah: 0, jumlahBaru: 1, alasan: "   ab  " }).pesan, /minimal 5 karakter/, "spasi tidak dihitung");
  assert.equal(kesiapanLampir({ jumlahSudah: 0, jumlahBaru: 1, alasan: "bukti menyusul", sedangUnggah: true }).siap, false);
  assert.equal(kesiapanLampir({ jumlahSudah: 8, jumlahBaru: 3, alasan: "bukti menyusul" }).siap, false);
  assert.equal(kesiapanLampir({ jumlahSudah: 7, jumlahBaru: 3, alasan: "bukti menyusul" }).siap, true);
  assert.deepEqual(bodyLampirBukti({ alasan: "  bukti menyusul  ", ids: ["u1", "u2"] }), { reason: "bukti menyusul", bukti: { ids: ["u1", "u2"] } });
  assert.deepEqual(Object.keys(bodyLampirBukti({ alasan: "x", ids: [] })).sort(), ["bukti", "reason"], "tidak ada kolom keuangan di body");
  assert.equal(KALIMAT_LAMPIR, "Tindakan ini hanya melampirkan bukti. Tidak mengubah jurnal atau saldo.");
  assert.equal(bisaLampirBukti({ status: "DISETUJUI" }), true);
  assert.equal(bisaLampirBukti({ status: "DIBATALKAN", replacedBy: { refundNumber: "RFD-2" } }), true);
  for (const s of ["MENUNGGU_APPROVAL", "DITOLAK"]) assert.equal(bisaLampirBukti({ status: s }), false, s);
  assert.equal(bisaLampirBukti({ status: "DIBATALKAN" }), false, "dibatalkan tanpa pengganti");
});

test("menu aksi refund: Lampirkan Bukti aktif untuk Admin (disetujui & versi lama yang sudah dikoreksi); nonaktif beralasan untuk non-admin; tidak ada di draf/ditolak/dibatalkan tanpa pengganti", () => {
  const admin = { admin: true }; const bukanAdmin = { admin: false };
  let d = aksiRefund({ status: "DISETUJUI" }, admin);
  assert.equal(cari(d, "lampirkan").label, "Lampirkan Bukti"); assert.ok(cari(d, "lampirkan").aktif); assert.match(cari(d, "lampirkan").hint, /Jurnal, saldo, dan nominal tidak berubah/);
  assert.ok(cari(d, "koreksi").aktif, "koreksi tetap ada");
  d = aksiRefund({ status: "DISETUJUI" }, bukanAdmin);
  assert.ok(!cari(d, "lampirkan").aktif); assert.equal(cari(d, "lampirkan").alasan, ALASAN_ADMIN);
  d = aksiRefund({ status: "DISETUJUI", koreksi: { aktif: false, alasan: "Jurnal refund ini sudah dicocokkan.", arah: "Lepas dulu." } }, admin);
  assert.ok(cari(d, "lampirkan").aktif, "melampirkan bukti tidak menyentuh jurnal, jadi tidak ikut terkunci oleh rekonsiliasi");
  d = aksiRefund({ status: "DIBATALKAN", replacedBy: { refundNumber: "RFD-2" } }, admin);
  assert.ok(cari(d, "lampirkan").aktif); assert.match(cari(d, "lampirkan").hint, /sudah digantikan RFD-2/);
  for (const st of ["MENUNGGU_APPROVAL", "DITOLAK"]) assert.equal(cari(aksiRefund({ status: st }, admin), "lampirkan"), undefined, st);
  assert.equal(cari(aksiRefund({ status: "DIBATALKAN" }, admin), "lampirkan"), undefined, "dibatalkan tanpa pengganti");
});

test("pemasangan: api, dialog (kalimat konfirmasi, dampak Rp0, alasan, Idempotency-Key), menu + detail + riwayat; dialog tidak punya kolom keuangan & tidak memakai alur koreksi", () => {
  const api = baca("../src/api.js");
  assert.match(api, /lampirkanBuktiRefund: \(id, data, idempotencyKey = null\)/); assert.match(api, /\/finance\/refunds\/\$\{id\}\/lampirkan-bukti/);
  const dlg = baca("../src/features/finance/LampirkanBuktiDialog.jsx");
  for (const t of ["Lampirkan Bukti", "Rp0 — jurnal & saldo tidak berubah", "Total keluar rekening", "Biaya admin bank", "Bukti yang sudah terlampir", "Bukti yang sudah terlampir tidak bisa diganti atau dihapus", "Alasan"]) assert.ok(dlg.includes(t), t);
  assert.match(dlg, /\{KALIMAT_LAMPIR\}/); assert.match(dlg, /api\.lampirkanBuktiRefund\(refund\.id, body, kunciRef\.current\.kunci\)/); assert.match(dlg, /onPaste=\{saatPaste\}/); assert.match(dlg, /<AreaUnggahBukti/);
  assert.doesNotMatch(dlg, /koreksiFinanceDoc|PratinjauKoreksi|InputUang|DatePicker|CaraBayarTransfer/);
  assert.doesNotMatch(dlg, /\b(Upload failed|Loading|Retry|Cancel|Save)\b/);
  const hal = baca("../src/pages/finance/FinanceReceivables.jsx");
  assert.match(hal, /<LampirkanBuktiDialog\s+refund=\{lampirUntuk\}/); assert.match(hal, /lampirkan: \(\) => setLampirUntuk\(r\)/); assert.match(hal, /lampirkan-dari-detail/); assert.match(hal, /onLampirBukti=/);
  const riw = baca("../src/features/finance/KoreksiAman.jsx");
  assert.match(riw, /lampirkan-dari-riwayat/); assert.match(riw, /Bukti dilampirkan/);
});
