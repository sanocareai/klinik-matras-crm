import { AccessDeniedError, assertControlAccess } from "./rbac.js";

const USER_KEY = "session:user";

// Sesi Control: login -> baca capabilities dari server -> tolak bila tidak
// berhak. Token yang sudah terlanjur tersimpan DIHAPUS bila akun ditolak, supaya
// akun Driver yang salah membuka aplikasi ini tidak meninggalkan sesi.
export function createSessionManager({ client, storage }) {
  async function readCache() {
    try { return JSON.parse((await storage.getItem(USER_KEY)) || "null"); } catch { return null; }
  }
  async function writeCache(v) {
    try {
      if (v) await storage.setItem(USER_KEY, JSON.stringify(v));
      else await storage.removeItem(USER_KEY);
    } catch {}
  }

  // Gerbang di SERVER: GET /delivery-control/session dijaga izin delivery:control:access.
  // 403 = akun tidak berhak (mis. Driver/Helper/Leader Driver) -> AccessDeniedError.
  async function loadMe() {
    let me;
    try {
      me = await client.request("/delivery-control/session");
    } catch (err) {
      if (err.status === 403) throw new AccessDeniedError();
      throw err;
    }
    const capabilities = me.capabilities || null;
    assertControlAccess(capabilities);
    return { user: me, capabilities };
  }

  return {
    async signIn(email, password) {
      const res = await client.request("/auth/login", { method: "POST", body: { email, password } });
      await client.setToken(res.token);
      try {
        const session = await loadMe();
        await writeCache(session);
        return session;
      } catch (err) {
        await client.setToken(null);
        await writeCache(null);
        throw err;
      }
    },
    // Dipanggil saat aplikasi dibuka. Capabilities SELALU diambil ulang dari
    // server; cache dipakai hanya bila server tidak terjangkau (bukan 401/akses ditolak).
    async restore() {
      const token = await client.restoreToken();
      if (!token) return null;
      try {
        const session = await loadMe();
        await writeCache(session);
        return session;
      } catch (err) {
        if (err.name === "AccessDeniedError" || err.status === 401) {
          await client.setToken(null);
          await writeCache(null);
          return null;
        }
        const cached = await readCache();
        return cached ? { ...cached, offline: true } : null;
      }
    },
    async signOut() {
      await client.setToken(null);
      await writeCache(null);
    },
  };
}
