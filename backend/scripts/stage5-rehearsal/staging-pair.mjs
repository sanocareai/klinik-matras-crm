// Sementara — rehearsal staging Tahap 5. Penjaga PASANGAN database staging
// (SANSS + HUB). Fixture kedua sisi dicari berdasarkan judul/nama (idempoten),
// jadi pasangan yang setengah di-reset diam-diam menempelkan fixture lama ke
// pengguna lama. Skrip ini menolak pasangan seperti itu SEBELUM run dimulai.
//
//   node staging-pair.mjs check <SANSS_DB_URL> <HUB_DB_URL> <HUB_DIR>
//     RESULT:{"state":"fresh"}   kedua DB belum ada  -> run membuat & menandai
//     RESULT:{"state":"paired"}  kedua DB ada, penanda sama, konsisten
//     exit 2 + alasan            selain itu (run DITOLAK)
//   node staging-pair.mjs mark  <SANSS_DB_URL> <HUB_DB_URL>
//     memasang penanda pasangan yang sama di kedua DB (hanya pada DB yang belum bertanda)
//   node staging-pair.mjs reset <SANSS_DB_URL> <HUB_DB_URL>
//     menghapus HANYA DB yang memuat penanda "stage5-pair:" (DB tanpa penanda tidak pernah dihapus)
//
// Penanda = COMMENT ON DATABASE (tanpa perubahan skema aplikasi).
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MARK = "stage5-pair:";
const [cmd, sanssUrl, hubUrl, hubDir] = process.argv.slice(2);

function target(raw, label) {
  const u = new URL(raw);
  if (!["localhost", "127.0.0.1"].includes(u.hostname)) throw new Error(`refuse: ${label} bukan loopback`);
  const name = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("staging")) throw new Error(`refuse: nama DB ${label} harus mengandung 'staging'`);
  const admin = new URL(raw);
  admin.pathname = "/postgres";
  admin.search = "";
  const db = new URL(raw);
  db.search = "";
  return { label, name, adminUrl: admin.toString(), dbUrl: db.toString() };
}

async function withClient(url, fn) {
  const c = new PrismaClient({ datasources: { db: { url } }, log: [] });
  try { return await fn(c); } finally { await c.$disconnect(); }
}

async function info(t) {
  return withClient(t.adminUrl, async (c) => {
    const rows = await c.$queryRawUnsafe(
      `SELECT shobj_description(d.oid, 'pg_database') AS comment FROM pg_database d WHERE d.datname = $1`, t.name);
    return rows.length ? { exists: true, comment: rows[0].comment ?? null } : { exists: false, comment: null };
  });
}

function refuse(reason) {
  process.stdout.write("RESULT:" + JSON.stringify({ state: "refused", reason }) + "\n");
  console.error(`[staging-pair] DITOLAK: ${reason}\n  Pulihkan dengan: STAGE5_RESET_STAGING=1 (hanya DB bertanda ${MARK}* yang dihapus), atau hapus manual bila DB tidak bertanda.`);
  process.exit(2);
}

