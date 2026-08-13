// Atribusi sumber lead — mencocokkan PESAN PERTAMA customer ke campaign.
//
// KENAPA INI ADA. Sebelumnya atribusi campaign cuma mengandalkan "ambil
// ClickEvent terakhir yang belum ter-match dalam 15 menit" (Lapis 2 di
// webhooks.js). Pencarian itu GLOBAL — tidak terikat ke orangnya sama
// sekali. Di volume 50-100 pesan/hari, dua orang yang mengklik iklan
// BERBEDA dalam 15 menit yang sama bisa tertukar sumbernya, dan setelah
// kejadian tidak ada jejak untuk mendeteksinya.
//
// Sinyal yang jauh lebih kuat sudah tersedia sejak awal tapi tidak pernah
// dipakai: link pelacakan melempar customer ke
// wa.me/<nomor>?text=<prefilledMessage>, jadi PESAN PERTAMA customer
// secara harfiah ADALAH teks kampanye itu. Mencocokkan teks =
// deterministik, tidak ada lomba waktu.
//
// ⚠️ SYARAT PAKAI: tiap campaign WAJIB punya prefilledMessage BERBEDA.
// Kalau dua link aktif memakai teks yang sama persis, fungsi ini sengaja
// menyerah (return null) alih-alih menebak. Menebak sumber iklan lebih
// berbahaya daripada mengaku tidak tahu — angkanya dipakai untuk
// keputusan belanja iklan, dan tebakan yang salah tidak kelihatan salah.
//
// ⚠️ INI TIDAK MENANGKAP 100% KLIK IKLAN. Sebagian customer menghapus
// atau mengetik ulang pesan prefilled sebelum mengirim. Yang tidak cocok
// jatuh ke Lapis 2 (jendela 15 menit) seperti sebelumnya — jadi ini
// menambah ketepatan, bukan menggantikan seluruh alurnya.

