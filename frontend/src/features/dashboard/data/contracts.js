// ─── KONTRAK DATA DASHBOARD (Wave 2A) ───────────────────────────────────────
// Sumber kebenaran BENTUK data untuk Band 2 ("What should I do?"). Band 1 & 3
// sudah pakai endpoint nyata (api.js /analytics/*). Band 2 butuh 3 endpoint BARU
// yang belum dibangun — di Wave 2A kita pakai DATA CONTOH (mock) berbentuk PERSIS
// seperti kontrak di bawah, supaya UI bisa dibangun & hierarki divalidasi tanpa
// backend. Wave 2B tinggal mengembalikan bentuk yang sama dari server.
//
// ⚠️ Widget yang memakai mock WAJIB menandainya sebagai "Contoh" di UI (jujur —
// bukan data asli). Lihat sano-ux-guidelines.md §1.4 & wave-2 architecture §5.

/**
 * @typedef {Object} Recommendation  GET /analytics/recommendations → { items: Recommendation[] }
 * @property {string} id
 * @property {"followup"|"unassigned"|"order"|"target"|"complaint"} type
 * @property {"high"|"med"|"low"} severity
 * @property {string} title          teks aksi ringkas (Bahasa Indonesia)
 * @property {string} detail         alasan singkat / konteks (EXPLAINABLE — "kenapa")
 * @property {string} [impact]       dampak/risiko terukur (mis. "Rp8,5jt berisiko")
 * @property {number} [count]        jumlah entitas terkait (mis. 5 lead)
 * @property {string} actionLabel    label tombol CTA ("Buka lead")
 * @property {string} href           rute tujuan (mis. "/inbox?filter=unassigned")
 */

/**
 * @typedef {Object} HotLead         GET /analytics/hot-leads → { items: HotLead[] }
 * @property {string} id             = customerId
 * @property {string} name
 * @property {string} phone
 * @property {"LEAD"|"QUALIFIED"|"QUOTED"|"WON"|"LOST"} stage
 * @property {number} score          0–100 (skor prioritas, EXPLAINABLE)
 * @property {string} reason         ringkas kenapa "panas" (bahasa awam)
 * @property {string[]} signals      sinyal yang membentuk skor (chip pendek)
 * @property {string} nextAction     rekomendasi langkah berikutnya
 * @property {number} valueEstimate  perkiraan nilai (Rupiah) — 0 kalau belum ada order
 * @property {string|null} assignedTo nama sales, null = belum ditugaskan
 * @property {string} lastMessageAt  ISO datetime
 * @property {"CS-1"|"CS-2"} sessionLabel
 */

/**
 * @typedef {Object} FollowUp        GET /analytics/follow-ups → { items: FollowUp[] }
 * @property {string} id             = conversationId
 * @property {string} customerName
 * @property {string} preview        cuplikan pesan terakhir (inbound)
 * @property {number} waitingMinutes menit sejak pesan customer belum dibalas
 * @property {string} nextAction     CTA kontekstual ("Ambil & balas" / "Balas")
 * @property {string|null} assignedTo null = di antrean "belum diambil"
 * @property {boolean} unassigned
 * @property {"CS-1"|"CS-2"} sessionLabel
 */

// Semua endpoint Band 2 di-scope PER-USER di server (SALES = "milik saya",
// ADMIN = seluruh tim). Kontrak bentuknya sama; isinya yang berbeda per role.

const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

export const MOCK_RECOMMENDATIONS = {
  items: [
    { id: "r1", type: "followup",   severity: "high", count: 5, title: "5 lead panas belum di-follow up", detail: "Pesan terakhir dari customer >2 jam lalu, belum dibalas — trust menurun makin lama.", impact: "Rp32jt potensi berisiko", actionLabel: "Buka lead", href: "/inbox" },
    { id: "r2", type: "unassigned", severity: "high", count: 3, title: "3 percakapan belum diambil", detail: "Masuk antrean, belum ada sales yang klaim.", impact: "3 lead baru menunggu", actionLabel: "Ambil sekarang", href: "/inbox" },
    { id: "r3", type: "order",      severity: "med",  count: 2, title: "2 order siap dikonfirmasi", detail: "Status siap ambil — hubungi customer untuk penjadwalan.", actionLabel: "Lihat order", href: "/customers" },
    { id: "r4", type: "target",     severity: "med",  title: "Target Risel 40% · 8 hari tersisa", detail: "Perlu dorongan agar mengejar target bulan ini.", impact: "Rp30jt di bawah target", actionLabel: "Lihat performa", href: "/laporan" },
  ],
};

export const MOCK_HOT_LEADS = {
  items: [
    { id: "c1", name: "Bapak Andi", phone: "6281234567890", stage: "QUOTED",    score: 92, reason: "Sinyal beli kuat, belum di-follow up 3 jam", signals: ["Tanya harga", "Sudah dikirim penawaran", "Belum dibalas 3j"], nextAction: "Follow up sekarang — kirim rincian harga", valueEstimate: 8500000, assignedTo: null,     lastMessageAt: iso(185), sessionLabel: "CS-1" },
    { id: "c2", name: "Ibu Sari",   phone: "6285698765432", stage: "QUALIFIED", score: 84, reason: "Data lengkap, minat tinggi",                  signals: ["Berat badan terkirim", "Keluhan jelas", "Balas cepat"], nextAction: "Tawarkan rekomendasi kasur + jadwalkan", valueEstimate: 6200000, assignedTo: "Farhan", lastMessageAt: iso(52),  sessionLabel: "CS-2" },
    { id: "c3", name: "Bapak Joko", phone: "6281199887766", stage: "QUOTED",    score: 78, reason: "Minta katalog, sinyal beli",                  signals: ["Minta foto katalog", "Sudah dikirim penawaran"], nextAction: "Kirim katalog + tanyakan ukuran", valueEstimate: 5000000, assignedTo: "Mila",   lastMessageAt: iso(240), sessionLabel: "CS-1" },
    { id: "c4", name: "Ibu Rina",   phone: "6285611223344", stage: "QUALIFIED", score: 71, reason: "Responsif, tanya cara order",                 signals: ["Tanya cara order", "Balas cepat"], nextAction: "Bantu proses order & konfirmasi alamat", valueEstimate: 0, assignedTo: null, lastMessageAt: iso(18), sessionLabel: "CS-1" },
  ],
};

export const MOCK_FOLLOW_UPS = {
  items: [
    { id: "cv1", customerName: "Bapak Andi", preview: "Kalau yang ukuran 160x200 harganya berapa ya?", waitingMinutes: 185, nextAction: "Ambil & balas", assignedTo: null,   unassigned: true,  sessionLabel: "CS-1" },
    { id: "cv2", customerName: "Ibu Dewi",   preview: "Baik saya pikir dulu ya, nanti kabari",         waitingMinutes: 96,  nextAction: "Balas",         assignedTo: "Kiki", unassigned: false, sessionLabel: "CS-2" },
    { id: "cv3", customerName: "Bapak Hadi", preview: "Bisa COD daerah Bekasi?",                        waitingMinutes: 74,  nextAction: "Ambil & balas", assignedTo: null,   unassigned: true,  sessionLabel: "CS-1" },
  ],
};

// Penanda global: apakah dashboard sedang memakai data contoh untuk Band 2.
// Wave 2B set ke false setelah endpoint nyata siap.
export const BAND2_IS_MOCK = true;
