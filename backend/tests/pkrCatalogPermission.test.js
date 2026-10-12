// Izin khusus katalog item PKR (keputusan Owner, Okt 2026): pkr_catalog:manage dipegang Owner/Admin (yang juga memegang finance:admin dan production_settings:write — "Finance Admin"
// dan "Production Admin" bukan peran terpisah di sistem ini). Peran biasa hanya membaca/memilih katalog (finance:read di form PKR). SENGAJA bukan production_settings:write.
import test from "node:test";
import assert from "node:assert/strict";
import { PERMISSIONS as P, ROLE_PERMISSIONS } from "../src/constants/permissions.js";
import { hasPermission } from "../src/middleware/authorize.js";

test("pkr_catalog:manage: hanya ADMIN & OWNER; peran lain (Sales, Finance, Produksi, QC, Gudang, Dispatcher, Driver, dst) tidak", () => {
  assert.equal(P.PKR_CATALOG_MANAGE, "pkr_catalog:manage");
  const pemegang = Object.entries(ROLE_PERMISSIONS).filter(([, perms]) => perms.includes(P.PKR_CATALOG_MANAGE)).map(([r]) => r).sort();
  assert.deepEqual(pemegang, ["ADMIN", "OWNER"]);
});

test("izin katalog tidak bocor lewat izin lain: memegang production_settings:write atau finance:admin TANPA peran Admin/Owner tidak memberi pkr_catalog:manage", () => {
  // Setiap peran yang memegang izin pengaturan/finansial admin harus juga ADMIN/OWNER — dan sebaliknya izin katalog tidak diturunkan implisit.
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    if (perms.includes(P.PKR_CATALOG_MANAGE)) assert.ok(["ADMIN", "OWNER"].includes(role), `peran ${role} tidak boleh memegang pkr_catalog:manage`);
  }
  assert.equal(hasPermission({ roles: ["FINANCE"] }, P.PKR_CATALOG_MANAGE), false);
  assert.equal(hasPermission({ roles: ["PRODUCTION_LEAD"] }, P.PKR_CATALOG_MANAGE), false);
  assert.equal(hasPermission({ roles: ["SALES"] }, P.PKR_CATALOG_MANAGE), false);
  // multi-peran bersifat aditif: Finance + Admin = boleh
  assert.equal(hasPermission({ roles: ["FINANCE", "ADMIN"] }, P.PKR_CATALOG_MANAGE), true);
  assert.equal(hasPermission({ roles: ["OWNER"] }, P.PKR_CATALOG_MANAGE), true);
});

test("peran biasa tetap bisa MEMBACA/MEMILIH katalog lewat izin finance:read/finance:post (form PKR), tanpa izin kelola", () => {
  assert.ok(ROLE_PERMISSIONS.FINANCE.includes(P.FINANCE_READ));
  assert.ok(ROLE_PERMISSIONS.FINANCE.includes(P.FINANCE_POST));
  assert.equal(ROLE_PERMISSIONS.FINANCE.includes(P.PKR_CATALOG_MANAGE), false);
});
