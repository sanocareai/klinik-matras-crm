// SSO Task & Meeting (D-200) — tes MURNI (tanpa database, tanpa HTTP):
// konfigurasi fail-closed, allow-list tujuan (open redirect), kode & hash,
// token layanan, deteksi permintaan internal, dan pemetaan peran default-deny.
// Alur dengan DB (replay, expiry, pengguna nonaktif, migrasi) ada di
// tests/integration/hubSso.integration.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDOFF_TTL_SECONDS,
  hashHandoffCode,
  hubRoleFor,
  hubSsoConfig,
  isInternalRequest,
  isPrivateHost,
  isWellFormedCode,
  isWellFormedStateHash,
  newHandoffCode,
  normalizeRevokeReason,
  resolveDestination,
  safeEqualToken,
} from "../src/lib/domain/hubSso.js";
import { ALL_ROLES, PERMISSIONS as P, PORTALS, ROLE_PERMISSIONS } from "../src/constants/permissions.js";
import { capabilitiesFor } from "../src/services/capabilities.js";

const TOKEN = "t".repeat(40);
const INTERNAL = "http://127.0.0.1:3100";
const okEnv = {
  HUB_SSO_ENABLED: "true",
  HUB_BASE_URL: "https://hub.sanomatrassehat.com",
  HUB_INTERNAL_URL: INTERNAL,
  HUB_SERVICE_TOKEN: TOKEN,
  JWT_SECRET: "jwt-secret-yang-lain",
};

// ─── Konfigurasi ────────────────────────────────────────────────────────────

test("konfigurasi: mati secara default dan untuk nilai selain PERSIS 'true'", () => {
  for (const v of [undefined, "", "false", "TRUE", "True", "1", "yes", "on", " true", "true "]) {
    const c = hubSsoConfig({ ...okEnv, HUB_SSO_ENABLED: v });
    assert.equal(c.enabled, false, `HUB_SSO_ENABLED=${JSON.stringify(v)}`);
    assert.equal(c.ready, false);
    assert.equal(c.baseUrl, null);
    assert.equal(c.serviceToken, null);
  }
  assert.equal(hubSsoConfig({}).enabled, false);
});

test("konfigurasi: valid → ready, baseUrl & hubInternalUrl dinormalkan ke origin", () => {
  const c = hubSsoConfig(okEnv);
  assert.deepEqual([c.enabled, c.ready, c.baseUrl, c.hubInternalUrl, c.serviceToken], [true, true, "https://hub.sanomatrassehat.com", INTERNAL, TOKEN]);
  assert.equal(hubSsoConfig({ ...okEnv, HUB_BASE_URL: "https://hub.sanomatrassehat.com/" }).baseUrl, "https://hub.sanomatrassehat.com");
  assert.equal(hubSsoConfig({ ...okEnv, HUB_BASE_URL: "  https://hub.example.com  " }).baseUrl, "https://hub.example.com");
  assert.equal(hubSsoConfig({ ...okEnv, HUB_BASE_URL: "http://localhost:3100" }).baseUrl, "http://localhost:3100");
  assert.equal(hubSsoConfig({ ...okEnv, HUB_BASE_URL: "http://127.0.0.1:3100" }).ready, true);
});

// Same-domain embedding (Okt 2026) — HUB_BASE_URL/HUB_INTERNAL_URL boleh
// punya path dasar sederhana (basePath Next.js HUB, mis. "/workspace"),
// bukan cuma origin polos. Lihat BASE_PATH_PATTERN di hubSso.js.
test("konfigurasi: HUB_BASE_URL/HUB_INTERNAL_URL dengan path dasar sederhana → ready, path dipertahankan", () => {
  assert.equal(hubSsoConfig({ ...okEnv, HUB_BASE_URL: "https://app.sanomatrassehat.com/workspace" }).baseUrl, "https://app.sanomatrassehat.com/workspace");
  assert.equal(hubSsoConfig({ ...okEnv, HUB_INTERNAL_URL: "http://127.0.0.1:3100/workspace" }).hubInternalUrl, "http://127.0.0.1:3100/workspace");
  assert.equal(hubSsoConfig({ ...okEnv, HUB_BASE_URL: "https://app.sanomatrassehat.com/a/b" }).ready, true);
});

