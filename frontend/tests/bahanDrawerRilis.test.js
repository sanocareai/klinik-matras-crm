// Rilis frontend "drawer Pemakaian aktual" — pagar tambahan: label tombol hanya-lihat (peran sama dengan backend), usulan tertinggal + retry tanpa menggandakan,
// alasan rekonsiliasi + asal barang terbaca Gudang. Model murni + pin sumber (node --test, tanpa DOM; perilaku browser dibuktikan QA UI lokal).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ALASAN_SEMENTARA, susunCatatanRekon } from "../src/features/production/bahan/bahanModel.js";
import { PERAN_CATAT_BAHAN, bisaCatatBahan } from "../src/lib/roles.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(dir, "..", "src", ...p), "utf8");

test("peran 'Catat bahan' di frontend = peran ber-izin unit:material:write di backend (tidak boleh melenceng)", async () => {
  const m = await import(pathToFileURL(path.join(dir, "..", "..", "backend", "src", "constants", "permissions.js")).href);
  const wajar = Object.entries(m.ROLE_PERMISSIONS).filter(([, izin]) => izin.includes(m.PERMISSIONS.UNIT_MATERIAL_WRITE)).map(([r]) => r).sort();
  assert.deepEqual([...PERAN_CATAT_BAHAN].sort(), wajar);
  assert.equal(bisaCatatBahan({ roles: ["SALES"] }), false); assert.equal(bisaCatatBahan({ roles: ["SALES", "WAREHOUSE"] }), true); assert.equal(bisaCatatBahan(null), false); assert.equal(bisaCatatBahan({ role: "ADMIN" }), true);
});

test("daftar Order Produksi: akun hanya-lihat melihat 'Lihat bahan', bukan 'Catat bahan' (desktop dan HP)", () => {
  const w = src("pages", "bengkel", "ProductionWorkOrders.jsx");
  for (const k of ['bisaCatatBahan(bacaPengguna())', 'bisaCatat ? "Catat bahan" : "Lihat bahan"', 'data-aksi={bisaCatat ? "catat" : "lihat"}', '>{labelBahan}</Button>']) assert.ok(w.includes(k), k);
  assert.ok(!/>Catat bahan<\/Button>/.test(w), "tidak ada label 'Catat bahan' yang dipatok untuk semua akun");
  assert.equal((w.match(/data-testid="catat-bahan-baris"/g) || []).length, 2);
});

test("susunCatatanRekon: bahan ADA di katalog → alasan + kode katalog; alasan lain wajib teks; belum ada → alasan katalog; deterministik; maks 500", () => {
  const kat = { nama: "BUSA REBONDED SKY", kode: "BUSA-SKY" };
  const a = susunCatatanRekon({ kandidatKatalog: kat, alasan: "STOK_BELUM_TERCATAT" });
  assert.match(a, /^Alasan rekonsiliasi: stok bahan ini belum tercatat di Gudang/); assert.match(a, /Bahan mirip di katalog: BUSA REBONDED SKY \(BUSA-SKY\)\.$/);
  assert.match(susunCatatanRekon({ kandidatKatalog: kat, alasan: "LAINNYA", alasanLain: " dipinjam dari meja lain " }), /Alasan rekonsiliasi: dipinjam dari meja lain\./);
  assert.match(susunCatatanRekon({ kandidatKatalog: kat }), /\(alasan belum dipilih\)/);
  assert.match(susunCatatanRekon({}), /^Alasan rekonsiliasi: bahan belum ada di katalog Gudang\.$/);
  assert.match(susunCatatanRekon({ kandidatUsulan: { nama: "Lem X" } }), /usulan bahan terbuka dengan nama ini \(Lem X\)/);
  assert.match(susunCatatanRekon({ catatan: "  untuk rangka  " }), /Catatan: untuk rangka$/);
  assert.equal(susunCatatanRekon({ kandidatKatalog: kat, alasan: "SUDAH_DIPAKAI_DULU", catatan: "x" }), susunCatatanRekon({ kandidatKatalog: kat, alasan: "SUDAH_DIPAKAI_DULU", catatan: "x" }), "deterministik (kunci idempoten stabil)");
  assert.ok(susunCatatanRekon({ catatan: "z".repeat(900) }).length <= 500);
  assert.deepEqual(ALASAN_SEMENTARA.map((x) => x.key), ["STOK_BELUM_TERCATAT", "STOK_TIDAK_CUKUP", "SUDAH_DIPAKAI_DULU", "LAINNYA"]);
});

