// Client API untuk backend CRM Klinik Matras — driver app.
// Struktur SAMA PERSIS dengan mobile/src/api.js (Sano Messenger) — pola
// request/uploadFile/error-handling sudah teruji produksi di sana (timeout,
// AbortError lintas-Expo, 401 handling, dst). Endpoint DIGANTI ke yang
// dipakai driver (armada), bukan chat. Base URL & auth header sama gaya
// dengan frontend/src/api.js versi web.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, UploadType } from "expo-file-system";

export const DEFAULT_SERVER = "https://app.sanomatrassehat.com";

const TIMEOUT_MS = 30000;

let serverUrl = DEFAULT_SERVER;
let token = null;
let onUnauthorized = null;

export function configureApi({ server, jwt, unauthorizedHandler }) {
  if (server !== undefined) serverUrl = server || DEFAULT_SERVER;
  if (jwt !== undefined) token = jwt;
  if (unauthorizedHandler !== undefined) onUnauthorized = unauthorizedHandler;
}

export function getServerUrl() {
  return serverUrl;
}

export function mediaUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith("http") || pathOrUrl.startsWith("file://")) return pathOrUrl;
  return serverUrl + pathOrUrl;
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${serverUrl}/api${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    if (res.status === 401) {
      token = null;
      await AsyncStorage.removeItem("token");
      if (onUnauthorized) onUnauthorized();
      throw new Error("Sesi berakhir, silakan login kembali");
    }
    if (!res.ok) {
      const text = await res.text();
      let msg;
      try { msg = JSON.parse(text).error; } catch {}
      if (!msg) msg = text ? `${res.status}: ${text.slice(0, 300)}` : `Error ${res.status}`;
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return res.json();
  } catch (err) {
    if (controller.signal.aborted) throw new Error("Koneksi timeout — coba lagi");
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Upload multipart lewat expo-file-system File.upload() — BUKAN fetch +
// FormData.append({uri,name,type}) gaya lama. Di New Architecture (dipakai
// project ini, sama dengan mobile/), FormData tidak lagi menerima object
// {uri,name,type} sebagai "part" (error "unsupported FormData part
// implementation") — File.upload() baca file dari path asli lewat native
// filesystem module, tidak lewat FormData bridge JS<->native. Lihat catatan
// panjang yang SAMA di mobile/src/api.js (ditemukan & dites di sana).
async function uploadFile(path, file, fields, fieldName = "photos") {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    const fileRef = new File(file.uri);
    const result = await fileRef.upload(`${serverUrl}/api${path}`, {
      httpMethod: "POST",
      uploadType: UploadType.MULTIPART,
      fieldName,
      mimeType: file.type,
      parameters: fields,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    if (result.status === 401) {
      token = null;
      await AsyncStorage.removeItem("token");
      if (onUnauthorized) onUnauthorized();
      throw new Error("Sesi berakhir, silakan login kembali");
    }
    if (result.status < 200 || result.status >= 300) {
      let msg;
      try { msg = JSON.parse(result.body).error; } catch {}
      if (!msg) msg = result.body ? `${result.status}: ${result.body.slice(0, 300)}` : `Upload gagal (status ${result.status})`;
      throw new Error(msg);
    }
    return JSON.parse(result.body);
  } catch (err) {
    if (controller.signal.aborted) throw new Error("Koneksi timeout — coba lagi");
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Upload BEBERAPA foto sekaligus ke satu job — endpoint backend
// (POST /armada/jobs/:id/photos) menerima multipart field "photos"
// (jamak, bisa banyak file), sama kontrak dengan frontend/src/api.js
// web (uploadJobPhotos, lewat FormData multi-append). File.upload() cuma
// bisa 1 file per panggilan, jadi upload berurutan lalu gabung hasilnya.
async function uploadJobPhotosMulti(jobId, files) {
  const urls = [];
  for (const file of files) {
    const res = await uploadFile(`/armada/jobs/${jobId}/photos`, file, {}, "photos");
    if (res.urls) urls.push(...res.urls);
    else if (res.url) urls.push(res.url);
  }
  return { urls };
}

function buildQuery(params) {
  const q = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return q ? "?" + q : "";
}

export const api = {
  // Auth — endpoint SAMA dengan web/Sano Messenger.
  login: (email, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  getMe: () => request("/users/me"),

  // Push (Expo push token — SAMA endpoint dgn Sano Messenger, backend
  // sudah punya infrastrukturnya lewat services/expoPush.js + prisma.
  // pushToken, dipakai ulang APA ADANYA, bukan bikin channel baru).
  savePushToken: (token, extra = {}) =>
    request("/users/me/push-token", { method: "POST", body: JSON.stringify({ token, ...extra }) }),
  deletePushToken: (token) =>
    request("/users/me/push-token", { method: "DELETE", body: JSON.stringify({ token }) }),

  // Job driver — SEMUA endpoint SUDAH ADA di backend (dipakai juga oleh
  // PWA/APK Capacitor driver-app/), nol perubahan kontrak API.
  getMyJobs: (date) => request(`/armada/my-jobs${buildQuery({ date })}`),
  uploadJobPhotos: uploadJobPhotosMulti,
  // Mulai SATU rute sekaligus — foto muatan sekali, semua job ASSIGNED di
  // rute jadi EN_ROUTE (lihat POST /armada/routes/:id/start).
  startRoute: (routeId, data = {}) =>
    request(`/armada/routes/${routeId}/start`, { method: "POST", body: JSON.stringify(data) }),
  // Link Google Maps rute (sumber = manualMapsUrl admin, fallback auto
  // multi-stop) — sama presedennya dengan broadcast WA.
  getRouteMap: (routeId) => request(`/armada/routes/${routeId}/map`),

  // Tampilan admin/owner (10 Sep 2026) — dipakai AdminHomeScreen. SEMUA
  // endpoint SUDAH ADA & dipakai dispatcher di web (ArmadaDashboard/
  // ArmadaTracking/Route Planner "Masalah"), nol perubahan kontrak API —
  // app cuma klien baru yang memanggilnya, baca-saja (aksi lanjut seperti
  // reschedule tetap di web untuk v1).
  getArmadaJobs: (params = {}) => request(`/armada/jobs${buildQuery(params)}`),
  // Riwayat Rute (13 Sep 2026, D-163) — GET /armada/routes sudah include
  // driver/helper/vehicle/jobs penuh per rute (routeInclude backend), take/
  // skip/driverId baru ditambah backend khusus utk tab ini (sebelumnya
  // endpoint ini SELALU kembalikan SEMUA rute tanpa batas, cukup aman untuk
  // Route Planner web tapi berat kalau dipanggil polos dari HP).
  getArmadaRoutes: (params = {}) => request(`/armada/routes${buildQuery(params)}`),
  getArmadaTracking: () => request("/armada/tracking"),
  getArmadaIssues: (params = {}) => request(`/armada/issues${buildQuery(params)}`),
  startArmadaJob: (jobId, data = {}) => request(`/armada/jobs/${jobId}/start`, { method: "POST", body: JSON.stringify(data) }),
  arriveArmadaJob: (jobId, data = {}) => request(`/armada/jobs/${jobId}/arrive`, { method: "POST", body: JSON.stringify(data) }),
  completeArmadaJob: (jobId, data) => request(`/armada/jobs/${jobId}/complete`, { method: "POST", body: JSON.stringify(data) }),
  failArmadaJob: (jobId, data) => request(`/armada/jobs/${jobId}/fail`, { method: "POST", body: JSON.stringify(data) }),
  recordJobPayment: (jobId, data) => request(`/armada/jobs/${jobId}/payment`, { method: "POST", body: JSON.stringify(data) }),
  addJobProofPhotos: (jobId, data) => request(`/armada/jobs/${jobId}/proof-photos`, { method: "PATCH", body: JSON.stringify(data) }),
  // Ping GPS (D-034, Live Tracking) — pings: array {lat,lng,accuracy,recordedAt}.
  sendJobPositions: (jobId, pings) =>
    request(`/armada/jobs/${jobId}/positions`, { method: "POST", body: JSON.stringify({ pings }) }),

  // Status Online/Offline (12 Sep 2026, referensi Gojek/Grab) — MURNI
  // status, gerbang GPS tracking sisi klien (lihat hooks/useDriverTracking.js
  // & AuthContext.js). Online juga bisa otomatis nyala dari backend saat
  // job pertama dimulai — endpoint ini dipanggil utk toggle MANUAL (via
  // AuthContext) DAN untuk sinkron state lokal begitu backend
  // meng-auto-online-kan (lihat pemanggilan di AuthContext setelah start job).
  setOnlineStatus: (online) =>
    request("/armada/me/online-status", { method: "POST", body: JSON.stringify({ online }) }),

  // Insentif per ALAMAT selesai per driver/helper — AdminHomeScreen tab
  // Performa (D-162, 13 September 2026, GANTI dari versi "per jalur" —
  // itu salah kaprah, insentif Klinik Matras dihitung per alamat/stop,
  // bukan per rute). from/to opsional (kosong = default backend "bulan
  // ini").
  getIncentiveSummary: (from, to) => request(`/armada/incentive-summary${buildQuery({ from, to })}`),
};
