// Pakem tiap channel Marketing (disetujui Owner 9 Nov 2026) dan pengelompokan tabel. Logika murni, tanpa React.
// Teks ini menjelaskan aturan yang benar-benar berjalan di webhook; kalau aturannya berubah, teks ini ikut diubah.

export const PAKEM_KANAL = Object.freeze({
  META: { apa: "Orang yang chat setelah mengklik iklan Facebook, Instagram, atau Status WhatsApp.", bukti: "ID klik dan ID iklan dari WhatsApp. Sebagian kecil dari teks template iklan.", bukan: "Konten Instagram non-iklan." },
  TIKTOK: { apa: "Orang yang chat lewat link iklan TikTok.", bukti: "Teks “saya lihat di TikTok” atau kode klik dari link pelacak.", bukan: "Klik yang hanya berdekatan waktunya dan TikTok organik." },
  GOOGLE: { apa: "Orang yang klik iklan Google, masuk website, lalu chat.", bukti: "Tag berbayar yang dibawa dari website, misalnya google-cpc.", bukan: "Hasil pencarian Google biasa." },
  WEBSITE: { apa: "Orang yang chat lewat tombol website, tetapi asal kunjungannya belum diketahui.", bukti: "Teks tombol website. Datang dari website terbukti, asal kunjungannya belum.", bukan: "Klaim bahwa lead ini pasti organik." },
  INSTAGRAM: { apa: "Orang dari Instagram yang masuk website dulu, lalu chat.", bukti: "Tag ig-social dari website.", bukan: "Iklan Instagram dan DM Instagram." },
  WHATSAPP: { apa: "Orang yang chat tanpa jejak sumber apa pun.", bukti: "Tidak ada. Bisa rekomendasi teman, nomor tersimpan, Google Maps, atau teks iklan yang dihapus.", bukan: "Bukti bahwa orang itu sengaja langsung menghubungi Sano." },
  DIMULAI_SALES: { apa: "Chat pertama dikirim dari pihak Sano ke pelanggan.", bukti: "Pesan pertama percakapan keluar dari CRM.", bukan: "Lead yang datang sendiri dari marketing." },
  LAINNYA: { apa: "Sumber bertag yang belum punya channel sendiri, misalnya Linktree, Threads, ChatGPT, dan profil karyawan.", bukti: "Tag atau link pelacak sumber itu. Rinciannya ada di keterangan sumber.", bukan: "Chat yang dimulai sales." },
});

const CATATAN = Object.freeze({
  "Iklan berbayar": "Punya biaya, jadi bisa dihitung balik modalnya.",
  "Website dan organik": "Tanpa biaya iklan langsung.",
  "Tanpa jejak": "Sumber tidak terbukti. Jangan dibaca sebagai performa satu channel.",
  "Dimulai internal": "Tidak ikut perbandingan marketing.",
  Lainnya: "",
});
const URUTAN = Object.keys(CATATAN);

/** Warna label bukti memakai varian Badge yang sudah ada di tema. */
export const VARIAN_BUKTI = Object.freeze({ Kuat: "green", Sedang: "neutral", "Tidak diketahui": "orange", Internal: "neutral" });

/** Kelompokkan baris yang sudah diurutkan tanpa mengubah urutan di dalam kelompok. Sumber tanpa kelompok masuk Lainnya. */
export function kelompokkanSumber(urut) {
  const peta = new Map(URUTAN.map((n) => [n, []]));
  for (const s of urut || []) (peta.get(s.kelompok) || peta.get("Lainnya")).push(s);
  return URUTAN.filter((n) => peta.get(n).length).map((nama) => ({ nama, catatan: CATATAN[nama], baris: peta.get(nama) }));
}

/** Gabungkan baris laporan level iklan per nama kreatif. Satu customer hanya ada di satu iklan, jadi penjumlahan tidak ganda. Baris tanpa nama (belum terpetakan) tidak digabung. */
export function kelompokkanKreatif(grup) {
  const peta = new Map();
  for (const g of grup || []) {
    const nama = g.status === "MAPPED" ? g.ad?.nama : null;
    if (!nama) continue;
    const k = peta.get(nama) || peta.set(nama, { nama, iklan: 0, lead: 0, spam: 0, berOrder: 0, membayar: 0, lunas: 0, nilai: 0, uang: 0, biaya: 0, biayaAda: false }).get(nama);
    k.iklan++; k.lead += g.lead?.unik || 0; k.spam += g.lead?.spam || 0; k.berOrder += g.customerDenganOrder || 0; k.membayar += g.customerPernahMembayar || 0;
    k.lunas += g.closingUtama?.customerLunasTerbuktiLedger || 0; k.nilai += Number(g.bookedValue) || 0; k.uang += Number(g.uangBersihLedger) || 0;
    if (g.biaya?.spend != null) { k.biaya += Number(g.biaya.spend); k.biayaAda = true; }
  }
  return [...peta.values()].sort((a, b) => b.lead - a.lead || (a.nama < b.nama ? -1 : 1));
}

/** Pemilih daftar chat untuk satu baris laporan Meta; null bila baris itu tidak punya kredit iklan (UNKNOWN, atau UNMAPPED di atas level iklan). */
export function pemilihChatMeta(g) {
  if (!g) return null;
  if (g.level === "ad" && g.ad?.id) return { adId: g.ad.id };
  if (g.status !== "MAPPED") return null;
  if (g.level === "adset") return { adSetId: g.adSet?.id };
  if (g.level === "campaign") return { campaignId: g.campaign?.id };
  return null;
}

/** Cakupan telusur lead Meta sampai iklan; null bila laporan tidak memuatnya (drilldown). */
export function cakupanTelusur(lap) {
  const r = lap?.rekonMetaAds;
  if (!r) return null;
  return { terbukti: r.akuisisiTerbukti, total: r.metaAdsCrmLeadBaru, tidakTerbaca: Math.max(0, r.metaAdsCrmLeadBaru - r.akuisisiTerbukti) };
}

const TAHAP = Object.freeze({ NEW: "Lead baru", PROSPECT: "Prospek", TRANSACTION: "Transaksi", REVIEWED: "Sudah ulasan", SPAM: "Spam" });
/** Satu baris status chat: hasil order lebih dulu, baru tahap. */
export function statusChat(b, rupiah) {
  if (b.spam) return "Spam";
  if (b.berOrder) return `Ber-order ${rupiah(b.nilaiOrder)}${b.statusBayar ? `, ${b.statusBayar.toLowerCase()}` : ""}`;
  return TAHAP[b.stage] || b.stage || "";
}

/** Keterangan sumber lama untuk tampilan; datanya tetap tersimpan apa adanya. */
export const keteranganTampil = (d) => (typeof d === "string" && /^Kemungkinan TikTok\b/i.test(d) ? "Tanpa bukti sumber" : d);
