// Edit Master Supplier (7 Okt 2026): logika murni + jaminan struktur layar. Perilaku server dikunci backend/tests/integration/financeSupplierEdit.integration.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formDariSupplier, payloadPerubahan, galatForm, rekeningBerubah, supplierBisaDipilih } from "../src/features/finance/supplierEditLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const halaman = fs.readFileSync(path.join(dir, "../src/pages/finance/FinanceSuppliers.jsx"), "utf8");
const SUP = { id: "s1", code: "SUP-010", name: "ASEP SUGIARTO", phone: null, email: null, address: null, paymentTermDays: null, bankName: null, bankAccount: null, bankHolder: null, notes: null, active: true };

test("formDariSupplier: null jadi string kosong; termin angka jadi string", () => {
  const f = formDariSupplier(SUP);
  assert.equal(f.name, "ASEP SUGIARTO");
  assert.equal(f.phone, "");
  assert.equal(f.paymentTermDays, "");
  assert.equal(formDariSupplier({ ...SUP, paymentTermDays: 30 }).paymentTermDays, "30");
});

test("payloadPerubahan: tanpa perubahan = {}; spasi saja tidak dihitung berubah; hanya bidang yang berubah; kode tidak pernah dikirim", () => {
  const f = formDariSupplier(SUP);
  assert.deepEqual(payloadPerubahan(SUP, f), {});
  assert.deepEqual(payloadPerubahan(SUP, { ...f, phone: "   " }), {});
  assert.deepEqual(payloadPerubahan(SUP, { ...f, phone: " 0812 ", code: "SUP-HACK" }), { phone: "0812" });
  const berisi = { ...SUP, phone: "0811", paymentTermDays: 30 };
  assert.deepEqual(payloadPerubahan(berisi, { ...formDariSupplier(berisi), phone: "" }), { phone: "" }, "mengosongkan isian dikirim sebagai kosong");
  assert.deepEqual(payloadPerubahan(berisi, { ...formDariSupplier(berisi), paymentTermDays: "" }), { paymentTermDays: null });
  assert.deepEqual(payloadPerubahan(berisi, { ...formDariSupplier(berisi), paymentTermDays: "45" }), { paymentTermDays: 45 });
  assert.deepEqual(payloadPerubahan(SUP, { ...f, paymentTermDays: "30" }), { paymentTermDays: 30 });
});

test("galatForm: nama wajib, email valid, termin bulat 0–365", () => {
  const f = formDariSupplier(SUP);
  assert.equal(galatForm(f), null);
  assert.match(galatForm({ ...f, name: "  " }), /Nama/);
  assert.match(galatForm({ ...f, email: "salah" }), /email/i);
  assert.equal(galatForm({ ...f, email: "a@b.id" }), null);
  assert.match(galatForm({ ...f, paymentTermDays: "366" }), /Termin/);
  assert.match(galatForm({ ...f, paymentTermDays: "1.5" }), /Termin/);
  assert.match(galatForm({ ...f, paymentTermDays: "-1" }), /Termin/);
  assert.equal(galatForm({ ...f, paymentTermDays: "0" }), null);
  assert.equal(galatForm({ ...f, paymentTermDays: "365" }), null);
});

test("rekeningBerubah: hanya bank/nomor/atas nama yang memicu peringatan", () => {
  const f = formDariSupplier(SUP);
  assert.equal(rekeningBerubah(SUP, f), false);
  assert.equal(rekeningBerubah(SUP, { ...f, phone: "08" }), false);
  assert.equal(rekeningBerubah(SUP, { ...f, bankAccount: "123" }), true);
  assert.equal(rekeningBerubah(SUP, { ...f, bankName: "BCA" }), true);
  assert.equal(rekeningBerubah(SUP, { ...f, bankHolder: "X" }), true);
  assert.equal(rekeningBerubah(SUP, { ...f, bankAccount: "   " }), false);
});

