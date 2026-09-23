#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { ensureV2Flags, loadV2Flags } from "../../src/services/v2FeatureFlags.js";
import { jsonForOutput } from "./common.js";

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction((tx) => ensureV2Flags(tx));
  const flags = await loadV2Flags(prisma);
  const unexpectedlyEnabled = Object.values(flags).filter((flag) => flag.enabled);
  if (unexpectedlyEnabled.length) throw new Error(`Flag V2 tidak boleh aktif saat seed Chunk 0: ${unexpectedlyEnabled.map((f) => f.key).join(", ")}`);
  console.log(jsonForOutput({ ok: true, flags }));
}

main().catch((error) => {
  console.error("[v2-feature-flags] GAGAL:", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