test("konfigurasi: HUB_BASE_URL cacat → tidak ready (enabled tapi ditolak)", () => {
  for (const bad of [undefined, "", "   ", "hub.example.com", "not a url", "http://hub.example.com", "ftp://hub.example.com",
    "https://user:pw@hub.example.com", "https://hub.example.com/app/", "https://hub.example.com//app", "https://hub.example.com/app.x",
    "https://hub.example.com/?x=1", "https://hub.example.com/app?x=1", "https://hub.example.com/#f", "javascript:alert(1)"]) {
    const c = hubSsoConfig({ ...okEnv, HUB_BASE_URL: bad });
    assert.equal(c.enabled, true, `enabled untuk ${bad}`);
    assert.equal(c.ready, false, `ready untuk ${JSON.stringify(bad)}`);
    assert.equal(c.baseUrl, null);
    assert.ok(c.problems.length >= 1);
  }
});

// D-200 tahap 4 — HUB_INTERNAL_URL: alamat SANSS memanggil POST /api/sso/revoke.
// Arah TERBALIK dari HUB_BASE_URL (yang boleh publik, dipakai membangun
// postUrl); ini WAJIB privat, sama seperti SANSS_INTERNAL_URL di sisi HUB.
test("konfigurasi: HUB_INTERNAL_URL cacat atau publik → tidak ready", () => {
  for (const bad of [undefined, "", "https://app.sanomatrassehat.com", "http://43.133.152.6:4000", "http://172.32.0.1:4000",
    "http://127.0.0.1:4000/api/", "http://127.0.0.1:4000/api?x=1", "http://u:p@127.0.0.1:4000", "not a url"]) {
    const c = hubSsoConfig({ ...okEnv, HUB_INTERNAL_URL: bad });
    assert.equal(c.ready, false, JSON.stringify(bad));
    assert.equal(c.hubInternalUrl, null);
  }
});
test("konfigurasi: HUB_INTERNAL_URL privat/loopback dalam berbagai bentuk → ready", () => {
  for (const good of ["http://127.0.0.1:3100", "http://localhost:3100", "http://10.20.30.40:3100", "http://hub-service:3100", "http://127.0.0.1:3100/workspace"]) {
    assert.equal(hubSsoConfig({ ...okEnv, HUB_INTERNAL_URL: good }).ready, true, good);
  }
});

test("isPrivateHost: loopback/RFC1918/link-local/ULA/localhost/nama-satu-label = privat", () => {
  for (const h of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.1.1", "localhost", "hub-service",
    "host.docker.internal", "foo.localhost", "[::1]", "::1", "fd12:3456::1", "fe80::1"]) {
    assert.equal(isPrivateHost(h), true, h);
  }
});
test("isPrivateHost: domain/IP publik BUKAN privat", () => {
  for (const h of ["8.8.8.8", "43.133.152.6", "172.32.0.1", "172.15.0.1", "example.com", "app.sanomatrassehat.com", "2001:db8::1"]) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

test("isWellFormedStateHash: SHA-256 hex (64 karakter heksadesimal kecil) saja yang sah", () => {
  assert.equal(isWellFormedStateHash("a".repeat(64)), true);
  assert.equal(isWellFormedStateHash("0123456789abcdef".repeat(4)), true);
  for (const bad of [undefined, null, "", "A".repeat(64), "g".repeat(64), "a".repeat(63), "a".repeat(65), 12345, {}, [], "a".repeat(43)]) {
    assert.equal(isWellFormedStateHash(bad), false, JSON.stringify(bad));
  }
});

test("konfigurasi: token layanan pendek, kosong, atau sama dengan JWT_SECRET → tidak ready", () => {
  for (const bad of [undefined, "", "pendek", "x".repeat(31)]) {
    assert.equal(hubSsoConfig({ ...okEnv, HUB_SERVICE_TOKEN: bad }).ready, false, JSON.stringify(bad));
  }
  const same = hubSsoConfig({ ...okEnv, JWT_SECRET: TOKEN });
  assert.equal(same.ready, false);
  assert.match(same.problems.join(" "), /JWT_SECRET/);
  assert.equal(same.serviceToken, null, "token tidak dibocorkan ke objek konfigurasi yang tidak ready");
});

test("konfigurasi: HUB_BASE_URL hanya dari env — bentuk hasilnya tidak bergantung input lain", () => {
  const a = hubSsoConfig(okEnv);
  const b = hubSsoConfig({ ...okEnv, HOST: "evil.example", ORIGIN: "https://evil.example" });
  assert.equal(a.baseUrl, b.baseUrl);
});

// ─── Token layanan & permintaan internal ────────────────────────────────────

test("safeEqualToken: hanya cocok persis; tipe/kosong/panjang berbeda ditolak", () => {
  assert.equal(safeEqualToken(TOKEN, TOKEN), true);
  assert.equal(safeEqualToken(TOKEN + "x", TOKEN), false);
  assert.equal(safeEqualToken(TOKEN.slice(0, -1), TOKEN), false);
  assert.equal(safeEqualToken("", TOKEN), false);
  assert.equal(safeEqualToken(undefined, TOKEN), false);
  assert.equal(safeEqualToken(null, TOKEN), false);
  assert.equal(safeEqualToken(["a"], TOKEN), false);
  assert.equal(safeEqualToken(TOKEN, ""), false, "expected kosong tidak boleh cocok dengan apa pun");
  assert.equal(safeEqualToken("", ""), false);
});

const req = (addr, headers = {}) => ({ socket: { remoteAddress: addr }, headers });

test("isInternalRequest: soket privat/loopback tanpa jejak proxy = internal", () => {
  for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "10.0.0.5", "192.168.1.9", "172.17.0.1", "172.31.255.254", "::ffff:172.18.0.1"]) {
    assert.equal(isInternalRequest(req(a)), true, a);
  }
});

