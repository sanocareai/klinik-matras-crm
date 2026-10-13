// ATRIBUSI CTWA FASE 2 — kesehatan capture touch. AGREGAT SAJA (jumlah/usia); tidak pernah memuat customer, nomor, pesan, atau payload.
//
// Dua sumber yang sengaja dipisah supaya tidak disalahartikan:
//   proses : penghitung per-proses (reset saat backend restart) dari touchCapture.js — rekam, duplikat, bukan-touch, gagal, fallback transaksi,
//            dipulihkan, gagal-pulih, dan percobaan susulan yang sedang tertunda (jumlah + usia tertua).
//   db     : fakta dari tabel (persisten) — total/24 jam/7 hari, touch tak terpetakan SEKARANG (referensi terkini) beserta usia tertuanya,
//            touch audit AD_REPLY_UNMARKED, kesegaran referensi.
// "Pending" di desain atomik berarti dua hal yang berbeda dan dilaporkan terpisah:
//   proses.tertunda      : penulisan susulan (fallback) yang sedang berjalan — normalnya 0;
//   db.pendingPemetaan   : touch yang Ad ID-nya belum punya referensi (butuh impor pemetaan) — ini yang perlu tindakan manusia.
import { _getTouchStats, isTouchCaptureOn, TOUCH_FLAG } from "./touchCapture.js";

const JAM = 3600 * 1000;

export async function hitungKesehatanCapture(db, { now = new Date(), timeoutMs = 10_000 } = {}) {
  const s24 = new Date(now.getTime() - 24 * JAM);
  const s7 = new Date(now.getTime() - 7 * 24 * JAM);
  const baris = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(Number(timeoutMs)))}`);
    const [t] = await tx.$queryRaw`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE created_at >= ${s24})::int AS jam24,
             count(*) FILTER (WHERE created_at >= ${s7})::int AS hari7,
             count(*) FILTER (WHERE evidence_source = 'AD_REPLY_UNMARKED')::int AS audit_tanpa_penanda,
             count(*) FILTER (WHERE evidence_source = 'CTWA_AD' AND customer_status_at_touch = 'NEW')::int AS akuisisi_ctwa,
             count(*) FILTER (WHERE customer_status_at_touch = 'EXISTING')::int AS status_existing,
             count(*) FILTER (WHERE customer_status_at_touch = 'UNKNOWN')::int AS status_unknown,
             min(touch_at) AS tertua, max(touch_at) AS terbaru
        FROM attribution_touches`;
    const [u] = await tx.$queryRaw`
      SELECT count(*)::int AS touch, count(DISTINCT t.ad_id)::int AS ad_id_unik, min(t.touch_at) AS tertua
        FROM attribution_touches t
        LEFT JOIN meta_ad_references r ON r.ad_id = t.ad_id
       WHERE r.ad_id IS NULL AND t.evidence_source = 'CTWA_AD'`;
    const [r] = await tx.$queryRaw`SELECT count(*)::int AS jumlah, max(synced_at) AS sinkron_terakhir FROM meta_ad_references`;
    return { t, u, r };
  }, { timeout: timeoutMs + 5_000, maxWait: 5_000 });

  const proses = _getTouchStats(now.getTime());
  const usiaJam = (d) => (d ? Math.round(((now.getTime() - new Date(d).getTime()) / JAM) * 10) / 10 : null);
  return {
    versi: 1,
    dihitungPada: now.toISOString(),
    captureAktif: isTouchCaptureOn(),
    flag: TOUCH_FLAG,
    mekanisme: "atomik: touch ditulis dalam transaksi yang sama dengan Message (SAVEPOINT); fallback tanpa transaksi + percobaan susulan",
    statusCustomer: "NEW hanya dari bukti kausal (webhook membuat customer / clid cocok); tanpa bukti = UNKNOWN",
    proses: {
      catatan: "penghitung per proses; kembali ke 0 saat backend restart",
      direkam: proses.direkam, duplikat: proses.duplikat, bukanTouch: proses.bukanTouch,
      gagal: proses.gagal,
      fallbackTransaksi: proses.fallbackTransaksi, dipulihkan: proses.dipulihkan, gagalPulih: proses.gagalPulih,
      statusNew: proses.statusNew, statusExisting: proses.statusExisting, statusUnknown: proses.statusUnknown,
      tertunda: proses.tertunda, usiaTertundaTertuaDetik: Math.round(proses.usiaTertundaTertuaMs / 1000),
      terakhirGagalAt: proses.terakhirGagalAt,
    },
    db: {
      touchTotal: baris.t.total, touch24Jam: baris.t.jam24, touch7Hari: baris.t.hari7,
      akuisisiCtwa: baris.t.akuisisi_ctwa, statusCustomer: { new: baris.t.akuisisi_ctwa, existing: baris.t.status_existing, unknown: baris.t.status_unknown }, auditAdReplyTanpaPenanda: baris.t.audit_tanpa_penanda,
      touchTertua: baris.t.tertua ? new Date(baris.t.tertua).toISOString() : null,
      touchTerbaru: baris.t.terbaru ? new Date(baris.t.terbaru).toISOString() : null,
      usiaTouchTerbaruJam: usiaJam(baris.t.terbaru),
      referensi: { jumlah: baris.r.jumlah, sinkronTerakhir: baris.r.sinkron_terakhir ? new Date(baris.r.sinkron_terakhir).toISOString() : null },
      pendingPemetaan: {
        touch: baris.u.touch, adIdUnik: baris.u.ad_id_unik,
        usiaTertuaJam: usiaJam(baris.u.tertua),
        tindakan: baris.u.touch > 0 ? "impor pemetaan Ad ID dari Ads Manager (POST /api/atribusi/iklan/referensi)" : null,
      },
    },
  };
}
