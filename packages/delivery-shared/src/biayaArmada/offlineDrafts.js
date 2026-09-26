import { newIdempotencyKey } from "../api/client.js";
import { validateDraft } from "./domain.js";

// Antrean draf biaya armada OFFLINE (untuk Driver). Dipisah dari antrean eksekusi
// job (driver-mobile/src/lib/executionQueue.js) dan TIDAK menyentuhnya: kunci
// penyimpanan berbeda, kode berbeda. Setiap draf membawa idempotencyKey
// sendiri yang dibuat SEKALI, sehingga retry sinkronisasi tidak pernah membuat
// pengajuan kedua walau koneksi putus di tengah kirim.
//
// Alur satu draf: tersimpan (LOKAL) -> dikirim sebagai DRAFT di server (create) ->
// foto struk diunggah -> diajukan (ajukan). Tiap tahap dicatat di `step`, sehingga
// sinkronisasi bisa lanjut dari tahap terakhir yang sukses (tidak mengulang dari nol).
//
// status: LOKAL | MENGIRIM | GAGAL | SELESAI
const QUEUE_PREFIX = "biayaArmada:drafts:";

export function createOfflineDraftStore({ storage, userId, now = () => Date.now(), rand = Math.random }) {
  if (!userId) throw new Error("userId wajib: antrean draf dipisah per pengguna");
  const key = `${QUEUE_PREFIX}${userId}`;

  async function read() {
    try { return JSON.parse((await storage.getItem(key)) || "[]"); } catch { return []; }
  }
  async function write(list) {
    await storage.setItem(key, JSON.stringify(list));
  }

  return {
    list: read,
    async save(draft, { photo = null, autoSubmit = true } = {}) {
      const list = await read();
      const id = `d-${now().toString(36)}-${Math.floor(rand() * 1e6).toString(36)}`;
      const item = {
        id, draft, photo, autoSubmit,
        status: "LOKAL", step: "BARU", serverId: null, attempts: 0, lastError: null,
        keys: { create: newIdempotencyKey("bd-c", rand, now), ajukan: newIdempotencyKey("bd-a", rand, now) },
        createdAt: now(),
      };
      list.push(item);
      await write(list);
      return item;
    },
    async remove(id) {
      await write((await read()).filter((d) => d.id !== id));
    },
    async update(id, patch) {
      const list = await read();
      const i = list.findIndex((d) => d.id === id);
      if (i < 0) return null;
      list[i] = { ...list[i], ...patch };
      await write(list);
      return list[i];
    },
    /**
     * Sinkronkan semua draf yang belum SELESAI, berurutan (satu per satu, supaya
     * urutan waktu tetap dan satu draf yang gagal tidak menghambat yang lain).
     * Error jaringan/5xx = GAGAL tapi tetap di antrean (bisa dicoba lagi);
     * error 4xx (data ditolak server) juga GAGAL dan menyimpan pesan untuk pengguna,
     * TIDAK dicoba ulang otomatis.
     */
    async sync(api, config) {
      const results = [];
      const list = await read();
      for (const item of list) {
        if (item.status === "SELESAI" || (item.status === "GAGAL" && item.permanent)) continue;
        const check = validateDraft(item.draft, config);
        if (!check.ok) {
          await this.update(item.id, { status: "GAGAL", permanent: true, lastError: Object.values(check.errors)[0] });
          results.push({ id: item.id, ok: false, permanent: true });
          continue;
        }
        try {
          await this.update(item.id, { status: "MENGIRIM", attempts: item.attempts + 1 });
          let serverId = item.serverId;
          let step = item.step;
          if (!serverId) {
            const created = await api.create(item.draft, item.keys.create);
            serverId = created.id;
            step = "DIBUAT";
            await this.update(item.id, { serverId, step });
          }
          if (item.photo && !["FOTO", "DIAJUKAN"].includes(step)) {
            await api.uploadBukti(serverId, item.photo);
            step = "FOTO";
            await this.update(item.id, { step });
          }
          if (item.autoSubmit && step !== "DIAJUKAN") {
            await api.ajukan(serverId, item.keys.ajukan);
            step = "DIAJUKAN";
          }
          await this.update(item.id, { status: "SELESAI", step, lastError: null });
          results.push({ id: item.id, ok: true, serverId });
        } catch (err) {
          const permanent = typeof err.status === "number" && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429 && err.status !== 401;
          await this.update(item.id, { status: "GAGAL", permanent, lastError: err.message });
          results.push({ id: item.id, ok: false, permanent, error: err.message });
          if (err.status === 401) break;
        }
      }
      return results;
    },
  };
}
