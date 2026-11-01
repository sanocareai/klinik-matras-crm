// Pemasangan UI editor & rincian PO (UX): kontrol baru terpasang, payload/endpoint/aturan lama tidak berubah, bantuan faktur tidak membuat data.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const baca = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const editor = baca("../src/features/finance/po/EditorPO.jsx");
const kontrol = baca("../src/features/finance/po/KontrolPO.jsx");
const rincian = baca("../src/features/finance/po/RincianPO.jsx");
const induk = baca("../src/pages/finance/FinancePurchaseOrders.jsx");
const css = baca("../src/styles/sanss-finance-po.css");

test("editor: tanggal/supplier/termin memakai kontrol bergaya aplikasi, bukan native date/select/TerminFaktur", () => {
  assert.doesNotMatch(editor, /type="date"/);
  assert.doesNotMatch(editor, /<Pilihan\b/);
  assert.doesNotMatch(editor, /TerminFaktur/);
  assert.equal((editor.match(/<TanggalPO\b/g) || []).length, 2, "Tanggal PO + Perkiraan datang");
  assert.match(editor, /<PemilihSupplier\b/);
  assert.match(editor, /<TerminPO\b/);
  assert.match(editor, /bolehKosong min=\{f\.orderDate\}/, "perkiraan datang opsional; aturan 'tidak sebelum tanggal PO' yang sudah ada dipertahankan");
  assert.match(editor, /label="Tanggal PO" required/);
  assert.match(editor, /placeholder="Pilih tanggal"/);
});

