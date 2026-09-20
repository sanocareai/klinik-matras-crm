/* eslint-disable import/first -- jest.mock harus lebih dulu agar ENV (mode contoh) sudah dimatikan saat modul diimpor */
// Jalur API ASLI pembayaran (mode contoh dimatikan): query yang dikirim, guard capability, step-up, Idempotency-Key, dan tidak ada
// antrean saat jaringan gagal. `api` (klien HTTP) di-spy — tidak ada jaringan sungguhan.
jest.mock("@/lib/env", () => ({ ENV: { appEnv: "development", apiUrl: "https://app.contoh.test/api", useMocks: false, variant: "development", version: "0.0.0" } }));

import { ApiError } from "@/api/errors";
import { StepUpDibatalkan } from "@/api/command";
import { AksesDitolak } from "@/auth/capabilities";
import { api, useSession } from "@/auth/session";
import { useLock } from "@/auth/lock";
import { peranContoh } from "@/mocks/roles";
import { fetchLencanaBayar, fetchOpsiBayar, fetchPembayaran, fetchPembayaranDetail, putuskanBayar } from "@/api/pembayaran";
import { urlMedia } from "@/api/approvals";
import type { AksiPembayaran, FilterPembayaran } from "@/api/types";

const aksiOk = (a: "verifikasi" | "tolak"): AksiPembayaran => ({ boleh: true, alasan: null, path: `/finance/pembayaran/p1/${a}`, alasanWajib: a === "tolak" });
const filter: FilterPembayaran = { tab: "MENUNGGU", metode: null, rekeningId: null, from: null, to: null, q: "" };

function masuk(email: string) {
  const p = peranContoh(email);
  if ("tanpaAkses" in p) throw new Error("x");
  useSession.setState({ status: "signedIn", user: p.user, capabilities: p.capabilities });
}

let command: jest.SpyInstance;
let get: jest.SpyInstance;
beforeEach(() => {
  command = jest.spyOn(api, "command").mockResolvedValue({} as never);
  get = jest.spyOn(api, "get");
  masuk("finance@x");
  useLock.setState({ pinSet: true, lastUnlockAt: Date.now() }); // step-up lolos
});
afterEach(() => jest.restoreAllMocks());