test("supplierBisaDipilih: nonaktif tidak dipilih untuk transaksi baru, kecuali supplier tagihan yang sedang diedit", () => {
  const daftar = [{ id: "a", active: true }, { id: "b", active: false }, { id: "c" }];
  assert.deepEqual(supplierBisaDipilih(daftar).map((s) => s.id), ["a", "c"]);
  assert.deepEqual(supplierBisaDipilih(daftar, { tetapSertakanId: "b" }).map((s) => s.id), ["a", "b", "c"]);
  assert.deepEqual(supplierBisaDipilih(null), []);
});

test("halaman: kolom Aksi di Master Supplier (Edit + Nonaktifkan/Aktifkan), supplier nonaktif dimuat, dropdown transaksi hanya yang aktif", () => {
  assert.match(halaman, /api\.getFinanceSuppliers\(\{ includeInactive: "1" \}\)/);
  assert.match(halaman, /<TH width=\{AKSI_COL_WIDTH_MENU_ONLY\}>Aksi<\/TH>/);
  assert.match(halaman, /label: "Edit data supplier", icon: Pencil,/, "RowActions menerima KOMPONEN ikon, bukan elemen JSX (elemen membuat halaman crash saat menu dibuka)");
  assert.doesNotMatch(halaman, /icon: <w+/, "tidak boleh ada icon berupa elemen JSX di item menu");
  assert.match(halaman, /label: "Edit data supplier"/);
  assert.match(halaman, /label: "Nonaktifkan"/);
  assert.match(halaman, /label: "Aktifkan kembali"/);
  assert.match(halaman, /api\.updateFinanceSupplier\(s\.id, \{ active: !s\.active \}\)/);
  assert.match(halaman, /suppliers=\{suppliersAktif\} unbilled=/, "Tagihan Baru hanya supplier aktif");
  assert.match(halaman, /suppliers=\{suppliersAktif\} bills=/, "Bayar Supplier hanya supplier aktif");
  assert.match(halaman, /supplierBisaDipilih\(suppliers, \{ tetapSertakanId: editUntuk\.supplierId \}\)/, "edit tagihan tetap menyertakan supplier tagihannya");
  assert.doesNotMatch(halaman, /suppliers=\{suppliers\} (unbilled|bills)=/);
});

test("dialog edit: mengirim hanya perubahan, galat server tampil di dalam dialog dan tombol dilepas, peringatan rekening, kode terkunci", () => {
  assert.match(halaman, /onSubmit\(edit \? perubahan : f\)/);
  assert.match(halaman, /catch \(e\) \{ setGalat\(e\?\.message \|\| "Gagal menyimpan supplier"\); setSibuk\(false\); \}/);
  assert.match(halaman, /onOpenChange=\{\(v\) => \{ if \(!v && !sibuk\) onClose\(\); \}\}/);
  assert.match(halaman, /data-testid="peringatan-rekening"/);
  // Peringatan & galat harus di FOOTER (selalu terlihat) — di badan dialog yang bisa di-scroll mereka tersembunyi di bawah lipatan (ditemukan lewat uji browser).
  const mulaiFooter = halaman.indexOf("footer={(", halaman.indexOf("function ModalSupplier"));
  const footer = halaman.slice(mulaiFooter, halaman.indexOf("Simpan Perubahan", mulaiFooter));
  assert.ok(mulaiFooter > 0 && footer.includes("flex w-full flex-col gap-2"), "footer dialog supplier berisi pembungkus peringatan + tombol");
  assert.match(footer, /peringatan-rekening/);
  assert.match(footer, /galat-server-supplier/);
  assert.match(footer, /galat-lokal-supplier/);
  assert.match(halaman, /disabled=\{edit\}/, "kode tidak bisa diubah");
  assert.match(halaman, /disabled=\{!!galatLokal \|\| !adaPerubahan \|\| sibuk\}/);
  assert.match(halaman, /key=\{editSupplier\?\.id \?\? "edit-kosong"\}/, "formulir direset per supplier");
  assert.match(halaman, /async function simpanEditSupplier[\s\S]*?await api\.updateFinanceSupplier\(awal\.id, perubahan\);[\s\S]*?await muat\(\);/);
});
