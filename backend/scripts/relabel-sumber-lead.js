// Relabel sumber lead lama memakai aturan bukti terbaru (audit 9 Nov 2026).
//
//   node scripts/relabel-sumber-lead.js                  dry-run, tidak mengubah apa pun
//   node scripts/relabel-sumber-lead.js --apply --hash=<hash dry-run> --batch=<nama>
//
// Urutan bukti: clid > tag website > penanda CTWA > teks link TikTok > teks tombol
// website > teks template Meta > chat dimulai sales > tanpa bukti.
//
// Tidak disentuh: leadSourceConfirmed, sumber di luar 5 sumber kanal, lead tanpa
// pesan, dan lead ber-clid/bertag/ber-CTWA kecuali aturannya menetapkan lain.
// Lead yang hanya cocok klik menjadi WhatsApp Langsung dengan catatan "kemungkinan
// TikTok, belum terbukti", dan klik yang pernah dipasangkan ke lead tanpa bukti
// dilepas supaya konversi di Link Pelacakan ikut jujur.
//
// Jejak tersimpan di lead_source_relabels. Pembaruan memeriksa label saat ini
// masih sama dengan rencana, jadi perubahan manual di tengah jalan tidak tertimpa.
import { createHash } from "node:crypto";
import { prisma } from "../src/db.js";
import { DETAIL_DIMULAI_SALES } from "../src/services/leadAttribution.js";
import { TEKS_TOMBOL_WEBSITE_TETAP, PANJANG_MIN, MIN_KEMUNCULAN, normalisasi } from "../src/services/templateIklan.js";

const SUMBER_KANAL = new Set(["META_ADS", "GOOGLE_ADS", "TIKTOK_ADS", "WEBSITE_ORGANIC", "WHATSAPP_DIRECT"]);
const SELANG_MIN_DIMULAI_SALES_MS = 2 * 60 * 1000;
const DETAIL_KEMUNGKINAN_TIKTOK = "Kemungkinan TikTok, belum terbukti (hanya cocok klik)";
const DETAIL_TANPA_BUKTI = "Tanpa bukti sumber";
const DETAIL_WEBSITE = "Website - kanal tidak diketahui (tanpa tag, organik atau tag hilang)";

const tagWebsiteAsli = (det) => det.startsWith("Website - ") && !det.includes("retroaktif") && !det.includes("kanal tidak");
const awalan = (t, daftar) => daftar.find((x) => t.startsWith(x)) || null;

/**
 * Tentukan label baru satu lead. Fungsi murni supaya aturannya bisa diuji.
 * @returns {{aturan: string, sumber: string, detail: string|null}|null} null = tidak berubah
 */
export function nilaiLead(l, { teksTikTok, teksWebsite, teksMeta }) {
  const det = l.detail || "";
  if (l.dikonfirmasi || !SUMBER_KANAL.has(l.sumber)) return null;
  const hasil = (aturan, sumber, detail) => {
    if (sumber === l.sumber) return null;
    return { aturan, sumber, detail };
  };
  if (l.clid) return hasil("clid", "META_ADS", det.startsWith("Meta CTWA") ? det : "Meta CTWA");
  if (tagWebsiteAsli(det) || det.startsWith("Meta CTWA")) return null;
  if (!l.adaPesan) return null;

  const t = l.teks ? normalisasi(l.teks) : null;
  if (t) {
    const tiktok = awalan(t, teksTikTok);
    if (tiktok) return hasil("teks-tiktok", "TIKTOK_ADS", det || null);
    if (awalan(t, teksWebsite)) return hasil("teks-website", "WEBSITE_ORGANIC", DETAIL_WEBSITE);
    const meta = awalan(t, teksMeta);
    if (meta) return hasil("teks-meta", "META_ADS", `Meta Ads - template: "${meta.slice(0, 80)}" (pola pesan, CTWA tidak terbaca)`);
  }

  const dimulaiSales = l.arahPertama === "OUTBOUND" && !l.keluarSebelumCustomer
    && (l.selangMasukMs == null || Number(l.selangMasukMs) >= SELANG_MIN_DIMULAI_SALES_MS);
  if (dimulaiSales) return hasil("dimulai-sales", "OTHER", DETAIL_DIMULAI_SALES);
  if (!t) return null;
  if (l.adaKlik && l.sumber === "TIKTOK_ADS") return hasil("hanya-klik", "WHATSAPP_DIRECT", DETAIL_KEMUNGKINAN_TIKTOK);
  // Lapis ini hanya menurunkan label yang berasal dari tebakan. Meta/Google tanpa
  // bukti tetap apa adanya dan dilaporkan terpisah untuk ditinjau.
  if (l.sumber === "TIKTOK_ADS") return hasil("tanpa-bukti", "WHATSAPP_DIRECT", DETAIL_TANPA_BUKTI);
  return null;
}