/** Samakan bentuk teks sebelum dibandingkan: huruf kecil, spasi rapat. */
function normalize(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Cari campaign yang pesan prefilled-nya jadi AWALAN pesan customer.
 *
 * Pakai awalan (bukan sama persis) karena customer sering menambahkan
 * kalimatnya sendiri di belakang teks bawaan — "Halo Sano, saya mau tanya
 * soal nyeri punggung. Umur saya 40th" harus tetap kena.
 *
 * @param {string} text  pesan pertama customer
 * @param {Array}  links link aktif: { id, name, category, prefilledMessage }
 * @returns {object|null} link yang cocok, atau null kalau tidak ada/ambigu
 */
export function matchCampaignByMessage(text, links) {
  const pesan = normalize(text);
  if (!pesan || !Array.isArray(links)) return null;

  const kandidat = links
    .map((l) => ({ link: l, teks: normalize(l.prefilledMessage) }))
    .filter((k) => k.teks && pesan.startsWith(k.teks));

  if (kandidat.length === 0) return null;

  // Yang paling PANJANG menang — teks kampanye yang lebih spesifik
  // mengalahkan teks umum yang kebetulan jadi awalannya. Contoh:
  //   A: "halo sano, saya mau konsultasi"
  //   B: "halo sano, saya mau konsultasi soal nyeri punggung"
  // Pesan yang persis sama dengan B cocok ke DUA-duanya; B yang benar.
  kandidat.sort((a, b) => b.teks.length - a.teks.length);

  // SERI = dua campaign memakai teks identik. Tidak ada cara membedakan,
  // jadi menyerah (biar jatuh ke Lapis 2) daripada memilih sembarang.
  if (kandidat.length > 1 && kandidat[1].teks.length === kandidat[0].teks.length) {
    return null;
  }

  return kandidat[0].link;
}

/** Kategori link (LinkCategory) -> sumber lead (LeadSource). */
export const CATEGORY_TO_LEAD_SOURCE = {
  META_ADS: "META_ADS",
  GOOGLE_ADS: "GOOGLE_ADS",
  WEBSITE_ORGANIC: "WEBSITE_ORGANIC",
  OTHER: "OTHER",
};

// ─── Tag dari website sanomatrassehat.com ───────────────────────────────
//
// Google Search & PMax mendarat di WEBSITE dulu (bukan langsung ke
// WhatsApp seperti TrackedLink), jadi jejak "dari campaign mana" akan
// hilang begitu customer pindah ke WA — KECUALI website-nya sendiri
// menempelkan tag ke pesan yang dikirim. Lihat utils/attribution.ts di
// repo SANO-WEB (terpisah): kalau pengunjung datang dari iklan (ada
// utm_source/gclid/fbclid di URL), tombol WA di situs menambahkan tag
// ke akhir pesan prefilled.
//
// Ini sinyal PALING KUAT yang tersedia (eksplisit, bukan tebakan/
// kemiripan teks) — makanya dicek PALING AWAL di webhooks.js, sebelum
// Lapis 1 (pencocokan teks ke TrackedLink).
//
// TAK TERLIHAT (zero-width Unicode), bukan lagi teks kasat mata
// "(ref: ...)" — customer sempat lihat versi lama itu di kotak chat WA
// sebelum kirim. Encoding & alasannya HARUS SELALU DISAMAKAN MANUAL
// dengan utils/attribution.ts di SANO-WEB (repo terpisah, tidak ada
// package bersama) — kalau salah satu diubah, yang lain ikut diubah.
//
// SENGAJA pakai String.fromCharCode(kode hex), BUKAN karakter invisible
// ditempel langsung di source — alasan sama dengan sisi website: karakter
// literal gampang rusak lewat editor/git/encoding, dan mustahil diperiksa
// dengan mata.
const REF_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789-";
const BIT0 = String.fromCharCode(0x200b);                                     // ZERO WIDTH SPACE     -> bit 0
const BIT1 = String.fromCharCode(0x200c);                                     // ZERO WIDTH NON-JOINER -> bit 1
const START_MARK = String.fromCharCode(0x200d) + String.fromCharCode(0x200d); // ZERO WIDTH JOINER x2 -> penanda mulai
const END_MARK = String.fromCharCode(0x2060) + String.fromCharCode(0x2060);   // WORD JOINER x2       -> penanda selesai

// Pola LAMA (teks kasat mata "(ref: ...)") — dipertahankan sebagai jaring
// cadangan SAJA, murah dan tidak mengganggu apa pun kalau tidak pernah
// cocok. Kemungkinan realistis kena: tab browser lama yang masih memuat
// versi website SEBELUM tag disembunyikan.
const LEGACY_VISIBLE_PATTERN = /\s*\(ref:\s*([a-z0-9-]+)\)\s*$/i;

/**
 * Pisahkan tag referral (format tak-terlihat ATAU pola lama kasat mata)
 * dari teks pesan asli.
 *
 * ⚠️ RAPUH BY DESIGN (disepakati bersama, bukan kelalaian): kalau customer
 * menghapus SEMUA teks prefilled lalu mengetik ulang dari nol, tag ini
 * ikut hilang tanpa jejak — datanya nitip DI DALAM teks yang dihapus,
 * tidak ada encoding yang bisa selamat dari itu. Kalau customer cuma
 * NAMBAH di belakang (paling umum), tag tetap aman — marker dicari DI
 * MANA SAJA dalam teks, tidak diwajibkan persis di ujung kalimat.
 *
 * @returns {{ cleaned: string, tag: string|null }} cleaned = teks TANPA
 *   marker apa pun (ini yang disimpan/ditampilkan ke sales).
 */
export function extractRefTag(text) {
  const asli = String(text || "");

  const start = asli.indexOf(START_MARK);
  if (start !== -1) {
    const end = asli.indexOf(END_MARK, start + START_MARK.length);
    if (end !== -1) {
      const payload = asli.slice(start + START_MARK.length, end);
      const cleaned = (asli.slice(0, start) + asli.slice(end + END_MARK.length)).trim();

      if (payload.length > 0 && payload.length % 6 === 0) {
        let tag = "";
        let valid = true;
        for (let i = 0; i < payload.length && valid; i += 6) {
          let bits = "";
          for (const ch of payload.slice(i, i + 6)) {
            if (ch === BIT0) bits += "0";
            else if (ch === BIT1) bits += "1";
            else { valid = false; break; }
          }
          if (!valid) break;
          const idx = parseInt(bits, 2);
          if (idx >= REF_ALPHABET.length) { valid = false; break; }
          tag += REF_ALPHABET[idx];
        }
        if (valid) return { cleaned, tag };
      }
      // Marker ketemu tapi payload rusak/tidak valid -- tetap buang
      // marker-nya dari teks tersimpan (jangan sampai sales lihat
      // karakter zero-width nyasar), tapi jangan mengarang tag.
      return { cleaned, tag: null };
    }
  }

  const match = LEGACY_VISIBLE_PATTERN.exec(asli);
  if (match) return { cleaned: asli.slice(0, match.index).trimEnd(), tag: match[1].toLowerCase() };

  return { cleaned: asli, tag: null };
}

// Tag berbentuk "<source>-<medium>[-<campaign>]" (lihat getRefTag di
// SANO-WEB). SEBELUM INI mapping cuma cek prefix source ("startsWith
// google" -> GOOGLE_ADS APAPUN medium-nya) -- artinya tag hipotetis
// "google-organic" (orang yang klik hasil pencarian organik, bukan
// iklan, tapi kebetulan lewat link ber-UTM source=google) akan SALAH
// dihitung sebagai belanja iklan. Sekarang medium ikut menentukan:
// hanya medium "berbayar" yang boleh mengklaim *_ADS.
const MEDIUM_BERBAYAR = new Set(["cpc", "ppc", "paid", "display", "pmax"]);

/** Tag ref (mis. "google-cpc-brand", "ig-social") -> LeadSource. */
export function leadSourceFromRefTag(tag) {
  if (!tag) return null;
  const [source = "", medium = ""] = tag.split("-");
  const dibayar = MEDIUM_BERBAYAR.has(medium);

  if (source === "google") return dibayar ? "GOOGLE_ADS" : "WEBSITE_ORGANIC";
  if (source === "meta" || source === "facebook" || source === "fb") {
    return dibayar ? "META_ADS" : "WEBSITE_ORGANIC";
  }
  if (source === "ig" || source === "instagram") {
    return dibayar ? "META_ADS" : "INSTAGRAM";
  }
  if (source === "referral" || medium === "referral") return "REFERRAL";

  // TikTok & sumber lain di luar daftar: TIDAK ADA nilai enum TikTok di
  // LeadSource (schema.prisma) -- jangan dikarang jadi salah satu
  // platform yang memang ada. Tag mentahnya tetap utuh di
  // leadSourceDetail ("Website - tiktok-organic" dst) supaya sales
  // masih lihat sumber aslinya walau dibucket OTHER.
  return "OTHER";
}

// ─── Iklan Meta Click-to-WhatsApp (CTWA) ────────────────────────────────
//
// Iklan CTWA melompat LANGSUNG dari Meta ke WhatsApp — TIDAK lewat
// website — jadi tag tak-terlihat dari sanomatrassehat.com tidak pernah
// kepasang. Sebelum ini seluruh trafik CTWA jatuh ke WHATSAPP_DIRECT dan
// terbaca seolah "organik".
//
// PATH-nya diverifikasi dari payload production ASLI (13 Agt 2026), BUKAN
// dari dokumentasi/tebakan — versi lama kode mencari di `_data.conversionSource`
// & `_data.Info.CtwaContext` yang MEMANG TIDAK PERNAH ADA, itu sebabnya
// tidak pernah kena sekalipun. Yang benar (engine GOWS):
//
//   _data.Message.<tipePesan>.contextInfo.conversionSource         = "FB_Ads"
//   _data.Message.<tipePesan>.contextInfo.entryPointConversionSource = "ctwa_ad"
//   _data.Message.<tipePesan>.contextInfo.entryPointConversionApp    = "facebook"
//   _data.Message.<tipePesan>.contextInfo.externalAdReply.ctwaClid   = "Afh..."
//   _data.Message.<tipePesan>.contextInfo.externalAdReply.sourceURL  = "https://instagram.com/p/..."
//
// <tipePesan> tidak selalu "extendedTextMessage" (bisa imageMessage dst),
// jadi ditelusuri per-kunci, bukan di-hardcode satu tipe.

// contextInfo JUGA muncul di pesan biasa yang me-REPLY chat lain (isinya
// quotedMessage/stanzaId). Penanda di bawah ini yang membedakan "ini dari
// iklan" vs "ini cuma reply" — tanpa ini setiap reply akan salah dilabeli
// iklan Meta.
const PENANDA_IKLAN_CTWA = /fb_ads|ig_ads|ctwa_ad/i;

/**
 * Ambil konteks iklan CTWA dari payload WAHA.
 * @returns {{clid, sourceUrl, conversionSource, app, entryPoint}|null}
 */
export function extractCtwaContext(payload) {
  const wadah = [payload?._data?.Message, payload?._data?.RawMessage];
  for (const msg of wadah) {
    if (!msg || typeof msg !== "object") continue;
    for (const tipe of Object.keys(msg)) {
      const ctx = msg[tipe]?.contextInfo;
      if (!ctx || typeof ctx !== "object") continue;

      const clid = ctx.externalAdReply?.ctwaClid || null;
      const conversionSource = ctx.conversionSource || null;
      const entryPoint = ctx.entryPointConversionSource || null;
      if (!clid && !conversionSource && !entryPoint) continue; // reply biasa

      return {
        clid,
        sourceUrl: ctx.externalAdReply?.sourceURL || null,
        conversionSource,
        app: ctx.entryPointConversionApp || null,
        entryPoint,
      };
    }
  }
  return null;
}

/**
 * Konteks CTWA -> LeadSource. Sengaja HANYA mengklaim META_ADS kalau
 * penandanya benar-benar iklan — kalau contextInfo ada tapi bukan iklan
 * (mis. entry point dari QR code / link profil), kembalikan null supaya
 * jatuh ke lapis berikutnya, BUKAN dikarang jadi iklan berbayar.
 */
export function leadSourceFromCtwa(ctwa) {
  if (!ctwa) return null;
  if (ctwa.clid) return "META_ADS"; // clid hanya lahir dari klik iklan
  const penanda = `${ctwa.conversionSource || ""} ${ctwa.entryPoint || ""}`;
  return PENANDA_IKLAN_CTWA.test(penanda) ? "META_ADS" : null;
}

/** Keterangan singkat untuk kolom leadSourceDetail di CRM. */
export function ctwaDetail(ctwa) {
  if (!ctwa) return null;
  const bagian = ["Meta CTWA"];
  if (ctwa.app) bagian.push(ctwa.app);
  if (ctwa.sourceUrl) {
    bagian.push(String(ctwa.sourceUrl).replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, ""));
  }
  return bagian.join(" - ");
}
