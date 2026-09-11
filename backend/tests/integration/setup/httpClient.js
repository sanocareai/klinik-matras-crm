// Klien HTTP tipis di atas fetch bawaan Node — dipakai test integrasi untuk
// memanggil endpoint ASLI (lewat testApp.js) persis seperti frontend
// memanggilnya, termasuk header Authorization. Tidak pakai supertest (tidak
// ada di dependencies, dan fetch bawaan Node 18+ sudah cukup untuk pola
// request/response sederhana yang dipakai di sini).
export function makeClient(baseUrl, token) {
  async function call(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* respons kosong, biarkan null */ }
    return { status: res.status, body: json };
  }
  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body),
    patch: (path, body) => call("PATCH", path, body),
  };
}