test("BahanBelumAda: kegagalan di antara usulan dan pemakaian — usulan tertinggal tersimpan (kunci + isian), pesan menjelaskan langkah yang belum selesai, retry memakai kunci sama dan tidak mengirim ulang usulan", () => {
  const b = src("features", "production", "bahan", "BahanBelumAda.jsx"); const p = src("features", "production", "bahan", "PemakaianAktualBagian.jsx");
  for (const k of ["onTertinggal?.({ usulan: r.usulan, form: formSimpan(), kunci: null, sidik: null })", "{ usulan: dibuat, form: formSimpan(), kunci: kunciRef.current, sidik: sidikRef.current }", "KODE_FINAL.includes(e?.code) ? null", "onTertinggal?.(null)", "setLangkah(KODE_FINAL.includes(e?.code) ? \"final\" : \"pemakaian\")", "setLangkah(\"usulan\")",
    "if (usulkanEfektif && !dibuat)", "SUDAH terkirim ke Gudang, tetapi pemakaian sementara BELUM tersimpan", "Langkah 1 selesai", "Langkah 2 belum selesai", "Simpan pemakaian lagi", "usulan tidak dikirim ulang", "Usulan belum terkirim (tidak ada yang tersimpan)",
    "useRef(tertinggalAwal?.kunci ?? null)", "useRef(tertinggalAwal?.sidik ?? \"\")", "Tutup (lanjutkan nanti)"]) assert.ok(b.includes(k), k);
  for (const k of ["sessionStorage", "bahan-usulan-tertinggal:", 'data-testid="usulan-tertinggal"', 'data-testid="usulan-tertinggal-lanjut"', 'data-testid="usulan-tertinggal-lewati"', "sudah terkirim ke Gudang", "belum tersimpan", "usulan tidak akan dikirim ulang", "i.proposalId === tertinggal.usulan?.id", "tertinggalAwal={awalBelum.dariTertinggal ? tertinggal : null}"]) assert.ok(p.includes(k), k);
  assert.ok(b.indexOf("api.ajukanBahanBaru") < b.indexOf("api.catatPemakaianSementara"), "urutan: usulan lalu pemakaian");
  assert.equal((b.match(/api\.ajukanBahanBaru\(/g) || []).length, 1, "usulan hanya dikirim di satu tempat");
});

test("bahan ADA di katalog tetapi dicatat sementara: alasan wajib + asal wajib; catatan untuk Gudang disusun; Gudang melihat asal dan alasan di antrean dan di drawer", () => {
  const b = src("features", "production", "bahan", "BahanBelumAda.jsx"); const g = src("pages", "warehouse", "WarehouseUsulanBahan.jsx"); const d = src("features", "production", "bahan", "PemakaianSementaraDaftar.jsx"); const c = src("features", "production", "bahan", "PemakaianAktualBagian.jsx");
  for (const k of ["const wajibAlasan = bolehSementara && !!kandidatKatalog", "alasan-rekon", "Mengapa dicatat sementara, padahal bahan ini ada di katalog? (Gudang membaca ini)", "wajib — Gudang perlu tahu dari mana barang ini", "catatan-untuk-gudang", "Yang akan dibaca Gudang:", "note: catatanGudang || undefined", "originNote: asal.trim() || undefined", "alasanOk", "asalOk", "hasil-asal", "hasil-alasan"]) assert.ok(b.includes(k), k);
  // ATURAN SERVER: nama SAMA PERSIS dengan katalog ditolak (409) → UI memblokir dengan penjelasan; hanya nama MIRIP yang boleh dicatat sementara dengan alasan+asal wajib
  for (const k of ["katalogSama", "blokKatalogSama", 'data-testid="katalog-sama-blok"', "Tidak bisa dicatat sementara", "server menolak pemakaian sementara dengan nama ini", '(k.tingkat ?? "SAMA") === "SAMA"', "!blokKatalogSama && usulanOk", 'const KODE_FINAL = ["BAHAN_ADA_DI_KATALOG", "USULAN_DITOLAK"]', 'data-testid="usulan-final"']) assert.ok(b.includes(k), k);
  assert.ok(!c.includes('alasan: "STOK_BELUM_TERCATAT"'), "tidak lagi mengarahkan stok-belum-diketahui ke pemakaian sementara bernama sama (pasti ditolak server)");
  const cb = src("features", "production", "bahan", "CatatBahanBaru.jsx"); assert.ok(cb.includes("aktual-stok-tak-diketahui-jalur") && cb.includes("Yang saya pakai bukan bahan ini") && cb.includes("ditolak server"));
  for (const k of ['data-testid="sementara-asal-gudang"', "Asal barang:", "belum diisi oleh pencatat", 'data-testid="sementara-alasan-gudang"', "{r.note}"]) assert.ok(g.includes(k), k);
  assert.ok(d.includes('asal: {item.originNote || "belum diisi"}'));
});
