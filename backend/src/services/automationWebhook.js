// ─── OUTGOING WEBHOOK DISPATCHER (untuk n8n / tool otomasi eksternal) ────────
//
// TUJUAN: kirim event penting CRM ke luar tanpa membebani UI. Ini jalur
// KELUAR (CRM → n8n). Jangan campur dengan routes/webhooks.js (jalur MASUK
// dari WAHA) atau routes/automation.js (workflow builder internal).
//
// ATURAN PALING PENTING — TIDAK BOLEH MEMBLOKIR RESPONS CRM.
// Semua fungsi di sini:
//   1. Dipanggil SETELAH res.json() (fire-and-forget), dan
//   2. TIDAK PERNAH throw / reject — semua error ditangkap di dalam dan cuma
//      di-log. Sales tidak boleh melihat error hanya karena n8n sedang mati.
//
// KONFIGURASI (.env, semua opsional — kalau URL kosong dispatcher no-op):
//   AUTOMATION_WEBHOOK_URL     = https://n8n.contoh.com/webhook/klinik-matras
//   AUTOMATION_WEBHOOK_SECRET  = string rahasia → dikirim di header
//                                X-Klinik-Signature supaya penerima bisa
//                                memastikan request memang dari CRM ini
//   AUTOMATION_WEBHOOK_TIMEOUT = ms, default 10000

const TIMEOUT_MS = Number(process.env.AUTOMATION_WEBHOOK_TIMEOUT || 10_000);
const MAX_ATTEMPT = 2; // 1 percobaan + 1 retry — n8n restart/hiccup singkat

// Diperingatkan sekali saja, bukan tiap event, supaya log tidak banjir.
let sudahWarnUrlKosong = false;

function getUrl() {
  // Dibaca saat dipanggil, bukan di-cache di module load — supaya urutan
  // import vs dotenv.config() tidak pernah jadi masalah (kalau di-cache dan
  // modul ini ke-import sebelum .env dibaca, URL-nya akan kosong selamanya).
  return (process.env.AUTOMATION_WEBHOOK_URL || "").trim();
}

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Kirim satu event ke AUTOMATION_WEBHOOK_URL. Selalu resolve.
 * @returns {Promise<{ok: boolean, skipped?: boolean, status?: number, error?: string}>}
 */
export async function dispatchAutomationEvent(event, payload) {
  const url = getUrl();
  if (!url) {
    if (!sudahWarnUrlKosong) {
      console.log("[automation-webhook] AUTOMATION_WEBHOOK_URL belum diisi — event tidak dikirim (fitur nonaktif)");
      sudahWarnUrlKosong = true;
    }
    return { ok: false, skipped: true };
  }

  const body = JSON.stringify({
    event,
    // Timestamp UTC ISO 8601 — konsumen (n8n) yang mengubah ke WIB kalau perlu.
    occurredAt: new Date().toISOString(),
    data: payload,
  });

  const headers = { "Content-Type": "application/json" };
  if (process.env.AUTOMATION_WEBHOOK_SECRET) {
    headers["X-Klinik-Signature"] = process.env.AUTOMATION_WEBHOOK_SECRET;
  }

  let errorTerakhir = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPT; attempt++) {
    // AbortController — tanpa timeout, n8n yang hang bisa menahan socket
    // sampai default OS (menit-menitan) dan menumpuk request.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: "POST", headers, body, signal: ac.signal });
      if (res.ok) {
        console.log(`[automation-webhook] ${event} terkirim (HTTP ${res.status})`);
        return { ok: true, status: res.status };
      }
      errorTerakhir = `HTTP ${res.status}`;
      // 4xx = salah konfigurasi/permintaan kita — retry tidak akan menolong.
      if (res.status >= 400 && res.status < 500) break;
    } catch (err) {
      errorTerakhir = err.name === "AbortError" ? `timeout ${TIMEOUT_MS}ms` : err.message;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < MAX_ATTEMPT) await tidur(1000);
  }

  console.error(`[automation-webhook] ${event} GAGAL: ${errorTerakhir}`);
  return { ok: false, error: errorTerakhir };
}

/**
 * Event "lead.won" — dipanggil saat pipelineStage customer berpindah ke
 * COMPLETED (label UI: "Completed"). Revisi 30 Jul 2026: trigger dipindah
 * dari PAID (DIHAPUS dari pipeline — lihat schema.prisma enum PipelineStage,
 * tracking pembayaran sekarang murni lewat Order.paymentStatus per-order) ke
 * COMPLETED, stage terakhir "operasional" sebelum Reviewed. Kumpulkan detail
 * customer + nilai order di sini, BUKAN di route handler, supaya query
 * tambahannya ikut di luar jalur respons.
 *
 * Selalu resolve — aman dipanggil tanpa await (fire-and-forget).
 */
export async function dispatchLeadWon(prisma, { customerId, fromStage, changedById }) {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true, name: true, phone: true, email: true, city: true,
        leadSource: true, leadSourceDetail: true, customerType: true,
        healthStatus: true, tags: true, createdAt: true,
        assignedSales: { select: { id: true, name: true, email: true } },
        orders: {
          where: { status: { not: "CANCELLED" } },
          select: { id: true, orderNumber: true, value: true, category: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!customer) {
      console.error("[automation-webhook] lead.won dibatalkan — customer", customerId, "tidak ditemukan");
      return { ok: false, error: "customer not found" };
    }

    const { orders, assignedSales, ...detail } = customer;
    // Order CANCELLED sudah difilter di query — nilai ini konsisten dengan
    // "Total Nilai Order" di Laporan.
    const totalValue = orders.reduce((s, o) => s + (o.value || 0), 0);
    const latest = orders[0] || null;

    const aktor = changedById
      ? await prisma.user.findUnique({ where: { id: changedById }, select: { id: true, name: true } })
      : null;

    return await dispatchAutomationEvent("lead.won", {
      customer: { ...detail, assignedSales },
      pipeline: { fromStage, toStage: "COMPLETED", label: "Completed" },
      order: {
        totalValue,
        orderCount: orders.length,
        latestOrderNumber: latest?.orderNumber || null,
        latestOrderValue: latest?.value ?? null,
        latestOrderCategory: latest?.category || null,
      },
      changedBy: aktor,
    });
  } catch (err) {
    // Termasuk error query — tetap tidak boleh bocor ke pemanggil.
    console.error("[automation-webhook] lead.won error:", err.message);
    return { ok: false, error: err.message };
  }
}
