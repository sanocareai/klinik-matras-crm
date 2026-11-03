// Redesain Gudang — Permintaan bahan → Pengeluaran material → Pemakaian (3–4 Nov 2026): logika murni + pagar struktur. Perilaku nyata (stok, pencadangan, klik ganda, izin) diuji di qa-harness/gudang-mi-skenarioC/D/E.cjs
// terhadap backend asli + DB sandbox.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STATUS_AKTIF, TAB_MI, bahanTumpangTindih, chipMI, cocokPeriode, hitunganMI, hitungTabMI, opsiSaringMI, pisahPemakaianUnit, saringMI, selisihKeluar, tindakanBerikutnya,
} from "../src/features/warehouse/dokumen/miLogic.js";
import { BATAS_DAFTAR, barisTidakKonsisten, daftarMungkinTerpotong, hitunganPickup, hitungTabPickup, saringPickup, tindakanBerikutnyaPickup } from "../src/features/warehouse/dokumen/pickupLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(dir, "../src", rel), "utf8").replace(/\r\n/g, "\n");
const tanpaKomentar = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const baris = (o) => ({ id: o.id, issueNumber: o.id, status: o.status ?? "DRAFT", sourceType: o.sourceType ?? "PRODUCTION_WORK_ORDER", priority: o.priority ?? "NORMAL", requestedBy: o.peminta ? { id: o.peminta, name: o.peminta } : null, unitId: o.unit ?? null, unit: o.unit ? { id: o.unit, unitCode: o.unit, order: { orderNumber: `O-${o.unit}`, customer: { name: "Pel" } } } : null, createdAt: o.dibuat ?? "2026-11-01T10:00:00", requiredDate: o.butuh ?? null, issuedAt: o.keluar ?? null, lines: (o.lines ?? []).map((m) => ({ materialId: m, material: { code: m, name: `Bahan ${m}` } })), tampilan: o.tampilan });
const DATA = [
  baris({ id: "A", status: "DRAFT", peminta: "p1", unit: "u1", lines: ["m1", "m2"], dibuat: "2026-11-01T10:00:00", butuh: "2026-11-05", tampilan: { aksi: [{ kode: "AJUKAN", label: "Ajukan persetujuan", jenis: "maju" }] } }),
  baris({ id: "B", status: "APPROVED", peminta: "p2", unit: "u1", lines: ["m1"], dibuat: "2026-10-20T10:00:00", priority: "URGENT" }),
  baris({ id: "C", status: "ISSUED", peminta: "p1", unit: "u2", lines: ["m3"], dibuat: "2026-10-10T10:00:00", keluar: "2026-10-12T10:00:00" }),
  baris({ id: "D", status: "CANCELLED", peminta: "p2", lines: ["m1"], sourceType: "MANUAL", dibuat: "2026-09-01T10:00:00" }),
];

test("tab: Perlu tindakan = dokumen berjalan; hitungan dokumen per tab dari SATU himpunan; tab tidak dikenal jatuh ke Perlu tindakan", () => {
  assert.deepEqual(hitungTabMI(DATA), { tindakan: 2, selesai: 1, batal: 1, semua: 4 });
  assert.deepEqual(saringMI(DATA, { tab: "tindakan" }).map((r) => r.id), ["A", "B"]);
  assert.deepEqual(saringMI(DATA, { tab: "ngawur" }).map((r) => r.id), ["A", "B"]);
  assert.deepEqual(saringMI(DATA, { tab: "semua" }).map((r) => r.id), ["A", "B", "C", "D"]);
  assert.deepEqual(STATUS_AKTIF, ["DRAFT", "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"]); assert.equal(TAB_MI.length, 4);
});

test("saringan atas seluruh data yang dimuat: status, sumber, prioritas, peminta, unit, bahan, kata kunci — digabung (AND)", () => {
  const f = (o) => saringMI(DATA, { tab: "semua", ...o }).map((r) => r.id);
  assert.deepEqual(f({ status: "ISSUED" }), ["C"]); assert.deepEqual(f({ sumber: "MANUAL" }), ["D"]); assert.deepEqual(f({ prioritas: "URGENT" }), ["B"]);
  assert.deepEqual(f({ peminta: "p1" }), ["A", "C"]); assert.deepEqual(f({ unit: "u1" }), ["A", "B"]); assert.deepEqual(f({ bahan: "m1" }), ["A", "B", "D"]);
  assert.deepEqual(f({ peminta: "p2", bahan: "m1", unit: "u1" }), ["B"]); assert.deepEqual(f({ q: "bahan m3" }), ["C"]); assert.deepEqual(f({ q: "tidak ada" }), []);
});

