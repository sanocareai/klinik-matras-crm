import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function parseArgs(argv = process.argv.slice(2)) {
  const result = { positional: [] };
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      result.positional.push(arg);
      continue;
    }
    const [rawKey, ...rest] = arg.slice(2).split("=");
    result[rawKey] = rest.length ? rest.join("=") : true;
  }
  return result;
}

export function stableValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function checksum(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

export function jsonForOutput(value) {
  return JSON.stringify(stableValue(value), null, 2);
}

export function writeReport(outputPath, report) {
  if (!outputPath) return;
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${jsonForOutput(report)}\n`, "utf8");
  console.error(`[v2-report] ${resolved}`);
}

export function dateOnly(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

export function requireApplyConfirmation(args) {
  if (!args.apply) return false;
  if (process.env.ALLOW_V2_BACKFILL_APPLY !== "YES") {
    throw new Error("Mode apply ditolak. Set ALLOW_V2_BACKFILL_APPLY=YES secara eksplisit setelah dry-run diperiksa.");
  }
  return true;
}

export function databaseIdentity(databaseUrl = process.env.DATABASE_URL) {
  const url = new URL(databaseUrl);
  return { host: url.hostname, port: url.port || "5432", database: url.pathname.replace(/^\//, "") };
}

export function assertSafeTestDatabase(databaseUrl = process.env.DATABASE_URL) {
  const identity = databaseIdentity(databaseUrl);
  if (!/(test|scratch)/i.test(identity.database)) {
    throw new Error(`Operasi rehearsal ditolak untuk database non-test: ${identity.database}`);
  }
  return identity;
}