function migrationDirs(dir) {
  return new Set(fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
}

async function hasTable(c, name) {
  return (await c.$queryRawUnsafe(`SELECT to_regclass($1) IS NOT NULL AS ok`, name))[0].ok === true;
}

// DB yang baru dibuat (belum bermigrasi) belum punya tabel: itu "belum ada isi", bukan galat.
async function appliedMigrations(t) {
  return withClient(t.dbUrl, async (c) => {
    if (!(await hasTable(c, "public._prisma_migrations"))) return [];
    const rows = await c.$queryRawUnsafe(`SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL`);
    return rows.map((r) => r.migration_name);
  });
}

async function check() {
  const s = target(sanssUrl, "SANSS"), h = target(hubUrl, "HUB");
  const [si, hi] = [await info(s), await info(h)];
  if (!si.exists && !hi.exists) return { state: "fresh" };
  if (si.exists !== hi.exists) refuse(`hanya ${si.exists ? "SANSS" : "HUB"} yang ada (${si.exists ? s.name : h.name}) — pasangan tidak lengkap`);
  if (!si.comment?.startsWith(MARK) || !hi.comment?.startsWith(MARK)) refuse(`DB tanpa penanda pasangan (${!si.comment?.startsWith(MARK) ? s.name : h.name}) — asal-usulnya tidak bisa dibuktikan`);
  if (si.comment !== hi.comment) refuse(`penanda berbeda: ${s.name}=${si.comment} vs ${h.name}=${hi.comment}`);

  const sanssDir = path.resolve(import.meta.dirname, "../../prisma/migrations");
  const hubMigDir = path.join(hubDir, "prisma", "migrations");
  for (const [t, dir] of [[s, sanssDir], [h, hubMigDir]]) {
    const known = migrationDirs(dir);
    const asing = (await appliedMigrations(t)).filter((m) => !known.has(m));
    if (asing.length) refuse(`${t.name} memuat migrasi yang tidak ada di repo ini (${asing.slice(0, 3).join(", ")}) — DB dari kode lain/nama lama`);
  }

  const users = new Set(await withClient(s.dbUrl, async (c) =>
    (await hasTable(c, 'public."User"')) ? (await c.$queryRawUnsafe(`SELECT id FROM "User"`)).map((r) => r.id) : []));
  const ids = await withClient(h.dbUrl, async (c) =>
    (await hasTable(c, "public.external_identities"))
      ? (await c.$queryRawUnsafe(`SELECT "externalId" AS id FROM external_identities WHERE provider::text = 'SANS_SSO'`)).map((r) => r.id)
      : []);
  const yatim = ids.filter((id) => !users.has(id));
  if (yatim.length) refuse(`${yatim.length} identitas SSO di ${h.name} menunjuk pengguna yang tidak ada di ${s.name} — fixture HUB menempel ke pengguna lama`);
  return { state: "paired", pair: si.comment.slice(MARK.length) };
}

async function mark() {
  const s = target(sanssUrl, "SANSS"), h = target(hubUrl, "HUB");
  const [si, hi] = [await info(s), await info(h)];
  if (!si.exists || !hi.exists) throw new Error("mark: kedua DB harus sudah ada");
  if (si.comment?.startsWith(MARK) || hi.comment?.startsWith(MARK)) throw new Error("mark: DB sudah bertanda — tidak ditimpa");
  const id = `${MARK}${crypto.randomUUID()}`;
  for (const t of [s, h]) await withClient(t.adminUrl, (c) => c.$executeRawUnsafe(`COMMENT ON DATABASE "${t.name}" IS '${id}'`));
  return { state: "marked", pair: id.slice(MARK.length) };
}

async function reset() {
  const out = [];
  for (const t of [target(sanssUrl, "SANSS"), target(hubUrl, "HUB")]) {
    const i = await info(t);
    if (!i.exists) { out.push(`${t.name}: tidak ada`); continue; }
    if (!i.comment?.startsWith(MARK)) { out.push(`${t.name}: TIDAK dihapus (tanpa penanda ${MARK})`); continue; }
    await withClient(t.adminUrl, (c) => c.$executeRawUnsafe(`DROP DATABASE "${t.name}" WITH (FORCE)`));
    out.push(`${t.name}: dihapus (${i.comment})`);
  }
  return { state: "reset", detail: out };
}

const fns = { check, mark, reset };
if (!fns[cmd] || !sanssUrl || !hubUrl || (cmd === "check" && !hubDir)) {
  console.error("usage: staging-pair.mjs check|mark|reset <SANSS_DB_URL> <HUB_DB_URL> [HUB_DIR]");
  process.exit(1);
}
process.stdout.write("RESULT:" + JSON.stringify(await fns[cmd]()) + "\n");