test("editor: payload & penyimpanan tidak berubah — bodyDariForm({ ...f, termin }), endpoint sama, kunci idempoten sama", () => {
  assert.match(editor, /const body = bodyDariForm\(\{ \.\.\.f, termin \}\);/);
  assert.match(editor, /api\.updatePurchaseOrder\(po\.id, body\) : await api\.createPurchaseOrder\(body, `po-\$\{kunci\}`\)/);
  assert.match(editor, /api\.pratinjauHargaPO\(/);
  assert.doesNotMatch(editor, /fakturDiterima[^\n]*bodyDariForm|bodyDariForm[^\n]*fakturDiterima/);
  assert.doesNotMatch(editor, /set\("notes"[^\n]*faktur/i, "bantuan faktur tidak menulis ke Catatan");
});

test("editor: penguncian simpan tetap — formulir tidak valid tidak pernah memanggil API; galat tampil setelah percobaan", () => {
  const i = editor.indexOf("async function simpan()");
  const j = editor.indexOf("api.createPurchaseOrder", i);
  const awal = editor.slice(i, j);
  assert.match(awal, /if \(galatForm\) \{ setPercobaan\(true\); fokusKe\(masalahForm\); return; \}/);
  assert.ok(awal.indexOf("if (galatForm)") < awal.indexOf("api."), "pemeriksaan sebelum request apa pun");
  assert.match(editor, /\(galat \|\| \(percobaan && galatForm\)\)/, "galat formulir di footer baru tampil setelah percobaan simpan");
  assert.match(editor, /disabled=\{dampak\.menahan\} aria-disabled=\{!!galatForm \|\| dampak\.menahan \|\| undefined\}/, "penahan harga dari server tetap mengunci");
  assert.match(editor, /\(!barisKosong\(l\) \|\| percobaan\) \? galatBaris/, "baris kosong tidak merah di form baru");
  assert.match(editor, /galatSupplier = \(percobaan \|\| disentuh\.supplier\)/);
  assert.match(editor, /aria-invalid/);
});

test("editor: mengganti supplier mengosongkan override termin supplier sebelumnya", () => {
  assert.match(editor, /if \(v !== f\.supplierId\) setTermin\(TERMIN_AWAL\)/);
});

test("editor: rincian baris dekat identitas bahan; satuan beli & mode pendamping memakai select bergaya aplikasi; aturan konversi/pendamping tidak berubah", () => {
  assert.match(editor, /fin-poed-ringkas-identitas/);
  assert.match(editor, /data-testid=\{`rinci-\$\{no\}`\}>Rincian baris/);
  assert.match(editor, /<SelectPO value=\{l\.satuanBeli \|\| m\.unit\}/);
  assert.match(editor, /ariaLabel=\{`Mode pendamping baris \$\{no\}`\}/);
  assert.match(editor, /aria-label=\{`Faktor konversi baris \$\{no\}`\}/);
  assert.match(editor, /teksPratinjauPendamping\(/);
});

test("Harga Berlaku: satu kalimat tetap terlihat, rincian di 'Lihat dampak', perilaku pembaruan tidak disentuh", () => {
  const t = baca("../src/features/finance/po/poTampilan.js");
  assert.match(t, /KALIMAT_HARGA_SIMPAN = "Menyimpan draf dapat memperbarui Harga Berlaku bahan\."/);
  assert.match(editor, /<b>\{KALIMAT_HARGA_SIMPAN\}<\/b>/);
  assert.match(editor, /Lihat dampak/);
  const rinci = t.slice(t.indexOf("DAMPAK_HARGA_RINCI"), t.indexOf("]);", t.indexOf("DAMPAK_HARGA_RINCI")));
  const urut = rinci.split("\n").filter((l) => l.trim().startsWith('"'));
  assert.equal(urut.length, 5);
  assert.match(urut[0], /HPP operasional/);
  assert.match(urut[1], /tidak mengubah nilai persediaan\/jurnal Finance/);
  assert.match(urut[2], /tidak mengembalikan harga/);
});

test("bantuan 'Sudah menerima faktur supplier?': hanya menjelaskan langkah — tidak membuat faktur/jurnal, tidak menyetujui PO, tidak menaruh nomor di PO", () => {
  const i = editor.indexOf("function FakturDiterima");
  const f = editor.slice(i, editor.indexOf("export default function EditorPO", i));
  assert.match(f, /Sudah menerima faktur supplier\?/);
  assert.match(f, /Pencatatan faktur tetap langkah terpisah/);
  assert.doesNotMatch(f, /api\./, "tidak memanggil API");
  assert.match(editor, /onSaved\(hasil\.id, ringkasHasilSimpan\(hasil\.hargaDariPO\), \{ fakturDiterima, status:/);
  assert.match(induk, /setPetunjukFaktur\(opsi\?\.fakturDiterima \? id : null\)/);
  assert.match(induk, /petunjukFaktur=\{petunjukFaktur === detailId\}/);
  const p = rincian.slice(rincian.indexOf("function PetunjukFaktur"), rincian.indexOf("function KartuRingkas"));
  assert.match(p, /langkahFakturSetelahSimpan\(po\.status, izin\)/);
  assert.match(p, /langkah\.siap && <button/, "tombol Catat faktur supplier hanya bila PO memenuhi syarat");
  assert.doesNotMatch(p, /approvePurchaseOrder|createFinance|api\./);
  assert.match(rincian, /petunjukFaktur && fakturPO\.length === 0 && <PetunjukFaktur/);
});

test("kalender: portal ke dialog (tidak terpotong), keyboard, Esc kembalikan fokus, tanpa konversi zona waktu", () => {
  assert.match(kontrol, /createPortal\(kalender, dlg \|\| document\.body\)/);
  assert.match(kontrol, /role="dialog" aria-modal="false"/);
  for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]) assert.match(kontrol, new RegExp(`"${k}"`), k);
  assert.match(kontrol, /window\.addEventListener\("keydown", h, true\)/, "Esc fase capture: hanya menutup lapisan, bukan dialog");
  assert.match(kontrol, /pemicu\.current\?\.focus\(\)/);
  assert.match(kontrol, /Tahun sebelumnya/); assert.match(kontrol, /Bulan berikutnya/);
  assert.doesNotMatch(kontrol, /new Date\(|toISOString|getTimezoneOffset|Intl\.DateTimeFormat|toLocale/, "tidak ada konversi zona/UTC di komponen");
  assert.match(kontrol, /aria-current=\{s === hariIni \? "date" : undefined\}/);
  assert.match(kontrol, /sempit && "lembar"|sempit && <div className="fin-tgl-tirai"/);
});

test("termin: ringkasan + 'Ubah' hanya untuk admin keuangan, alasan wajib (validasi lama), PO tidak mewajibkan dueDate", () => {
  assert.match(kontrol, /admin && pr && \(/);
  assert.match(kontrol, /galatTermin\(draf, \{ tanpaTanggal: true \}\)/);
  assert.match(kontrol, /api\.pratinjauTermin\(\{ supplierId, billDate: tanggalFaktur \|\| undefined, dasar: "TANGGAL_TIBA" \}\)/);
  assert.match(kontrol, /Alasan <span/);
  assert.match(kontrol, /Tanggal khusus: tanggal jatuh tempo diisi saat faktur dicatat, bukan di PO\./);
  assert.match(kontrol, /Pakai termin supplier/);
  assert.doesNotMatch(kontrol, /\.dueDate\b|\bdueDate:|<Input type="date"/, "tidak ada kolom/isian tanggal jatuh tempo di PO");
});

test("rincian PO: uraian panjang di accordion, kalimat 'barang selesai ≠ sudah dibayar' tetap terlihat, tanpa garis bawah permanen", () => {
  assert.match(rincian, /<Uraian judul="Arti status ini"/);
  assert.match(rincian, /<Uraian judul="Cara membaca kolom item"/);
  assert.match(rincian, /PO yang selesai masuk stok tidak berarti fakturnya sudah masuk atau sudah dibayar/);
  assert.match(rincian, /<StatusEmpatPO po=\{po\}/);
  assert.match(css, /\.fin-po-modal a \{ text-decoration: none; \}/);
  assert.match(css, /\.fin-po-modal a:hover \{ text-decoration: underline;/);
  assert.match(css, /\.fin-tgl-pop\.lembar/);
  assert.match(css, /\.fin-tgl-sel\.terpilih/);
});
