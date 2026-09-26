// Klien HTTP tipis di atas fetch bawaan Node — dipakai test integrasi untuk
// memanggil endpoint ASLI (lewat testApp.js) persis seperti frontend
// memanggilnya, termasuk header Authorization. Tidak pakai supertest (tidak
// ada di dependencies, dan fetch bawaan Node 18+ sudah cukup untuk pola
// request/response sederhana yang dipakai di sini).
import jwt from "jsonwebtoken";

// Koreksi finansial butuh token step-up (PIN Finance). Klien tes membawanya OTOMATIS (dicetak dengan rahasia yang sama,
// seolah PIN sudah diverifikasi) supaya tes alur bisnis tidak perlu mengulang PIN di tiap panggilan.
// Tes yang justru menguji step-up memakai { tanpaStepUp: true } dan memverifikasi PIN lewat API sungguhan.
export function tokenStepUpUji(userId) {
  return jwt.sign({ sub: userId, typ: "finance-stepup" }, `${process.env.JWT_SECRET}:finance-stepup`, { expiresIn: 300, audience: "finance-stepup" });
}

export function makeClient(baseUrl, token, { tanpaStepUp = false } = {}) {
  let stepUp = null;
  if (token && !tanpaStepUp) {
    try { const d = jwt.decode(token); if (d?.id) stepUp = tokenStepUpUji(d.id); } catch { /* token bukan JWT — tanpa step-up */ }
  }
  async function call(method, path, body, extraHeaders) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(stepUp ? { "X-Finance-Stepup": stepUp } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* respons kosong, biarkan null */ }
    return { status: res.status, body: json, headers: res.headers };
  }
  return {
    get: (path) => call("GET", path),
    // `headers` opsional — dipakai test yang perlu mengirim Idempotency-Key
    // (mis. financePurchaseAdvance.integration.test.js), tidak mengubah
    // pemanggilan lama yang cuma kirim (path, body).
    post: (path, body, headers) => call("POST", path, body, headers),
    patch: (path, body, headers) => call("PATCH", path, body, headers),
    put: (path, body, headers) => call("PUT", path, body, headers),
    delete: (path) => call("DELETE", path),
  };
}
