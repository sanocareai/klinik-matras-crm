// Tes P8.1 (UI & Navigation Consolidation) — visibilitas menu sidebar
// berdasarkan peran/divisi/admin. Lihat src/lib/menuVisibility.js.
import test from "node:test";
import assert from "node:assert/strict";

import { filterMenuByPermission, visibleSections } from "../src/lib/menuVisibility.js";

const division = {
  label: "Production",
  sections: [
    {
      section: "OPERASIONAL",
      items: [
        { to: "/bengkel/production-v2", label: "Rencana Produksi" },
        { to: "/bengkel/pengajuan-biaya", label: "Pengajuan Biaya", bolehPeran: ["ADMIN", "OWNER", "FINANCE"], bolehDivisi: ["PRODUCTION"] },
      ],
    },
  ],
};

test("filterMenuByPermission: item tanpa bolehPeran selalu tampil", () => {
  const out = filterMenuByPermission(division, { roles: ["PRODUCTION_WORKER"], divisiSaya: [] });
  assert.ok(out.sections[0].items.some((i) => i.to === "/bengkel/production-v2"));
});

test("filterMenuByPermission: item bolehPeran disembunyikan bila peran tidak cocok dan bukan anggota divisi", () => {
  const out = filterMenuByPermission(division, { roles: ["PRODUCTION_WORKER"], divisiSaya: [] });
  assert.ok(!out.sections[0].items.some((i) => i.to === "/bengkel/pengajuan-biaya"));
});

test("filterMenuByPermission: item bolehPeran tampil kalau peran cocok", () => {
  const out = filterMenuByPermission(division, { roles: ["FINANCE"], divisiSaya: [] });
  assert.ok(out.sections[0].items.some((i) => i.to === "/bengkel/pengajuan-biaya"));
});

test("filterMenuByPermission: item bolehPeran tampil kalau anggota divisi (walau peran tidak cocok)", () => {
  const out = filterMenuByPermission(division, { roles: ["PRODUCTION_WORKER"], divisiSaya: ["PRODUCTION"] });
  assert.ok(out.sections[0].items.some((i) => i.to === "/bengkel/pengajuan-biaya"));
});

const sectionsWithLegacy = [
  { section: "OPERASIONAL", items: [{ to: "/bengkel/production-v2", label: "Rencana Produksi" }] },
  {
    section: "LEGACY (ADMIN)",
    adminOnly: true,
    items: [
      { to: "/bengkel", label: "Papan Produksi (lama)" },
      { to: "/bengkel/planning", label: "Rencana Produksi (lama)" },
    ],
  },
  {
    section: "CAMPURAN",
    items: [
      { to: "/bengkel/work-centers", label: "Work Center" },
      { to: "/bengkel/qc", label: "Inspeksi QC (lama)", adminOnly: true },
    ],
  },
];

test("visibleSections: section adminOnly disembunyikan total untuk non-admin", () => {
  const out = visibleSections(sectionsWithLegacy, false);
  assert.ok(!out.some((s) => s.section === "LEGACY (ADMIN)"));
});

test("visibleSections: section adminOnly muncul untuk admin, dengan seluruh isinya", () => {
  const out = visibleSections(sectionsWithLegacy, true);
  const legacy = out.find((s) => s.section === "LEGACY (ADMIN)");
  assert.equal(legacy.items.length, 2);
});

test("visibleSections: item adminOnly di dalam section biasa disembunyikan untuk non-admin, section itu sendiri tetap ada", () => {
  const out = visibleSections(sectionsWithLegacy, false);
  const campuran = out.find((s) => s.section === "CAMPURAN");
  assert.ok(campuran);
  assert.equal(campuran.items.length, 1);
  assert.equal(campuran.items[0].to, "/bengkel/work-centers");
});

test("visibleSections: rute lama TIDAK PERNAH dihapus dari data, hanya disembunyikan dari tampilan non-admin", () => {
  // P8.1 aturan keras: "jangan hapus route atau kode legacy" — dibuktikan di
  // sini pada level DATA (input sectionsWithLegacy tetap utuh setelah dipanggil).
  visibleSections(sectionsWithLegacy, false);
  const legacySection = sectionsWithLegacy.find((s) => s.section === "LEGACY (ADMIN)");
  assert.equal(legacySection.items.length, 2);
});
