// Profil unit (PanelUnit) dipakai di Order Produksi, Rencana, QC, Planner. Formulir yang dibuka DARI profil (Catat bahan, koreksi, dll.) adalah Modal/PanelSamping
// z 200/201 yang di-portal ke body — panel profil WAJIB di bawahnya. Dulu z 9000: formulir terbuka di BELAKANG panel → tombol tampak macet (laporan Owner 14 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const baca = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

test("latar profil unit di bawah lapisan dialog aplikasi (Modal & PanelSamping z 200)", () => {
  const z = Number(/\.rc-panel-latar \{[^}]*z-index:\s*(\d+)/.exec(baca("../src/features/production/rencana/rencana.css"))?.[1]);
  assert.ok(Number.isFinite(z), "z-index .rc-panel-latar terbaca");
  assert.ok(z < 200, `z-index profil ${z} harus < 200`);
  assert.ok(baca("../src/components/ui/modal.jsx").includes("z-[201]"), "Modal tetap z 201");
});

test("Esc pada formulir di atas profil hanya menutup formulir (pendengar fase capture)", () => {
  const src = baca("../src/features/production/rencana/PanelUnit.jsx");
  assert.ok(src.includes('document.addEventListener("keydown", esc, true)'));
  assert.ok(src.includes('document.removeEventListener("keydown", esc, true)'));
});