describe("putuskanBayar (asli)", () => {
  it("aksi.boleh=false → ditolak di klien; tidak ada perintah terkirim", async () => {
    await expect(putuskanBayar({ aksi: { boleh: false, alasan: "Pembayaran ini sudah diverifikasi.", path: "/finance/pembayaran/p1/verifikasi" }, kunci: "k" }))
      .rejects.toMatchObject({ status: 403, message: "Pembayaran ini sudah diverifikasi." });
    expect(command).not.toHaveBeenCalled();
  });

  it.each(["owner@x", "approver@x", "akuntan@x"])("%s: tanpa paymentWrite → AksesDitolak sebelum step-up dan sebelum jaringan (PAYMENT_WRITE khusus FINANCE)", async (email) => {
    masuk(email);
    const stepUp = jest.spyOn(useLock.getState(), "requireStepUp");
    await expect(putuskanBayar({ aksi: aksiOk("verifikasi"), kunci: "k" })).rejects.toBeInstanceOf(AksesDitolak);
    expect(stepUp).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });

  it("step-up ditolak/dibatalkan → StepUpDibatalkan; tidak ada perintah terkirim", async () => {
    jest.spyOn(useLock.getState(), "requireStepUp").mockResolvedValue(false);
    await expect(putuskanBayar({ aksi: aksiOk("verifikasi"), kunci: "k" })).rejects.toBeInstanceOf(StepUpDibatalkan);
    expect(command).not.toHaveBeenCalled();
  });

  it("verifikasi: POST ke path dari server dengan Idempotency-Key yang diberikan dan body kosong", async () => {
    await putuskanBayar({ aksi: aksiOk("verifikasi"), kunci: "kunci-1" });
    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith("POST", "/finance/pembayaran/p1/verifikasi", "kunci-1", { body: {} });
  });

  it("tolak: alasan dipangkas dan dikirim sebagai reason", async () => {
    await putuskanBayar({ aksi: aksiOk("tolak"), alasan: "  Uang belum masuk  ", kunci: "kunci-2" });
    expect(command).toHaveBeenCalledWith("POST", "/finance/pembayaran/p1/tolak", "kunci-2", { body: { reason: "Uang belum masuk" } });
  });

  it("jaringan putus: galat diteruskan apa adanya dan TIDAK dicoba lagi / diantre (satu panggilan saja)", async () => {
    command.mockRejectedValue(new ApiError({ status: 0, code: "NETWORK", message: "Tidak ada koneksi" }));
    await expect(putuskanBayar({ aksi: aksiOk("verifikasi"), kunci: "k" })).rejects.toMatchObject({ status: 0, isNetwork: true });
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("hasil tidak pasti (putus setelah terkirim) diteruskan dengan flag tidakPasti", async () => {
    command.mockRejectedValue(new ApiError({ status: 0, code: "NETWORK", message: "putus", tidakPasti: true }));
    await expect(putuskanBayar({ aksi: aksiOk("verifikasi"), kunci: "k" })).rejects.toMatchObject({ tidakPasti: true });
  });
});

describe("pembacaan (asli)", () => {
  it("daftar: status, cursor, limit 20, pencarian dipangkas; filter kosong tidak dikirim", async () => {
    get.mockResolvedValue({ items: [], nextCursor: null, hitung: {}, ringkasan: {}, diperbaruiPada: null });
    await fetchPembayaran({ ...filter, tab: "TERVERIFIKASI", metode: "TRANSFER", rekeningId: "r1", from: "2026-09-01", to: "2026-09-30", q: "  erni  " }, "abc");
    expect(get).toHaveBeenCalledWith("/finance/pembayaran", expect.objectContaining({
      query: { status: "TERVERIFIKASI", metode: "TRANSFER", rekeningId: "r1", from: "2026-09-01", to: "2026-09-30", q: "erni", limit: 20, cursor: "abc" },
    }));
    await fetchPembayaran(filter, null);
    expect(get).toHaveBeenLastCalledWith("/finance/pembayaran", expect.objectContaining({
      query: { status: "MENUNGGU", metode: undefined, rekeningId: undefined, from: undefined, to: undefined, q: undefined, limit: 20, cursor: undefined },
    }));
  });

  it("detail: id di-encode; respons yang tidak bisa dibaca → 502 PARSE (bukan crash)", async () => {
    get.mockResolvedValue({ bukan: "pembayaran" });
    await expect(fetchPembayaranDetail("a/b c")).rejects.toMatchObject({ status: 502, code: "PARSE" });
    expect(get).toHaveBeenCalledWith("/finance/pembayaran/a%2Fb%20c", expect.anything());
  });

  it("lencana: angka menunggu dari server; payload aneh → 0", async () => {
    get.mockResolvedValueOnce({ menunggu: 7, lunasBelumDicatat: 2, periode: {} });
    expect(await fetchLencanaBayar()).toBe(7);
    get.mockResolvedValueOnce({ menunggu: "7" });
    expect(await fetchLencanaBayar()).toBe(0);
    get.mockResolvedValueOnce(null);
    expect(await fetchLencanaBayar()).toBe(0);
  });

  it("opsi filter: entri cacat dibuang", async () => {
    get.mockResolvedValue({ rekening: [{ id: "r1", name: "Bank", kind: "BANK" }, { name: "tanpa id" }, null], metode: [{ id: "CASH", label: "Tunai" }, 5] });
    expect(await fetchOpsiBayar()).toEqual({ rekening: [{ id: "r1", name: "Bank", kind: "BANK" }], metode: [{ id: "CASH", label: "Tunai" }] });
  });

  it("urlMedia: jalur bukti bertanda-tangan dirakit di host server (tanpa /api ganda untuk /media)", () => {
    expect(urlMedia("/media/bukti-pembayaran/a.pdf?exp=1&sig=x")).toBe("https://app.contoh.test/media/bukti-pembayaran/a.pdf?exp=1&sig=x");
  });
});
