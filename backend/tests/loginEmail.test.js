// Login mencari akun dengan email apa adanya, padahal akun disimpan trim+huruf-kecil (routes/users.js): "Nama@x.com" → 401 walau
// password benar. cariUserUntukLogin mencoba bentuk persis-diketik DULU (perilaku lama tak berubah), lalu bentuk baku.
import test from "node:test";
import assert from "node:assert/strict";
import { kandidatEmailLogin, cariUserUntukLogin } from "../src/lib/loginEmail.js";

function prismaPalsu(rows) {
  const dicari = [];
  return {
    dicari,
    user: {
      async findUnique({ where }) {
        dicari.push(where.email);
        return rows.find((r) => r.email === where.email) || null;
      },
    },
  };
}

test("kandidat: persis-diketik dulu, lalu trim, lalu trim+huruf-kecil; tanpa duplikat", () => {
  assert.deepEqual(kandidatEmailLogin("nama@klinikmatras.com"), ["nama@klinikmatras.com"]);
  assert.deepEqual(kandidatEmailLogin("Nama@KlinikMatras.com"), ["Nama@KlinikMatras.com", "nama@klinikmatras.com"]);
  assert.deepEqual(kandidatEmailLogin("  nama@klinikmatras.com "), ["  nama@klinikmatras.com ", "nama@klinikmatras.com"]);
  assert.deepEqual(kandidatEmailLogin(" Nama@x.com"), [" Nama@x.com", "Nama@x.com", "nama@x.com"]);
});

test("masukan bukan string / kosong tidak menghasilkan kandidat (tidak pernah sampai ke Prisma)", () => {
  for (const v of [undefined, null, 123, {}, [], "", "   "]) assert.deepEqual(kandidatEmailLogin(v), [], String(v));
});

test("email berhuruf besar menemukan akun yang tersimpan huruf-kecil", async () => {
  const prisma = prismaPalsu([{ id: "u1", email: "nama@klinikmatras.com" }]);
  const user = await cariUserUntukLogin(prisma, "Nama@KlinikMatras.com");
  assert.equal(user?.id, "u1");
  assert.deepEqual(prisma.dicari, ["Nama@KlinikMatras.com", "nama@klinikmatras.com"]);
});

test("akun lama yang tersimpan berhuruf besar tetap ketemu lewat pencarian persis (perilaku lama dipertahankan, lebih dulu)", async () => {
  const prisma = prismaPalsu([{ id: "lama", email: "Nama@x.com" }, { id: "baku", email: "nama@x.com" }]);
  assert.equal((await cariUserUntukLogin(prisma, "Nama@x.com"))?.id, "lama");
  assert.equal((await cariUserUntukLogin(prisma, "nama@x.com"))?.id, "baku");
  assert.deepEqual(prisma.dicari, ["Nama@x.com", "nama@x.com"], "persis-diketik berhenti begitu ketemu");
});

test("email tak terdaftar → null; masukan non-string → null tanpa memanggil Prisma", async () => {
  const prisma = prismaPalsu([{ id: "u1", email: "a@b.c" }]);
  assert.equal(await cariUserUntukLogin(prisma, "x@y.z"), null);
  const sebelum = prisma.dicari.length;
  assert.equal(await cariUserUntukLogin(prisma, undefined), null);
  assert.equal(prisma.dicari.length, sebelum);
});