test("isInternalRequest: soket publik atau jejak proxy = bukan internal", () => {
  for (const a of ["8.8.8.8", "43.133.152.6", "172.32.0.1", "172.15.0.1", "", undefined]) {
    assert.equal(isInternalRequest(req(a)), false, String(a));
  }
  for (const h of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded", "via"]) {
    assert.equal(isInternalRequest(req("127.0.0.1", { [h]: "1.2.3.4" })), false, `header ${h}`);
  }
});

// ─── Tujuan (allow-list) ────────────────────────────────────────────────────

test("tujuan: kosong/tak ada = '/'", () => {
  for (const v of [undefined, null, ""]) assert.equal(resolveDestination(v), "/");
});

test("tujuan: halaman yang dikenal lolos persis apa adanya", () => {
  for (const ok of ["/", "/meetings", "/meetings/action-item-saya", "/my-tasks", "/inbox", "/dashboard", "/goals", "/dashboards",
    "/meetings/cmui7f3rd00075wpzv6906lit", "/projects/cmrocu6kq000kf4wdbrrupgqt/board", "/projects/cmrocu6kq000kf4wdbrrupgqt/list"]) {
    assert.equal(resolveDestination(ok), ok, ok);
  }
});

test("tujuan: SEMUA bentuk open-redirect dan jalur liar ditolak", () => {
  const evil = [
    "//evil.com", "//evil.com/meetings", "/\\evil.com", "\\\\evil.com", "\\evil.com", "/\\/evil.com",
    "https://evil.com", "http://evil.com", "HTTPS://EVIL.COM", "javascript:alert(1)", "data:text/html,x", "evil.com", "//",
    "/%2F%2Fevil.com", "/%2fevil.com", "%2F%2Fevil.com", "/meetings%2F..%2Fadmin", "/meetings/..", "/meetings/../admin", "/../etc/passwd",
    "/meetings?next=https://evil.com", "/meetings?x=1", "/meetings#frag", "/meetings/", "/meetings//x", "/Meetings", "/MEETINGS",
    "/meetings/abc", "/meetings/" + "a".repeat(65), "/meetings/id with space", "/meetings/id\nnewline", "/meetings/id\ttab", "/meetings/x\u0000y00000",
    "/projects/short/board", "/projects/cmrocu6kq000kf4wdbrrupgqt", "/projects/cmrocu6kq000kf4wdbrrupgqt/settings", "/projects/cmrocu6kq000kf4wdbrrupgqt/board/extra",
    "/api/auth/signout", "/api/mcp", "/login", "/onboarding", "/no-access", "/settings", "/reports/dashboard", "/ ", " /", "/‮evil",
    "/" + "a".repeat(300),
  ];
  for (const e of evil) assert.equal(resolveDestination(e), null, JSON.stringify(e));
  for (const t of [1, 0, true, false, {}, [], ["/meetings"], () => "/", Symbol("x")]) {
    assert.equal(resolveDestination(t), null, `tipe ${typeof t}`);
  }
});

// ─── Kode ───────────────────────────────────────────────────────────────────

test("kode: 256-bit acak (43 karakter base64url), unik, dan bentuknya tervalidasi", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = newHandoffCode();
    assert.equal(c.length, 43);
    assert.match(c, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(c, "base64url").length, 32, "32 byte = 256 bit");
    assert.ok(isWellFormedCode(c));
    seen.add(c);
  }
  assert.equal(seen.size, 2000);
});