async function muatLead() {
  return prisma.$queryRaw`
    SELECT c.id, c."createdAt" AS "dibuat", c."leadSource"::text AS sumber, c."leadSourceDetail" AS detail,
      c.ctwa_clid IS NOT NULL AS clid, c."leadSourceConfirmed" AS dikonfirmasi,
      k.cid IS NOT NULL AS "adaKlik", mf.direction IS NOT NULL AS "adaPesan", mf.direction::text AS "arahPertama",
      mi.content AS teks,
      mf."createdAt" < c."createdAt" - interval '1 minute' AS "keluarSebelumCustomer",
      (extract(epoch FROM mi."createdAt" - mf."createdAt") * 1000)::bigint AS "selangMasukMs"
    FROM "Customer" c
    LEFT JOIN (SELECT DISTINCT "matchedCustomerId" cid FROM "ClickEvent" WHERE "matchedCustomerId" IS NOT NULL) k ON k.cid = c.id
    LEFT JOIN LATERAL (SELECT id FROM "Conversation" WHERE "customerId" = c.id ORDER BY "createdAt" LIMIT 1) v ON true
    LEFT JOIN LATERAL (SELECT content, "createdAt" FROM "Message" WHERE "conversationId" = v.id AND direction = 'INBOUND' ORDER BY "createdAt" LIMIT 1) mi ON true
    LEFT JOIN LATERAL (SELECT direction, "createdAt" FROM "Message" WHERE "conversationId" = v.id ORDER BY "createdAt" LIMIT 1) mf ON true
  `;
}

async function muatTeksMeta(lead) {
  const hitung = new Map();
  for (const l of lead) {
    if (!l.clid || !l.teks) continue;
    const t = normalisasi(l.teks);
    if (t.length >= PANJANG_MIN) hitung.set(t, (hitung.get(t) || 0) + 1);
  }
  return [...hitung].filter(([t, n]) => n >= MIN_KEMUNCULAN && !awalan(t, TEKS_TOMBOL_WEBSITE_TETAP)).map(([t]) => t);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const ambil = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];

  const lead = await muatLead();
  const link = await prisma.trackedLink.findMany({ where: { category: "TIKTOK_ADS" }, select: { prefilledMessage: true } });
  const konteks = {
    teksTikTok: link.map((x) => normalisasi(x.prefilledMessage)).filter(Boolean),
    teksWebsite: TEKS_TOMBOL_WEBSITE_TETAP,
    teksMeta: await muatTeksMeta(lead),
  };

  const rencana = [];
  for (const l of lead) {
    const h = nilaiLead(l, konteks);
    if (h) rencana.push({ id: l.id, bulan: new Date(l.dibuat.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 7), sumberLama: l.sumber, detailLama: l.detail, ...h });
  }
  rencana.sort((a, b) => a.id.localeCompare(b.id));
  const hash = createHash("sha256")
    .update(rencana.map((r) => [r.id, r.sumberLama, r.sumber, r.aturan].join("|")).join("\n"))
    .digest("hex");

  const ringkas = {};
  for (const r of rencana) {
    const k = `${r.bulan} ${r.sumberLama} -> ${r.sumber} [${r.aturan}]`;
    ringkas[k] = (ringkas[k] || 0) + 1;
  }
  console.log(`Lead diperiksa: ${lead.length}; berubah: ${rencana.length}; hash: ${hash}`);
  for (const k of Object.keys(ringkas).sort()) console.log(`${String(ringkas[k]).padStart(5)}  ${k}`);

  if (!apply) {
    console.log("DRY-RUN: tidak ada yang diubah.");
    return;
  }
  const batch = ambil("batch");
  if (!batch || ambil("hash") !== hash) {
    throw new Error("--apply butuh --batch dan --hash yang sama dengan hasil dry-run terbaru");
  }

  let berubah = 0;
  for (const r of rencana) {
    await prisma.$transaction(async (tx) => {
      const n = await tx.customer.updateMany({
        where: { id: r.id, leadSource: r.sumberLama, leadSourceDetail: r.detailLama, leadSourceConfirmed: false },
        data: { leadSource: r.sumber, leadSourceDetail: r.detail },
      });
      if (n.count !== 1) return;
      const klik = r.sumberLama === "TIKTOK_ADS"
        ? await tx.clickEvent.findMany({ where: { matchedCustomerId: r.id }, select: { id: true } })
        : [];
      if (klik.length) await tx.clickEvent.updateMany({ where: { id: { in: klik.map((x) => x.id) } }, data: { matchedCustomerId: null } });
      await tx.leadSourceRelabel.create({
        data: {
          batch, customerId: r.id, sumberLama: r.sumberLama, detailLama: r.detailLama,
          sumberBaru: r.sumber, detailBaru: r.detail, aturan: r.aturan, klikDilepasIds: klik.map((x) => x.id),
        },
      });
      berubah += 1;
    });
  }
  console.log(`Selesai: ${berubah} dari ${rencana.length} diperbarui, batch ${batch}.`);
}

if (process.argv[1]?.endsWith("relabel-sumber-lead.js")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