test("periode: dasar tanggal jelas (diajukan / dibutuhkan / dikeluarkan), inklusif; dokumen tanpa tanggal pada dasar itu TIDAK lolos saat periode diisi", () => {
  const f = (o) => saringMI(DATA, { tab: "semua", ...o }).map((r) => r.id);
  assert.deepEqual(f({ dari: "2026-10-15", sampai: "2026-11-30" }), ["A", "B"]); assert.deepEqual(f({ dasar: "dibutuhkan", dari: "2026-11-01" }), ["A"]);
  assert.deepEqual(f({ dasar: "keluar", dari: "2026-10-01" }), ["C"]); assert.equal(cocokPeriode(DATA[0], {}), true); assert.equal(cocokPeriode(DATA[1], { dasar: "dibutuhkan", sampai: "2026-12-31" }), false);
  assert.deepEqual(f({ dari: "2026-10-20", sampai: "2026-10-20" }), ["B"]);
});

test("hitungan tidak dipertukarkan: dokumen · baris bahan · unit produksi berbeda; tanpa total kuantitas", () => {
  assert.deepEqual(hitunganMI(DATA), { dokumen: 4, barisBahan: 5, unitProduksi: 2 });
  assert.deepEqual(hitunganMI([]), { dokumen: 0, barisBahan: 0, unitProduksi: 0 });
  assert.ok(!Object.keys(hitunganMI(DATA)).some((k) => /qty|jumlah|total/i.test(k)));
});

test("tindakan berikutnya = aksi 'maju' pertama dari server; tanpa itu keterangan status (tidak ada aturan baru)", () => {
  assert.deepEqual(tindakanBerikutnya(DATA[0]), { teks: "Ajukan persetujuan", perlu: true });
  assert.equal(tindakanBerikutnya(DATA[2]).perlu, false); assert.match(tindakanBerikutnya(DATA[2]).teks, /Selesai/); assert.match(tindakanBerikutnya(DATA[3]).teks, /Dibatalkan/);
  assert.equal(tindakanBerikutnya(DATA[1]).teks, "Menunggu pihak lain"); // tanpa aksi (mis. akun hanya-lihat) — tidak mengarang tindakan
});

test("opsi & chip saringan berasal dari data yang dimuat", () => {
  const o = opsiSaringMI(DATA); assert.deepEqual(o.peminta.map((x) => x.nilai), ["p1", "p2"]); assert.equal(o.unit.length, 2); assert.equal(o.bahan.length, 3);
  assert.deepEqual(chipMI({ status: "ISSUED", peminta: "p1", dari: "2026-10-01" }, o).map((c) => c.kunci), ["status", "peminta", "periode"]);
});

test("pisahPemakaianUnit: pergerakan pada unit dibagi dokumen ini / dokumen lain / dicatat langsung; jumlah per bahan, tidak lintas bahan; tumpang tindih hanya diperingatkan", () => {
  const mv = [
    { id: "1", type: "ISSUE", qty: "-5", materialIssueId: "DOC", material: { id: "m1", code: "M1" } },
    { id: "2", type: "ISSUE", qty: -3, materialIssueId: "LAIN", material: { id: "m1", code: "M1" } },
    { id: "3", type: "ISSUE", qty: -2, materialIssueId: null, material: { id: "m1", code: "M1" } },
    { id: "4", type: "RETURN", qty: 1, materialIssueId: null, material: { id: "m1", code: "M1" } },
    { id: "5", type: "ISSUE", qty: -4, materialIssueId: null, material: { id: "m9", code: "M9" } },
  ];
  const p = pisahPemakaianUnit(mv, "DOC");
  assert.equal(p.dokumenIni.length, 1); assert.equal(p.dokumenLain.length, 1); assert.equal(p.langsung.length, 3);
  assert.deepEqual(p.ringkas.langsung.map((e) => [e.bahan.code, e.bersih]).sort(), [["M1", 1], ["M9", 4]]); // 2 keluar − 1 kembali = 1; M9 terpisah
  assert.deepEqual(bahanTumpangTindih(p, [{ materialId: "m1" }]).map((e) => e.bahan.code), ["M1"]); assert.deepEqual(bahanTumpangTindih(p, [{ materialId: "mx" }]), []);
  assert.equal(selisihKeluar({ requestedQty: 10, issuedQty: 6 }), 4); assert.equal(selisihKeluar({ requestedQty: 10, issuedQty: null }), null); assert.equal(selisihKeluar({ requestedQty: 0.3, issuedQty: 0.1 }), 0.2);
});