test("kode: bentuk cacat ditolak sebelum menyentuh DB", () => {
  for (const bad of [undefined, null, "", "abc", "a".repeat(42), "a".repeat(44), "a".repeat(42) + "=", "a".repeat(42) + "+", "a".repeat(42) + " ", 12345, {}, [], "'; DROP TABLE hub_handoffs;--" + "a".repeat(20)]) {
    assert.equal(isWellFormedCode(bad), false, JSON.stringify(bad));
  }
});

test("hash kode: SHA-256 heksadesimal, deterministik, dan tidak memuat kodenya", () => {
  const c = newHandoffCode();
  const h = hashHandoffCode(c);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashHandoffCode(c));
  assert.notEqual(h, hashHandoffCode(newHandoffCode()));
  assert.ok(!h.includes(c) && !c.includes(h));
  // vektor tetap SHA-256("abc") supaya algoritmanya tidak diam-diam berubah
  assert.equal(hashHandoffCode("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("umur kode tetap 60 detik dan alasan pencabutan dinormalkan", () => {
  assert.equal(HANDOFF_TTL_SECONDS, 60);
  assert.equal(normalizeRevokeReason("logout"), "logout");
  assert.equal(normalizeRevokeReason("deactivated"), "deactivated");
  for (const x of ["<script>", "", undefined, null, 5, "LOGOUT"]) assert.equal(normalizeRevokeReason(x), "other");
});

// ─── Peran & permission (default deny) ──────────────────────────────────────

test("permission HUB_ACCESS / HUB_ADMIN terdaftar", () => {
  assert.equal(P.HUB_ACCESS, "hub:access");
  assert.equal(P.HUB_ADMIN, "hub:admin");
});

test("pemetaan awal: HANYA ADMIN dan OWNER yang memegang HUB_ACCESS/HUB_ADMIN — semua role lain ditolak", () => {
  const holders = (perm) => Object.entries(ROLE_PERMISSIONS).filter(([, ps]) => ps.includes(perm)).map(([r]) => r).sort();
  assert.deepEqual(holders(P.HUB_ACCESS), ["ADMIN", "OWNER"]);
  assert.deepEqual(holders(P.HUB_ADMIN), ["ADMIN", "OWNER"]);
});

test("hubRoleFor: OWNER→OWNER, ADMIN→ADMIN, SEMUA role lain (satu per satu) → null", () => {
  assert.equal(hubRoleFor({ roles: ["OWNER"] }), "OWNER");
  assert.equal(hubRoleFor({ roles: ["ADMIN"] }), "ADMIN");
  assert.equal(hubRoleFor({ roles: ["ADMIN", "OWNER"] }), "OWNER");
  assert.equal(hubRoleFor({ role: "ADMIN" }), "ADMIN", "fallback role tunggal (token lama)");
  for (const role of ALL_ROLES.filter((r) => r !== "ADMIN" && r !== "OWNER")) {
    assert.equal(hubRoleFor({ roles: [role] }), null, `role ${role}`);
    assert.equal(hubRoleFor({ role }), null, `role tunggal ${role}`);
  }
  assert.ok(ALL_ROLES.length >= 12, "enumerasi role benar-benar terjadi");
});

test("hubRoleFor: kombinasi role non-admin tetap tanpa akses; tanpa role/role asing → null", () => {
  assert.equal(hubRoleFor({ roles: ["SALES", "FINANCE", "DRIVER", "PRODUCTION_LEAD"] }), null);
  assert.equal(hubRoleFor({ roles: ["SALES", "ADMIN"] }), "ADMIN", "aditif: satu role admin cukup");
  for (const u of [null, undefined, {}, { roles: [] }, { roles: ["TIDAK_ADA"] }, { role: "HUB_ADMIN" }, { roles: ["hub:admin"] }]) {
    assert.equal(hubRoleFor(u), null, JSON.stringify(u));
  }
});

test("alur login TIDAK berubah: capabilities & portal SALES/DRIVER tidak memuat apa pun tentang HUB", () => {
  for (const role of ["SALES", "DRIVER", "FINANCE", "PRODUCTION_WORKER"]) {
    const caps = JSON.stringify(capabilitiesFor({ roles: [role], role }));
    assert.ok(!/hub/i.test(caps), `capabilities ${role} memuat 'hub'`);
  }
  assert.ok(!PORTALS.some((p) => /hub|task|meeting/i.test(`${p.key} ${p.label} ${p.path}`)), "belum ada kartu portal Task & Meeting");
  assert.ok(!Object.keys(capabilitiesFor({ roles: ["ADMIN"], role: "ADMIN" })).some((k) => /hub/i.test(k)));
});
