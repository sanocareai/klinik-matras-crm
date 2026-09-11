import "./env.js"; // urutan WAJIB pertama
import jwt from "jsonwebtoken";
import { testPrisma } from "./testDb.js";

let counter = 0;
/** Sufiks unik per fixture dalam satu proses test — hindari bentrok unique constraint (code/unitCode/email) antar test tanpa harus randomize UUID di setiap pemanggilan. */
function uniq(prefix) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

/**
 * User TES + token JWT yang valid untuk memanggil endpoint asli lewat
 * testApp.js. roles ditaruh LANGSUNG di klaim token (persis bentuk yang
 * dibuat routes/auth.js#login: { id, name, role, roles }) — requireAuth
 * cuma verifikasi tanda tangan lalu pakai payload apa adanya (lihat
 * middleware/authorize.js#rolesOf), TIDAK query DB ulang untuk role, jadi
 * ini setara dengan token asli tanpa perlu login sungguhan.
 *
 * User row TETAP dibuat di DB (bukan cuma token) karena createdById/
 * requestedById/dst adalah FK sungguhan ke tabel User — token tanpa baris
 * User akan gagal dengan foreign key violation begitu route mencoba
 * menulis createdById.
 */
export async function createTestUser({ roles = ["WAREHOUSE"] } = {}) {
  const email = `${uniq("test-user")}@example.test`;
  const user = await testPrisma.user.create({
    data: { name: "Test Warehouse User", email, passwordHash: "x", role: roles[0] },
  });
  const token = jwt.sign(
    { id: user.id, name: user.name, role: roles[0], roles },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { user, token };
}

export async function createTestMaterial(overrides = {}) {
  return testPrisma.material.create({
    data: {
      code: uniq("MAT"),
      name: overrides.name || "Material Tes",
      unit: overrides.unit || "PCS",
      category: overrides.category || "RAW_MATERIAL",
      active: overrides.active ?? true,
      ...overrides,
    },
  });
}

/** Customer -> Order -> Unit minimal, untuk test integrasi Produksi<->Gudang (MaterialIssue.unitId). */
export async function createTestUnit(overrides = {}) {
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Tes" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0 } });
  const unit = await testPrisma.unit.create({
    data: { unitCode: uniq("UNIT"), orderId: order.id, seq: 1, ...overrides },
  });
  return { customer, order, unit };
}

/** Baris ledger langsung (bypass postStockMovement) — dipakai untuk MENYIAPKAN saldo awal sebelum sebuah test, bukan untuk menguji jalur tulis (itu tugas postStockMovement sendiri). */
export async function seedBalance(materialId, qty, extra = {}) {
  return testPrisma.stockMovement.create({
    data: { materialId, type: qty >= 0 ? "RECEIPT" : "ADJUSTMENT", qty, note: "seed fixture", ...extra },
  });
}