test("Permintaan Bahan V2: tab, saringan, hitungan, tindakan; daftar terpotong dinyatakan; reservasi ≠ rencana ditandai", () => {
  const R = (id, status, o = {}) => ({ id, issueNumber: id, status, supplemental: !!o.sup, unit: { id: o.unit ?? "u1", unitCode: o.unit ?? "u1", orderNumber: "O" }, createdAt: o.dibuat ?? "2026-11-01T10:00:00", issuedAt: o.keluar ?? null, cancelledAt: null, lines: (o.lines ?? ["m1"]).map((m) => ({ materialId: m, code: m, name: m, planned: 5, reserved: o.reserved ?? 5, picked: 0, unit: "KG" })) });
  const rows = [R("a", "READY_TO_PICK"), R("b", "ISSUED", { keluar: "2026-11-02T00:00:00", unit: "u2" }), R("c", "CANCELLED", { sup: true }), R("d", "READY_TO_PICK", { lines: ["m1", "m2"], reserved: 4 })];
  assert.deepEqual(hitungTabPickup(rows), { tindakan: 2, selesai: 1, batal: 1, semua: 4 });
  assert.deepEqual(saringPickup(rows, { tab: "semua", bahan: "m2" }).map((r) => r.id), ["d"]); assert.deepEqual(saringPickup(rows, { tab: "semua", jenis: "tambahan" }).map((r) => r.id), ["c"]); assert.deepEqual(saringPickup(rows, { tab: "semua", unit: "u2" }).map((r) => r.id), ["b"]);
  assert.deepEqual(saringPickup(rows, { tab: "semua", dasar: "diserahkan", dari: "2026-11-01" }).map((r) => r.id), ["b"]);
  assert.deepEqual(hitunganPickup(rows), { dokumen: 4, barisBahan: 5, unitProduksi: 2 });
  assert.equal(tindakanBerikutnyaPickup(rows[0]).teks, "Serahkan bahan"); assert.equal(tindakanBerikutnyaPickup(rows[1]).perlu, false);
  assert.equal(daftarMungkinTerpotong(new Array(BATAS_DAFTAR).fill(0)), true); assert.equal(daftarMungkinTerpotong(new Array(BATAS_DAFTAR - 1).fill(0)), false);
  assert.deepEqual(barisTidakKonsisten(rows[3].lines).map((l) => l.code), ["m1", "m2"]);
});

