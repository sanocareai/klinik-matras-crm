import "./env.js";
import bcrypt from "bcryptjs";
import { testPrisma } from "./testDb.js";

let n = 0;

/** User dengan password NYATA (untuk uji login) + baris user_roles untuk tiap role. */
export async function createLoginUser({ roles = ["FINANCE"], password = "Sandi-Uji-123", active = true } = {}) {
  n += 1;
  const email = `login-${Date.now()}-${n}@example.test`;
  const user = await testPrisma.user.create({
    data: { name: `Login Test ${n}`, email, passwordHash: bcrypt.hashSync(password, 4), role: roles[0], active },
  });
  await testPrisma.userRole.createMany({ data: roles.map((role) => ({ userId: user.id, role })), skipDuplicates: true });
  return { user, email, password };
}

/** fetch mentah yang mengembalikan status, header, dan body JSON. */
export function makeRaw(baseUrl) {
  return async function raw(method, path, { token, headers = {}, body } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* bukan JSON */ }
    return { status: res.status, headers: res.headers, body: json };
  };
}

export const DEVICE = (id = "device-a") => ({ id, label: "Pixel Uji", appVersion: "1.0.0", platform: "android" });
