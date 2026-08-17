// Tombol lampiran (+) → sheet pilih Foto/Video (galeri) | Kamera | Dokumen →
// modal preview (thumbnail + caption per file + toggle HD/Standar) → kirim.
// Pola SAMA dengan
// frontend/src/features/inbox/components/ChatWindow/MediaUploader.jsx,
// kompresi "Standar" pakai expo-image-manipulator (API kontekstual baru
// SDK 57 — manipulateAsync versi lama sudah deprecated, lihat AGENTS.md).
import React, { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Alert, ScrollView,
  ActivityIndicator, Dimensions,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Location from "expo-location";
import * as Contacts from "expo-contacts";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
  Image as ImageIcon, Camera, FileText, X, Video, Package, MapPin, User, Plus, Play,
} from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import { useSheetMaxHeight } from "../lib/useSheetMaxHeight";
import ProductPicker from "./ProductPicker";

let uidCounter = 0;
function nextUid() { uidCounter += 1; return `att-${Date.now()}-${uidCounter}`; }

const { width: SCREEN_W } = Dimensions.get("window");

// uploadFile() (mobile/src/api.js, dipakai api.sendMedia) kadang GAGAL cuma
// di sisi respons — file sudah ke-upload penuh, WAHA sudah kirim ke
// WhatsApp, Message sudah tersimpan di backend, TAPI koneksi seluler lemah
// pas balasan JSON kecil terakhir balik ke HP, jadi client tetap terima
// error. Sebelum vonis "gagal" (yang akan bikin user tergoda pencet ulang
// → kirim dobel ke WhatsApp beneran), cek dulu riwayat pesan: kalau memang
// SUDAH ada pesan OUTBOUND media baru dalam beberapa detik terakhir, itu
// bukti sudah terkirim — anggap sukses.
async function findRecentlySentMedia(conversationId, sinceMs) {
  try {
    const msgs = await api.getMessages(conversationId);
    const cutoff = sinceMs - 3000; // toleransi jam server/klien sedikit meleset
    const candidates = msgs
      .filter((m) => m.direction === "OUTBOUND" && m.mediaType && new Date(m.createdAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return candidates[0] || null;
  } catch {
    return null;
  }
}

function fileNameFromUri(uri, fallbackExt) {
  const last = (uri || "").split("/").pop() || "";
  return last.includes(".") ? last : `file-${Date.now()}.${fallbackExt}`;
}

// Kompresi "Standar" — resize max width 1600 + JPEG quality 0.8, sama
// seperti compressImage() versi web (canvas). Gagal manipulasi → kirim asli.
async function compressImage(uri) {
  try {
    const ref = await ImageManipulator.manipulate(uri).resize({ width: 1600 }).renderAsync();
    const result = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    return result.uri;
  } catch {
    return uri;
  }
}

// Tombolnya TIDAK dirender di sini lagi (dulu satu tombol "+" milik sendiri).
// ChatScreen.js yang menempatkan ikon klip & kamera DI DALAM pill composer
// gaya WhatsApp, lalu memanggil komponen ini lewat ref — jadi komponen ini
// sekarang murni "mesin lampiran" (sheet + preview + upload) tanpa tombol.
// Pola forwardRef+useImperativeHandle sama seperti CustomerSheet.js.
const AttachComposer = forwardRef(function AttachComposer({ conversationId, customerName, onSent }, ref) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  // Preview sekarang layar PENUH (bukan bottom sheet lagi), jadi cuma
  // butuh tinggi keyboard untuk mendorong bar caption+kirim naik — bukan
  // maxHeight/overlayStyle penuh seperti sheet lain di file ini.
  const { keyboardHeight } = useSheetMaxHeight(0.85);
  const [showSheet, setShowSheet] = useState(false);
  const [items, setItems] = useState([]);
  // Item yang sedang ditampilkan besar + caption yang sedang diedit — pola
  // WhatsApp: preview besar SATU per satu + filmstrip di bawahnya untuk
  // pindah, bukan daftar baris kecil-kecil seperti sebelumnya.
  const [activeUid, setActiveUid] = useState(null);
  const [hd, setHd] = useState(false);
  const [sending, setSending] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [sendingProduct, setSendingProduct] = useState(false);
  const [kontakList, setKontakList] = useState(null); // null = picker tertutup
  const [cariKontak, setCariKontak] = useState("");
  const [mengirimLokasi, setMengirimLokasi] = useState(false);

  useImperativeHandle(ref, () => ({
    // Dipanggil ikon klip di composer ChatScreen.
    bukaSheet: () => setShowSheet(true),
    // Dipanggil ikon kamera di composer — langsung ke kamera foto, tanpa
    // mampir ke sheet dulu (persis WhatsApp: ikon kamera = jepret langsung).
    bukaKameraLangsung: () => bukaKamera("foto"),
  }), []);

  // mediaTypeOf: string tetap ("document") ATAU function per-asset (dari
  // ImagePicker, tiap asset punya field .type "image"|"video" sendiri).
  function addAssets(assets, mediaTypeOf) {
    const newItems = assets.map((a) => {
      const mediaType = typeof mediaTypeOf === "function" ? mediaTypeOf(a) : mediaTypeOf;
      return {
        uid: nextUid(),
        uri: a.uri,
        name: a.fileName || a.name || fileNameFromUri(a.uri, mediaType === "video" ? "mp4" : mediaType === "document" ? "bin" : "jpg"),
        type: a.mimeType || (mediaType === "video" ? "video/mp4" : mediaType === "document" ? "application/octet-stream" : "image/jpeg"),
        mediaType,
        caption: "",
        error: null,
      };
    });
    setItems((prev) => [...prev, ...newItems]);
    // Item pertama yang dipilih otomatis jadi yang ditampilkan besar. Kalau
    // menambah lagi lewat "Tambah" (activeUid sudah terisi), yang sedang
    // dilihat TIDAK berpindah — sales mungkin lagi mengetik caption-nya.
    setActiveUid((prev) => prev || newItems[0]?.uid || null);
  }

  async function pickFromGallery() {
    setShowSheet(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"], quality: 1, allowsMultipleSelection: true,
    });
    if (result.canceled || !result.assets?.length) return;
    addAssets(result.assets, (a) => (a.type === "video" ? "video" : "image"));
  }

  // ⚠️ KAMERA WAJIB DIPISAH FOTO vs VIDEO — ini batasan ANDROID, bukan
  // pilihan gaya.
  //
  // Riwayat: 10 Agt 2026 kode ini diubah jadi `mediaTypes: ["images",
  // "videos"]` dengan harapan aplikasi kamera menampilkan toggle foto/video.
  // Perbaikan itu TERLIHAT benar tapi TIDAK MUNGKIN bekerja — dilaporkan
  // masih foto-saja, lalu ditelusuri ke kode native expo-image-picker
  // (node_modules/expo-image-picker/android/.../ImagePickerOptions.kt):
  //
  //     fromJSMediaTypesArray(["images","videos"]) -> MediaTypes.ALL
  //     toCameraIntentAction(): VIDEOS -> ACTION_VIDEO_CAPTURE
  //                             else   -> ACTION_IMAGE_CAPTURE   // ALL di sini
  //
  // Android TIDAK punya intent kamera "foto+video sekaligus" — cuma
  // MediaStore.ACTION_IMAGE_CAPTURE atau ACTION_VIDEO_CAPTURE. Mengirim
  // KEDUANYA justru diam-diam jatuh ke foto saja. (WhatsApp bisa toggle
  // karena memakai kamera bikinan sendiri, bukan intent sistem.)
  //
  // Jadi pengguna yang memilih mode, BUKAN aplikasi kameranya. Satu
  // mediaType per panggilan — itu satu-satunya bentuk yang benar-benar
  // dihormati Android.
  async function bukaKamera(mode) {
    setShowSheet(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Kamera", "Izin kamera diperlukan untuk ambil foto/video");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: mode === "video" ? ["videos"] : ["images"],
      quality: 1,
      // Batas durasi supaya video tidak jadi ratusan MB yang gagal kirim
      // ke WhatsApp (limit WA sekitar 16 MB untuk video biasa).
      ...(mode === "video" ? { videoMaxDuration: 60 } : {}),
    });
    if (result.canceled || !result.assets?.length) return;
    addAssets(result.assets, (a) => (a.type === "video" ? "video" : "image"));
  }

  async function pickDocument() {
    setShowSheet(false);
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;
    addAssets(result.assets, "document");
  }

  function openProductPicker() {
    setShowSheet(false);
    setShowProductPicker(true);
  }

  // Kirim LOKASI SAAT INI. Sengaja tidak ada peta pemilih titik — sales di
  // lapangan hampir selalu ingin membagikan "posisi saya sekarang" (di
  // showroom / di rumah pelanggan). Peta interaktif butuh API key Google
  // Maps + layar tambahan, tidak sepadan untuk kebutuhan itu.
  async function kirimLokasiSekarang() {
    setShowSheet(false);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Lokasi", "Izin lokasi diperlukan untuk membagikan titik lokasi");
      return;
    }
    setMengirimLokasi(true);
    try {
      // Balanced, bukan Highest — akurasi ~100m sudah cukup untuk menunjukkan
      // alamat, sementara Highest bisa menahan sampai belasan detik menunggu
      // fix GPS di dalam ruangan (dan sering gagal total di showroom).
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const msg = await api.sendLocation(conversationId, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        name: null,
      });
      onSent?.(msg);
    } catch (err) {
      Alert.alert("Gagal kirim lokasi", err.message);
    } finally {
      setMengirimLokasi(false);
    }
  }

  // Buka daftar kontak HP untuk dibagikan sebagai kartu kontak.
  async function bukaPilihKontak() {
    setShowSheet(false);
    const perm = await Contacts.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Kontak", "Izin kontak diperlukan untuk membagikan kartu kontak");
      return;
    }
    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
      });
      // Kontak tanpa nomor tidak ada gunanya dibagikan — buang di sini
      // supaya daftar tidak penuh baris yang pasti gagal saat dipilih.
      const berguna = (data || [])
        .filter((c) => c.phoneNumbers?.length)
        .map((c) => ({ id: c.id, name: c.name || "Tanpa nama", phone: c.phoneNumbers[0].number }));
      if (!berguna.length) {
        Alert.alert("Kontak", "Tidak ada kontak bernomor telepon di HP ini");
        return;
      }
      setCariKontak("");
      setKontakList(berguna);
    } catch (err) {
      Alert.alert("Gagal baca kontak", err.message);
    }
  }

  async function kirimKontak(kontak) {
    setKontakList(null);
    try {
      const msg = await api.sendContact(conversationId, { name: kontak.name, phone: kontak.phone });
      onSent?.(msg);
    } catch (err) {
      Alert.alert("Gagal kirim kontak", err.message);
    }
  }

  // Kirim foto produk — beda dari handleSendAll di atas (yang mengunggah FILE
  // dari device): ini kirim gambar yang SUDAH ADA di server (Galeri Produk),
  // jadi satu request ke send-product, backend yang urus WAHA & bikin
  // beberapa Message sekaligus (1 per foto). onSent dipanggil SEKALI PER
  // PESAN — kontrak yang sama seperti loop di handleSendAll — supaya
  // ChatScreen.js tidak perlu tahu bedanya "1 pesan" vs "beberapa pesan
  // sekaligus", cukup satu pola appendMessage per panggilan.
  async function handleSendProduct(payload) {
    setSendingProduct(true);
    try {
      const result = await api.sendProduct(conversationId, payload);
      (result.messages || []).forEach((m) => onSent?.(m));
      setShowProductPicker(false);
    } catch (err) {
      Alert.alert("Gagal kirim produk", err.message);
    } finally {
      setSendingProduct(false);
    }
  }

  function removeItem(uid) {
    setItems((prev) => {
      const next = prev.filter((i) => i.uid !== uid);
      // Kalau yang dihapus adalah yang sedang ditampilkan besar, pindah ke
      // tetangganya — jangan biarkan preview besar kosong sementara
      // filmstrip di bawahnya masih menunjukkan sisa file lain.
      if (uid === activeUid) {
        const idx = prev.findIndex((i) => i.uid === uid);
        setActiveUid(next[idx]?.uid || next[idx - 1]?.uid || next[0]?.uid || null);
      }
      return next;
    });
  }
  function setCaption(uid, caption) {
    setItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, caption } : i)));
  }
  function closePreview() {
    setItems([]);
    setActiveUid(null);
  }

  async function handleSendAll() {
    setSending(true);
    const remaining = [];
    for (const item of items) {
      const startedAt = Date.now();
      try {
        let uri = item.uri;
        let type = item.type;
        let name = item.name;
        if (item.mediaType === "image" && !hd) {
          uri = await compressImage(uri);
          type = "image/jpeg";
          name = name.replace(/\.[^.]+$/, ".jpg");
        }
        const file = { uri, name, type };
        const sendAs = item.mediaType === "document" ? "document" : "media";
        const msg = await api.sendMedia(conversationId, file, item.caption.trim(), sendAs);
        onSent?.(msg);
      } catch (err) {
        const reconciled = await findRecentlySentMedia(conversationId, startedAt);
        if (reconciled) {
          onSent?.(reconciled); // sebenarnya sudah terkirim, cuma respons yang gagal sampai
        } else {
          remaining.push({ ...item, error: err.message });
        }
      }
    }
    setItems(remaining);
    if (!remaining.some((i) => i.uid === activeUid)) setActiveUid(remaining[0]?.uid || null);
    setSending(false);
  }

  // Grid pilihan lampiran — gaya WhatsApp: kotak-kotak berwarna, bukan daftar
  // baris. Warna per jenis membantu sales mengenali tujuan tanpa membaca
  // labelnya lebih dulu (dipakai berulang puluhan kali sehari).
  const PILIHAN = [
    { key: "galeri",   label: "Galeri",   Icon: ImageIcon, warna: "#7C5CFF", aksi: pickFromGallery },
    { key: "kamera",   label: "Kamera",   Icon: Camera,    warna: "#EC4899", aksi: () => bukaKamera("foto") },
    { key: "video",    label: "Video",    Icon: Video,     warna: "#F97316", aksi: () => bukaKamera("video") },
    { key: "dokumen",  label: "Dokumen",  Icon: FileText,  warna: "#3B82F6", aksi: pickDocument },
    { key: "lokasi",   label: "Lokasi",   Icon: MapPin,    warna: "#10B981", aksi: kirimLokasiSekarang },
    { key: "kontak",   label: "Kontak",   Icon: User,      warna: "#0EA5E9", aksi: bukaPilihKontak },
    { key: "produk",   label: "Produk",   Icon: Package,   warna: "#F59E0B", aksi: openProductPicker },
  ];

  const kontakTersaring = kontakList
    ? kontakList.filter((k) => {
        const q = cariKontak.trim().toLowerCase();
        if (!q) return true;
        return k.name.toLowerCase().includes(q) || k.phone.replace(/\D/g, "").includes(q.replace(/\D/g, ""));
      })
    : [];

  return (
    <>
      {/* Sheet pilih sumber lampiran — grid, bukan daftar baris */}
      <Modal visible={showSheet} transparent animationType="fade" onRequestClose={() => setShowSheet(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowSheet(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Lampirkan</Text>
            <View style={styles.grid}>
              {/* Kamera & Video jadi DUA kotak terpisah, bukan satu
                  "Kamera (Foto/Video)" — Android tidak punya intent kamera
                  mode gabungan, lihat catatan panjang di bukaKamera(). */}
              {PILIHAN.map(({ key, label, Icon, warna, aksi }) => (
                <TouchableOpacity key={key} style={styles.gridItem} onPress={aksi}>
                  <View style={[styles.gridIconBox, { backgroundColor: warna }]}>
                    <Icon size={22} color="#fff" strokeWidth={2} />
                  </View>
                  <Text style={styles.gridLabel} numberOfLines={1}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Indikator saat menunggu fix GPS — tanpa ini menekan "Lokasi" terasa
          seperti tombol rusak selama beberapa detik pertama. */}
      <Modal visible={mengirimLokasi} transparent animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingBox}>
            <ActivityIndicator color={tokens.color.accent} />
            <Text style={styles.loadingText}>Mengambil lokasi…</Text>
          </View>
        </View>
      </Modal>

      {/* Pilih kontak dari HP */}
      <Modal visible={!!kontakList} animationType="slide" onRequestClose={() => setKontakList(null)}>
        <View style={styles.kontakRoot}>
          <View style={styles.kontakHeader}>
            <TouchableOpacity onPress={() => setKontakList(null)} style={styles.kontakClose}>
              <X size={22} color={tokens.color.textPrimary} strokeWidth={2.2} />
            </TouchableOpacity>
            <Text style={styles.kontakTitle}>Bagikan Kontak</Text>
            <View style={{ width: 38 }} />
          </View>
          <TextInput
            style={styles.kontakSearch}
            value={cariKontak}
            onChangeText={setCariKontak}
            placeholder="Cari nama atau nomor…"
            placeholderTextColor={tokens.color.textMuted}
          />
          <ScrollView keyboardShouldPersistTaps="handled">
            {kontakTersaring.map((k) => (
              <TouchableOpacity key={k.id} style={styles.kontakRow} onPress={() => kirimKontak(k)}>
                <View style={styles.kontakAvatar}>
                  <User size={16} color={tokens.color.textSecondary} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.kontakNama} numberOfLines={1}>{k.name}</Text>
                  <Text style={styles.kontakNomor} numberOfLines={1}>{k.phone}</Text>
                </View>
              </TouchableOpacity>
            ))}
            {!kontakTersaring.length && (
              <Text style={styles.kontakKosong}>Tidak ada kontak yang cocok.</Text>
            )}
          </ScrollView>
        </View>
      </Modal>

      <ProductPicker
        visible={showProductPicker}
        customerName={customerName}
        sending={sendingProduct}
        onClose={() => setShowProductPicker(false)}
        onSend={handleSendProduct}
      />

      {/* Modal preview sebelum kirim — gaya WhatsApp: layar penuh gelap,
          SATU file ditampilkan besar sekaligus, filmstrip di bawah untuk
          pindah antar file, caption terikat ke file yang sedang aktif.
          Sebelumnya ini daftar baris kecil-kecil (thumbnail 56px + caption
          sejajar) yang terasa jauh dari WhatsApp — diganti total di sini. */}
      <Modal visible={items.length > 0} animationType="slide" onRequestClose={() => !sending && closePreview()}>
        <View style={styles.previewRoot}>
          <View style={styles.previewTopBar}>
            <TouchableOpacity onPress={closePreview} disabled={sending} style={styles.previewTopBtn}>
              <X size={22} color="#fff" strokeWidth={2.2} />
            </TouchableOpacity>
            <Text style={styles.previewCounter}>{items.length} file dipilih</Text>
            <TouchableOpacity
              style={[styles.hdPill, hd && styles.hdPillActive]}
              onPress={() => setHd((v) => !v)}
              disabled={sending}
            >
              <Text style={[styles.hdPillText, hd && styles.hdPillTextActive]}>HD</Text>
            </TouchableOpacity>
          </View>

          {/* Preview besar item aktif */}
          <View style={styles.previewStage}>
            {(() => {
              const active = items.find((i) => i.uid === activeUid) || items[0];
              if (!active) return null;
              if (active.mediaType === "image") {
                return <Image source={{ uri: active.uri }} style={styles.previewStageImage} contentFit="contain" />;
              }
              if (active.mediaType === "video") {
                return (
                  <View style={styles.previewStageImage}>
                    <Image source={{ uri: active.uri }} style={StyleSheet.absoluteFillObject} contentFit="contain" />
                    <View style={styles.previewPlayOverlay}>
                      <Play size={40} color="#fff" fill="#fff" strokeWidth={0} />
                    </View>
                  </View>
                );
              }
              return (
                <View style={styles.previewDocStage}>
                  <FileText size={48} color="rgba(255,255,255,0.7)" strokeWidth={1.5} />
                  <Text style={styles.previewDocName} numberOfLines={2}>{active.name}</Text>
                </View>
              );
            })()}
          </View>

          {/* Filmstrip — cuma tampil kalau >1 file, persis WhatsApp (1 file
              tidak butuh strip pemilih). */}
          {items.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filmstrip}
              keyboardShouldPersistTaps="handled"
            >
              {items.map((item) => (
                <TouchableOpacity
                  key={item.uid}
                  style={[styles.filmstripItem, item.uid === activeUid && styles.filmstripItemActive]}
                  onPress={() => setActiveUid(item.uid)}
                >
                  {item.mediaType === "document" ? (
                    <View style={[styles.filmstripThumb, styles.filmstripDocThumb]}>
                      <FileText size={18} color="rgba(255,255,255,0.8)" strokeWidth={1.8} />
                    </View>
                  ) : (
                    <Image source={{ uri: item.uri }} style={styles.filmstripThumb} contentFit="cover" />
                  )}
                  {item.mediaType === "video" && (
                    <View style={styles.filmstripPlayBadge}>
                      <Play size={10} color="#fff" fill="#fff" strokeWidth={0} />
                    </View>
                  )}
                  {!sending && (
                    <TouchableOpacity style={styles.filmstripRemove} onPress={() => removeItem(item.uid)}>
                      <X size={9} color="#fff" strokeWidth={3} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              ))}
              {/* Tambah foto/video lagi TANPA kehilangan yang sudah dipilih
                  beserta caption-nya — addAssets() meng-APPEND ke `items`,
                  bukan mengganti. */}
              <TouchableOpacity style={[styles.filmstripThumb, styles.filmstripAdd]} onPress={pickFromGallery} disabled={sending}>
                <Plus size={20} color="#fff" strokeWidth={2.2} />
              </TouchableOpacity>
            </ScrollView>
          )}

          {(() => {
            const active = items.find((i) => i.uid === activeUid) || items[0];
            return active?.error ? <Text style={styles.previewError}>{active.error}</Text> : null;
          })()}

          {/* Bar bawah — caption terikat ke file aktif (bukan satu caption
              per file dalam daftar panjang) + Tambah (kalau cuma 1 file,
              filmstrip di atas tersembunyi jadi tombol ini pindah ke sini)
              + Kirim. */}
          <View style={[styles.previewBottomBar, keyboardHeight > 0 && { paddingBottom: keyboardHeight + 10 }]}>
            <TextInput
              style={styles.previewCaptionInput}
              placeholder="Tambahkan keterangan…"
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={(items.find((i) => i.uid === activeUid) || items[0])?.caption || ""}
              editable={!sending}
              onChangeText={(t) => setCaption(activeUid ?? items[0]?.uid, t)}
            />
            {items.length === 1 && (
              <TouchableOpacity style={styles.previewCircleBtn} onPress={pickFromGallery} disabled={sending}>
                <Plus size={20} color="#fff" strokeWidth={2.2} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.previewSendBtn, sending && styles.previewSendBtnDisabled]}
              onPress={handleSendAll}
              disabled={sending}
            >
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.previewSendText}>Kirim{items.length > 1 ? ` (${items.length})` : ""}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
});

export default AttachComposer;

function createStyles(tokens) {
  return StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 18, paddingBottom: 28,
  },
  sheetTitle: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary, marginBottom: 8 },
  // 4 kolom seperti WhatsApp. Lebar pakai persen (bukan angka tetap) supaya
  // ikut benar dari HP kecil sampai tablet tanpa mengukur layar manual.
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  gridItem: { width: "25%", alignItems: "center", paddingVertical: 12 },
  gridIconBox: {
    width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center",
  },
  gridLabel: { fontSize: 11.5, color: tokens.color.textSecondary, marginTop: 7 },
  loadingOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  loadingBox: {
    backgroundColor: tokens.color.card, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 18,
    alignItems: "center", gap: 10,
  },
  loadingText: { fontSize: 13, color: tokens.color.textPrimary },
  kontakRoot: { flex: 1, backgroundColor: tokens.color.bg },
  kontakHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 8, paddingTop: 54, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
  },
  kontakClose: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  kontakTitle: { fontSize: 16, fontWeight: "700", color: tokens.color.textPrimary },
  kontakSearch: {
    margin: 12, backgroundColor: tokens.color.card, borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 14, color: tokens.color.textPrimary,
    borderWidth: 1, borderColor: tokens.color.border,
  },
  kontakRow: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
  },
  kontakAvatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: tokens.color.subtle,
    alignItems: "center", justifyContent: "center",
  },
  kontakNama: { fontSize: 14.5, color: tokens.color.textPrimary, fontWeight: "600" },
  kontakNomor: { fontSize: 12.5, color: tokens.color.textMuted },
  kontakKosong: { fontSize: 13, color: tokens.color.textMuted, textAlign: "center", padding: 24 },
  // Preview kirim media — gaya WhatsApp, layar penuh gelap. Warna DIPATOK
  // (bukan token tema) — persis videoThumb/albumTile di MessageBubble.js,
  // konsisten dengan area "panggung media" lain di app ini yang selalu
  // gelap terlepas dari tema terang/gelap CRM.
  previewRoot: { flex: 1, backgroundColor: "#000" },
  previewTopBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 54, paddingHorizontal: 8, paddingBottom: 10,
  },
  previewTopBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  previewCounter: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "600" },
  hdPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.12)" },
  hdPillActive: { backgroundColor: tokens.color.accent },
  hdPillText: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.7)" },
  hdPillTextActive: { color: "#fff" },
  previewStage: { flex: 1, alignItems: "center", justifyContent: "center" },
  previewStageImage: { width: SCREEN_W, height: "100%" },
  previewPlayOverlay: {
    ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  previewDocStage: { alignItems: "center", gap: 12, paddingHorizontal: 32 },
  previewDocName: { color: "#fff", fontSize: 14, textAlign: "center" },
  previewError: { color: tokens.color.danger, fontSize: 12, textAlign: "center", paddingBottom: 6 },
  filmstrip: { paddingHorizontal: 10, paddingBottom: 10, gap: 8 },
  filmstripItem: { position: "relative", borderRadius: 8, opacity: 0.55 },
  filmstripItemActive: { opacity: 1 },
  filmstripThumb: {
    width: 52, height: 52, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 2, borderColor: "transparent",
  },
  filmstripDocThumb: { alignItems: "center", justifyContent: "center" },
  filmstripPlayBadge: {
    position: "absolute", bottom: 3, right: 3, width: 16, height: 16, borderRadius: 8,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)",
  },
  filmstripRemove: {
    position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: 8,
    backgroundColor: tokens.color.danger, alignItems: "center", justifyContent: "center",
  },
  filmstripAdd: {
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)", opacity: 1,
  },
  previewBottomBar: {
    flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  previewCaptionInput: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 22, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 14, color: "#fff",
  },
  previewCircleBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  previewSendBtn: {
    minWidth: 44, height: 44, borderRadius: 22, paddingHorizontal: 16,
    alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.accent,
  },
  previewSendBtnDisabled: { opacity: 0.6 },
  previewSendText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  });
}
