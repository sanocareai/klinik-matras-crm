// Checklist Persiapan Perjalanan (7 Okt 2026, permintaan owner — "jangan
// sampai lupa plastik/tali/kaki kasur sebelum berangkat"). Lihat model
// RoutePrepChecklistItem/RoutePrepChecklistProof di schema.prisma untuk
// alasan desain data (hapus-lunak, revision ganda rute+item).
//
// Modul ini MURNI logika domain (validasi input, evaluasi gerbang) — tidak
// menyentuh req/res. Dipanggil dari routes/armada.js di dalam transaksi
// Prisma yang sudah mengunci baris Route (lockRoute, FOR UPDATE NOWAIT)
// supaya evaluasi gerbang & edit checklist paralel tidak bisa saling susul
// diam-diam (race edit-vs-start — lihat POST /routes/:id/start).

export const MAX_TITLE_LEN = 160;
export const MAX_DETAIL_LEN = 2000;
export const MAX_QUANTITY = 100000;

function buatGalat(message, statusCode = 400, code) {
  return Object.assign(new Error(message), { statusCode, ...(code && { code }) });
}

// Normalisasi field yang DIKIRIM (key-nya ada di body) — dipakai untuk
// create (semua field relevan wajib ada, defaultnya diisi pemanggil) dan
// untuk patch (hanya field yang benar-benar dikirim yang divalidasi/
// diubah; field yang tidak dikirim TIDAK disentuh oleh pemanggil).
export function normalizeChecklistItemFields(body = {}) {
  const out = {};
  if (body.title !== undefined) {
    const title = String(body.title || "").trim();
    if (!title) throw buatGalat("Judul item checklist wajib diisi");
    if (title.length > MAX_TITLE_LEN) throw buatGalat(`Judul maksimal ${MAX_TITLE_LEN} karakter`);
    out.title = title;
  }
  if (body.detail !== undefined) {
    const detail = body.detail == null ? null : String(body.detail).trim().slice(0, MAX_DETAIL_LEN);
    out.detail = detail || null;
  }
  if (body.quantity !== undefined) {
    if (body.quantity === null || body.quantity === "") {
      out.quantity = null;
    } else {
      const q = Number(body.quantity);
      if (!Number.isInteger(q) || q < 0 || q > MAX_QUANTITY) throw buatGalat("Jumlah tidak valid");
      out.quantity = q;
    }
  }
  if (body.scope !== undefined) {
    if (body.scope !== "ROUTE" && body.scope !== "STOP") throw buatGalat("Lingkup checklist tidak valid (ROUTE/STOP)");
    out.scope = body.scope;
  }
  if (body.jobId !== undefined) out.jobId = body.jobId || null;
  if (body.required !== undefined) out.required = Boolean(body.required);
  if (body.photoRequired !== undefined) out.photoRequired = Boolean(body.photoRequired);
  if (body.sortOrder !== undefined) {
    const s = Number(body.sortOrder);
    out.sortOrder = Number.isFinite(s) ? Math.trunc(s) : 0;
  }
  return out;
}

// Dipanggil dengan state AKHIR (setelah merge create-defaults / patch ke
// baris existing) — "terkait seluruh route atau order/stop" dari spec:
// STOP wajib terikat satu job, ROUTE tidak boleh terikat job mana pun.
export function assertScopeJobConsistency({ scope, jobId }) {
  if (scope === "STOP" && !jobId) throw buatGalat("Item lingkup stop wajib memilih order/stop terkait");
  if (scope === "ROUTE" && jobId) throw buatGalat("Item lingkup seluruh rute tidak boleh terikat satu stop");
}

// Gerbang POST /routes/:id/start — item AKTIF (belum diarsipkan) & WAJIB
// ("required sebelum berangkat") harus punya bukti TERKINI (proof termuda
// yang itemRevision-nya cocok dengan revision item SEKARANG — proof dari
// revision lama otomatis tidak dihitung, lihat catatan schema.prisma).
// Item photoRequired tanpa foto di bukti terkininya juga dianggap belum
// terpenuhi walau sudah ada baris proof (mis. submit tanpa foto pada item
// yang sebenarnya minta foto).
export async function evaluateChecklistGate(tx, routeId) {
  const items = await tx.routePrepChecklistItem.findMany({
    where: { routeId, archivedAt: null, required: true },
    orderBy: { sortOrder: "asc" },
  });
  if (items.length === 0) return { ok: true, missing: [] };

  const proofs = await tx.routePrepChecklistProof.findMany({
    where: { itemId: { in: items.map((i) => i.id) } },
    orderBy: { createdAt: "desc" },
  });
  const latestByItem = new Map();
  for (const p of proofs) {
    if (!latestByItem.has(p.itemId)) latestByItem.set(p.itemId, p);
  }

  const missing = [];
  for (const item of items) {
    const latest = latestByItem.get(item.id);
    const current = latest && latest.itemRevision === item.revision ? latest : null;
    if (!current) {
      missing.push({ itemId: item.id, title: item.title, reason: "Belum ada bukti terbaru" });
    } else if (item.photoRequired && !current.photoUrl) {
      missing.push({ itemId: item.id, title: item.title, reason: "Foto belum diunggah" });
    }
  }
  return { ok: missing.length === 0, missing };
}

export { buatGalat as checklistError };