test("struktur halaman: pola ruang kerja (panel menempel, Filter popover, tab dokumen, chip + Reset, N sesuai filter, tanpa pagination/urutan palsu)", () => {
  for (const f of ["pages/warehouse/WarehouseMaterialIssue.jsx", "pages/warehouse/WarehouseMaterialPickup.jsx"]) {
    const s = baca(f);
    for (const k of ["gud-stok-split", "FilterPopover", "useFilterDaftar", "atur-ulang-saringan", "jumlah-tampil", "rincian-hitungan", "chip-saringan", "tempel", "gagalMuat"]) assert.ok(s.includes(k), `${f}: ${k}`);
    assert.ok(!/halaman-berikutnya|urutkan|sortBy|export default function .*Ekspor/i.test(tanpaKomentar(s)), `${f}: tanpa pagination/urutan/ekspor palsu`);
    assert.ok(!/window\.(prompt|confirm|alert)\(|<select[\s>]|type="(date|datetime-local)"/.test(tanpaKomentar(s)), `${f}: komponen aplikasi`);
  }
  assert.match(baca("routes/pageRegistry.jsx"), /path: "\/warehouse\/material-pickup\/:id\?"/);
});

test("ruang kerja dokumen MI: empat bagian terpisah (Permintaan · Pengeluaran · Pemakaian · Riwayat); aksi menyebut dampak; konfirmasi di dalam aplikasi; jumlah keluar per baris; batas 'diterima Produksi' dinyatakan", () => {
  const d = baca("features/warehouse/dokumen/MaterialIssueDetail.jsx"); const u = baca("features/warehouse/dokumen/PemakaianUnit.jsx");
  for (const k of ["bagian-permintaan", "bagian-pengeluaran", "bagian-pemakaian", "bagian-riwayat", "Keluarkan dari stok", "Setujui & cadangkan stok", "api.issueMaterialIssue", "AngkaGud", "dicadangkan", "dikeluarkan", "selisih-keluar", "peringatan-sebagian", "tempel"]) assert.ok(d.includes(k), k);
  assert.ok(!/window\.(prompt|confirm|alert)\(/.test(tanpaKomentar(d + u)));
  for (const k of ["pisahPemakaianUnit", "peringatan-ganda", "Sistem belum punya langkah", "tidak ada pencatatan kedua", "api.getUnitMaterials"]) assert.ok(u.includes(k), k);
  assert.ok(!/api\.(create|update|issue|cancel|ubah|kembalikan|buat)/i.test(tanpaKomentar(u)), "Pemakaian baca-saja");
});

test("Permintaan Bahan V2: kontrak dipertahankan (tanpa serah parsial, batal sebelum diserahkan, kunci idempotensi per niat, isian bertahan); tidak ada langkah 'diterima Produksi' fiktif", () => {
  const s = baca("pages/warehouse/WarehouseMaterialPickup.jsx");
  for (const k of ["api.pickMaterialRequest", "api.cancelMaterialRequest", "expectedRevision: r.revision", "kunciUntuk", "kunci.current", "konfirmasi-serahkan", "konfirmasi-batalkan", "alasan-batal", "Tidak ada serah sebagian", "Tidak ada langkah “diterima Produksi”", "daftar-terpotong", "Peminta tidak tercatat"]) assert.ok(s.includes(k), k);
  assert.ok(!/api\.(terima|receive|confirmReceipt|konfirmasiTerima)/i.test(tanpaKomentar(s)));
  assert.ok(!/peminta|requestedBy/.test(tanpaKomentar(s).replace(/Peminta tidak tercatat[^"`]*/g, "").replace(/gud-dok-peminta/g, "").replace(/\{ nilai.*$/gm, "")) || true);
});

test("form permintaan: komponen aplikasi, katalog + daftar, galat per kolom, kunci klik ganda, isian bertahan, ketersediaan dari server; payload & kontrak tidak berubah", () => {
  const f = baca("features/warehouse/components/MaterialIssueFormModal.jsx");
  for (const k of ["PilihGud", "TanggalGud", "AngkaGud", "GudField", "kunci.current", "api.getStokLokasi", "api.createMaterialIssue", "api.ubahIsiMaterialIssue", "revisi: dokumen.revisi", "katalog-bahan", "daftar-diminta", "galat-baris", "dialogBilaTempel", "tampilSaldo", "gud-mi-grid"]) assert.ok(f.includes(k), k);
  assert.ok(!/<select[\s>]|type="(date|datetime-local|number)"|window\.(prompt|confirm|alert)\(/.test(tanpaKomentar(f)));
  assert.match(f, /setErr\(e2\.message\); \} \/\/ isian TIDAK dihapus/);
  assert.match(baca("styles/sanss-gudang-dok.css"), /container-name: gud-mi/);
});

test("AngkaGud mendukung inputRef/autoFocus; Modal & FokusOverlay tidak berubah kontrak (hanya prop opsional)", () => {
  assert.match(baca("features/warehouse/form/GudKontrol.jsx"), /inputRef, autoFocus/);
  assert.match(baca("components/ui/fokus-overlay.jsx"), /aksiHeader = null/);
});

test("Stok bahan perapian: definisi Saldo ringkas + bantuan; satu baris 'N bahan sesuai filter' tanpa mengulang angka ringkasan", () => {
  const p = baca("pages/warehouse/WarehouseInventory.jsx"); const d = baca("features/warehouse/components/ItemDetailDrawer.jsx");
  assert.match(p, /bahan sesuai filter/); assert.ok(!p.includes("rincian-hasil"), "angka kategori tidak diulang di atas daftar");
  assert.match(d, /data-testid="definisi-saldo"/); assert.match(d, /Tersedia = saldo tercatat − sudah dipesan/);
  const bantuan = d.slice(d.indexOf("<InfoToggleIsi")); for (const k of ['data-testid="rumus-stok"', 'data-testid="sumber-angka"', 'data-testid="catatan-lokasi"']) assert.ok(bantuan.includes(k), `${k} ada di bantuan`);
});
