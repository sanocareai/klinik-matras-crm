// "Ajukan Klaim Lunas" — aplikasi Sales (paritas web: frontend/src/features/klaim/KlaimLunasDialog.jsx + KlaimLunasPanel.jsx).
//
// Sales TIDAK lagi menandai order Lunas sendiri. Di sini Sales mengajukan klaim: tanggal, nominal, metode, rekening tujuan (Transfer), catatan, dan minimal
// satu Bukti Pembayaran. Mengajukan klaim TIDAK mengubah status pembayaran — status berubah setelah Finance memverifikasi. Tombol "Ajukan Klaim Lunas"
// nonaktif sampai isian lengkap DAN semua bukti sudah dikonfirmasi tersimpan oleh server. Server tetap menolak pengajuan yang tidak lengkap.
//
// OFFLINE: isian + foto yang belum terunggah disimpan sebagai draf lokal di perangkat (lib/klaimLunas.js). Foto diunggah saat online; pengajuan
// hanya bisa setelah semua unggahan selesai.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, StyleSheet, Image, KeyboardAvoidingView, Platform, Linking,
} from "react-native";
import { BadgeCheck, Camera, FileText, X, AlertCircle, FileWarning, RefreshCw } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import NetInfo from "@react-native-community/netinfo";
import { api, mediaUrl } from "../../api";
import storage from "../../lib/storage";
import { useTokens } from "../../constants/theme";
import { formatRupiah } from "../../utils/format";
import DateField from "../DateField";
import { useKlaimLunasAktif } from "../../lib/klaimGate";
import {
  METODE_KLAIM, STATUS_KLAIM_LABEL, STATUS_BISA_DIEDIT, STATUS_BUKTI, MAKS_BUKTI,
  bisaDiajukan, alasanNonaktif, cekBerkas, formDariKlaim, buktiDariKlaim, bodyDariForm,
  JENIS_BAYAR, nominalOtomatis, jenisDariNominal, dampakNominal,
  simpanDrafLokal, bacaDrafLokal, hapusDrafLokal,
} from "../../lib/klaimLunas";

function kunciUnik() {
  return `ajukan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const off = NetInfo.addEventListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false));
    return () => off();
  }, []);
  return online;
}

/** Panel ringkas di tab Pembayaran: status klaim terkini + tombol. `onChanged` dipanggil setelah klaim berubah (muat ulang order). */
export default function OrderKlaimLunas({ order, onChanged, autoOpen = false }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const gateAktif = useKlaimLunasAktif(); // sakelar rollout: MATI → tidak tampil (UI lama)
  const [info, setInfo] = useState(null);
  const [buka, setBuka] = useState(false);

  const muat = useCallback(() => {
    if (gateAktif !== true) return;
    api.getKlaimLunasOrder(order.id).then(setInfo).catch(() => setInfo(null));
  }, [order.id, gateAktif]);
  useEffect(() => { setInfo(null); muat(); }, [muat]);

  // Jalan pintas "Catat Pembayaran" dari kartu order: buka sheet sekali begitu info klaim termuat dan order memang bisa diklaim.
  const sudahAutoBuka = useRef(false);
  useEffect(() => {
    if (autoOpen && info && !sudahAutoBuka.current && (info.bolehDiklaim || info.klaimAktifId)) { sudahAutoBuka.current = true; setBuka(true); }
  }, [autoOpen, info]);

  if (gateAktif !== true || !info) return null;
  const aktif = info.klaim.find((k) => k.id === info.klaimAktifId) || null;
  const ditolak = !aktif ? info.klaim.find((k) => k.status === "REJECTED") : null;
  const terakhir = aktif || ditolak;
  if (!info.bolehDiklaim && !terakhir && !info.buktiBelumLengkap) return null;

  const teksTombol = !terakhir ? "Ajukan Pembayaran (DP / Lunas)"
    : terakhir.status === "SUBMITTED" ? "Lihat Klaim"
      : terakhir.status === "DRAFT" ? "Lengkapi & Ajukan Klaim" : "Perbaiki & Ajukan Ulang";

  return (
    <View style={styles.card} testID="panel-klaim-lunas">
      <View style={styles.head}><BadgeCheck size={13} color={tokens.color.textMuted} strokeWidth={2.2} /><Text style={styles.title}>Pembayaran (DP / Lunas)</Text></View>
      {info.buktiBelumLengkap && !terakhir ? (
        <View style={[styles.banner, { backgroundColor: "rgba(245,158,11,0.16)" }]}>
          <FileWarning size={14} color={tokens.color.warning || "#B45309"} />
          <Text style={[styles.bannerText, { color: tokens.color.warning || "#B45309" }]}>Bukti belum lengkap — order ini ditandai Lunas tetapi belum ada pembayaran tercatat.</Text>
        </View>
      ) : null}
      {terakhir ? (
        <View style={[styles.banner, { backgroundColor: terakhir.status === "SUBMITTED" ? "rgba(16,185,129,0.16)" : tokens.color.subtle }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>{STATUS_KLAIM_LABEL[terakhir.status] || terakhir.status}</Text>
            {terakhir.reviewReason ? <Text style={styles.bannerText}>Alasan Finance: {terakhir.reviewReason}</Text> : null}
          </View>
        </View>
      ) : null}
      <TouchableOpacity style={styles.primary} onPress={() => setBuka(true)} accessibilityRole="button" accessibilityLabel={teksTombol}>
        <Text style={styles.primaryText}>{teksTombol}</Text>
      </TouchableOpacity>
      <Text style={styles.muted}>Status pembayaran berubah menjadi Lunas setelah Finance memverifikasi bukti pembayaran.</Text>
      {buka ? (
        <KlaimLunasSheet
          order={order}
          onClose={() => { setBuka(false); muat(); }}
          onChanged={() => { muat(); onChanged?.(); }}
        />
      ) : null}
    </View>
  );
}

function KlaimLunasSheet({ order, onClose, onChanged }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const online = useOnline();
  const [info, setInfo] = useState(null);
  const [klaim, setKlaim] = useState(null);
  const [form, setForm] = useState(() => formDariKlaim(null));
  const [bukti, setBukti] = useState([]); // [{ key, id?, nama, mime, url?, file?, status, galat? }]
  const [rekening, setRekening] = useState([]);
  const [memuat, setMemuat] = useState(true);
  const [mengirim, setMengirim] = useState(false);
  const [galat, setGalat] = useState("");
  const idKlaim = useRef(null);
  const membuatDraft = useRef(null);
  const kunciAjukan = useRef(kunciUnik()); // satu kunci per niat mengajukan — ketuk ganda / ulang jaringan tidak menggandakan
  idKlaim.current = klaim?.id || null;

  const muat = useCallback(async () => {
    setMemuat(true); setGalat("");
    try {
      const d = await api.getKlaimLunasOrder(order.id);
      setInfo(d);
      const sumber = (d.klaimAktifId && d.klaim.find((k) => k.id === d.klaimAktifId)) || d.klaim.find((k) => k.status === "REJECTED") || null;
      setKlaim(sumber);
      const dasar = formDariKlaim(sumber, { sisa: d.sisa, dibayar: d.dibayar, dpTarget: order.dpTarget ?? null });
      // Draf lokal (offline) menimpa isian default selama klaim di server masih bisa diedit.
      const lokal = !sumber || STATUS_BISA_DIEDIT.includes(sumber.status) ? bacaDrafLokal(storage, order.id) : null;
      setForm(lokal ? { ...dasar, ...lokal.form } : dasar);
      setBukti([
        ...buktiDariKlaim(sumber),
        ...(lokal?.foto || []).map((f, i) => ({ key: `lokal-${i}-${f.uri}`, nama: f.name, mime: f.type, file: f, status: STATUS_BUKTI.ANTRE })),
      ]);
    } catch (e) { setGalat(e.message); } finally { setMemuat(false); }
  }, [order.id]);
  useEffect(() => { muat(); }, [muat]);

  useEffect(() => {
    let batal = false;
    api.getPaymentAccounts(form.method).then((l) => {
      if (batal) return;
      const daftar = Array.isArray(l) ? l : [];
      setRekening(daftar);
      setForm((f) => (daftar.some((a) => a.id === f.cashAccountId) ? f : { ...f, cashAccountId: daftar.length === 1 ? daftar[0].id : "" }));
    }).catch(() => { if (!batal) setRekening([]); });
    return () => { batal = true; };
  }, [form.method]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // Jenis (DP / Pelunasan) hanya bantuan UI: memilih jenis mengisi nominal otomatis; mengetik nominal menyesuaikan jenis. Server hanya menerima nominal ≤ sisa.
  const pilihJenis = (j) => setForm((f) => ({ ...f, jenis: j, amount: nominalOtomatis(j, { sisa: info?.sisa ?? 0, dibayar: info?.dibayar ?? 0, dpTarget: order.dpTarget ?? null }) }));
  const ubahNominal = (v) => setForm((f) => ({ ...f, amount: v, jenis: v === "" ? f.jenis : jenisDariNominal(v, { sisa: info?.sisa ?? 0 }) }));
  const bisaDiedit = !klaim || STATUS_BISA_DIEDIT.includes(klaim.status);
  const menunggu = klaim?.status === "SUBMITTED";

  // Simpan draf lokal tiap isian/bukti-antre berubah (hanya selagi bisa diedit) — bertahan walau aplikasi ditutup / offline.
  useEffect(() => {
    if (memuat || !bisaDiedit) return;
    simpanDrafLokal(storage, order.id, { form, foto: bukti.filter((b) => b.status !== STATUS_BUKTI.TERSIMPAN && b.file).map((b) => b.file) });
  }, [form, bukti, memuat, bisaDiedit, order.id]);

  async function pastikanDraft() {
    if (idKlaim.current) return idKlaim.current;
    if (!membuatDraft.current) {
      membuatDraft.current = api.buatDraftKlaimLunas(order.id, bodyDariForm(form))
        .then((r) => { setKlaim(r.klaim); idKlaim.current = r.klaim.id; return r.klaim.id; })
        .finally(() => { membuatDraft.current = null; });
    }
    return membuatDraft.current;
  }

  async function kirimSatu(item) {
    setBukti((l) => l.map((x) => (x.key === item.key ? { ...x, status: STATUS_BUKTI.MENGUNGGAH, galat: undefined } : x)));
    try {
      const id = await pastikanDraft();
      const r = await api.unggahBuktiKlaimLunas(id, item.file);
      // "tersimpan" HANYA setelah server mengonfirmasi (respons 2xx berisi baris bukti).
      setBukti((l) => l.map((x) => (x.key === item.key ? { key: r.bukti.id, id: r.bukti.id, nama: r.bukti.nama, mime: r.bukti.mime, url: r.bukti.url, status: STATUS_BUKTI.TERSIMPAN } : x)));
    } catch (e) {
      setBukti((l) => l.map((x) => (x.key === item.key ? { ...x, status: STATUS_BUKTI.GAGAL, galat: e.message } : x)));
    }
  }

  /** Tambah berkas: masuk antrean; dikirim langsung bila online, kalau tidak menunggu koneksi (draf lokal). */
  function tambah(files) {
    setGalat("");
    const sisa = MAKS_BUKTI - bukti.length;
    if (sisa <= 0) { setGalat(`Maksimal ${MAKS_BUKTI} Bukti Pembayaran.`); return; }
    for (const file of files.slice(0, sisa)) {
      const salah = cekBerkas(file);
      if (salah) { setGalat(salah); continue; }
      const item = { key: `b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, nama: file.name, mime: file.type, file, status: STATUS_BUKTI.ANTRE };
      setBukti((l) => [...l, item]);
      if (online) kirimSatu(item);
    }
  }

  // Koneksi kembali: kirim bukti yang masih antre / gagal.
  useEffect(() => {
    if (!online || !bisaDiedit) return;
    bukti.filter((b) => b.status === STATUS_BUKTI.ANTRE && b.file).forEach(kirimSatu);
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  const toFile = (a, nama) => ({ uri: a.uri, name: a.fileName || a.name || nama, type: a.mimeType || a.type || "image/jpeg", size: a.fileSize || a.size });

  function pilihSumber() {
    Alert.alert("Bukti Pembayaran", "Ambil dari mana?", [
      {
        text: "Kamera",
        onPress: async () => {
          const p = await ImagePicker.requestCameraPermissionsAsync();
          if (!p.granted) { Alert.alert("Kamera", "Izin kamera diperlukan untuk ambil foto"); return; }
          const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
          if (!r.canceled && r.assets?.length) tambah(r.assets.map((a) => toFile(a, "bukti.jpg")));
        },
      },
      {
        text: "Galeri (bisa banyak)",
        onPress: async () => {
          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, allowsMultipleSelection: true, selectionLimit: MAKS_BUKTI - bukti.length });
          if (!r.canceled && r.assets?.length) tambah(r.assets.map((a) => toFile(a, "bukti.jpg")));
        },
      },
      {
        text: "File PDF",
        onPress: async () => {
          const r = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true, multiple: true });
          if (!r.canceled && r.assets?.length) tambah(r.assets.map((a) => toFile(a, "bukti.pdf")));
        },
      },
      { text: "Batal", style: "cancel" },
    ]);
  }

  async function hapus(b) {
    if (!b.id) { setBukti((l) => l.filter((x) => x.key !== b.key)); return; } // belum pernah sampai server
    try { await api.hapusBuktiKlaimLunas(idKlaim.current, b.id); setBukti((l) => l.filter((x) => x.key !== b.key)); } catch (e) { setGalat(e.message); }
  }

  async function simpanDraft() {
    setMengirim(true); setGalat("");
    try {
      simpanDrafLokal(storage, order.id, { form, foto: bukti.filter((b) => b.status !== STATUS_BUKTI.TERSIMPAN && b.file).map((b) => b.file) });
      if (online) {
        if (idKlaim.current) { const r = await api.ubahKlaimLunas(idKlaim.current, bodyDariForm(form)); setKlaim(r.klaim); } else await pastikanDraft();
        onChanged?.();
        Alert.alert("Draft tersimpan", "Klaim belum diajukan. Lengkapi bukti lalu ajukan.");
      } else {
        Alert.alert("Draft tersimpan di perangkat", "Tidak ada koneksi. Buka lagi saat online untuk mengunggah bukti dan mengajukan.");
      }
    } catch (e) { setGalat(e.message); } finally { setMengirim(false); }
  }

  async function ajukan() {
    if (!bisaDiajukan(form, bukti, { mengirim, online, sisa: info?.sisa ?? null })) return;
    setMengirim(true); setGalat("");
    try {
      const id = await pastikanDraft();
      await api.ubahKlaimLunas(id, bodyDariForm(form));
      await api.ajukanKlaimLunas(id, kunciAjukan.current);
      hapusDrafLokal(storage, order.id);
      onChanged?.();
      onClose();
      Alert.alert("Klaim diajukan", "Menunggu verifikasi Finance. Status pembayaran order belum berubah sampai Finance memverifikasi.");
    } catch (e) {
      kunciAjukan.current = kunciUnik(); // galat → percobaan berikutnya adalah niat baru
      setGalat(e.message);
    } finally { setMengirim(false); }
  }

  function tarik() {
    Alert.alert("Tarik klaim?", "Anda bisa mengajukan klaim baru setelahnya.", [
      { text: "Batal", style: "cancel" },
      { text: "Tarik", style: "destructive", onPress: async () => {
        setMengirim(true);
        try { await api.tarikKlaimLunas(klaim.id); hapusDrafLokal(storage, order.id); onChanged?.(); onClose(); } catch (e) { setGalat(e.message); } finally { setMengirim(false); }
      } },
    ]);
  }

  const aktifTombol = bisaDiedit && bisaDiajukan(form, bukti, { mengirim, online, sisa: info?.sisa ?? null });
  const bantu = bisaDiedit ? alasanNonaktif(form, bukti, { mengirim, online, sisa: info?.sisa ?? null }) : null;
  const dampak = dampakNominal(form.amount, { sisa: info?.sisa ?? 0 });
  const tombolAjukan = form.jenis === "DP" ? "Ajukan Pembayaran DP" : "Ajukan Klaim Lunas";
  const adaUnggahan = bukti.some((b) => b.status === STATUS_BUKTI.MENGUNGGAH);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !mengirim && onClose()}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>Ajukan Pembayaran (DP / Lunas)</Text>
              {order.orderNumber ? <Text style={styles.muted}>Order {order.orderNumber}</Text> : null}
            </View>
            <TouchableOpacity onPress={onClose} disabled={mengirim} accessibilityLabel="Tutup" style={styles.closeBtn}><X size={18} color={tokens.color.textSecondary} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
            {memuat ? <ActivityIndicator color={tokens.color.accent} /> : !info ? (
              <Text style={[styles.muted, { color: tokens.color.danger }]}>{galat || "Gagal memuat"}</Text>
            ) : !klaim && !info.bolehDiklaim ? (
              <View style={styles.banner}><AlertCircle size={16} color={tokens.color.textSecondary} /><Text style={styles.bannerText}>{info.alasanTidakBisa || "Order ini tidak bisa diklaim."}</Text></View>
            ) : (
              <>
                <View style={[styles.banner, { backgroundColor: tokens.color.accentSoft }]}>
                  <Text style={[styles.bannerText, { color: tokens.color.accent }]}>
                    Mengajukan klaim tidak mengubah status pembayaran. Status berubah (DP atau Lunas, sesuai nominal) setelah Finance memeriksa bukti dan uangnya. Sisa tagihan: {formatRupiah(info.sisa)}.
                  </Text>
                </View>
                {klaim ? (
                  <View style={styles.banner}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bannerTitle}>{STATUS_KLAIM_LABEL[klaim.status] || klaim.status}</Text>
                      {klaim.reviewReason ? <Text style={styles.bannerText}>Alasan Finance: {klaim.reviewReason}</Text> : null}
                    </View>
                  </View>
                ) : null}
                {!online ? <View style={styles.banner}><AlertCircle size={15} color={tokens.color.warning || "#B45309"} /><Text style={styles.bannerText}>Tidak ada koneksi. Isian dan foto disimpan sebagai draf di perangkat; pengajuan hanya bisa saat online.</Text></View> : null}

                <Text style={styles.label}>Jenis pembayaran</Text>
                <View style={styles.row} accessibilityRole="radiogroup">
                  {JENIS_BAYAR.map((j) => (
                    <TouchableOpacity key={j.value} disabled={!bisaDiedit} onPress={() => pilihJenis(j.value)} style={[styles.chip, form.jenis === j.value && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: form.jenis === j.value }} testID={`jenis-${j.value}`}>
                      <Text style={[styles.chipText, form.jenis === j.value && { color: "#fff" }]}>{j.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>Tanggal pembayaran</Text>
                <View pointerEvents={bisaDiedit ? "auto" : "none"} style={!bisaDiedit && { opacity: 0.6 }}><DateField value={form.paymentDate} onChange={(v) => set("paymentDate", v)} /></View>

                <Text style={styles.label}>Nominal yang diklaim (Rp)</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={String(form.amount)} editable={bisaDiedit} onChangeText={(v) => ubahNominal(v.replace(/[^0-9]/g, ""))} placeholder="Rp 0" placeholderTextColor={tokens.color.textMuted} maxFontSizeMultiplier={1.5} />
                {dampak ? <Text style={[styles.muted, { color: dampak.tingkat === "galat" ? tokens.color.danger : tokens.color.accent }]} testID="dampak-nominal">{dampak.teks}</Text> : null}
                {form.jenis === "DP" && form.amount === "" ? <Text style={styles.muted}>Isi nominal DP yang dibayar customer.</Text> : null}

                <Text style={styles.label}>Metode pembayaran</Text>
                <View style={styles.row} accessibilityRole="radiogroup">
                  {METODE_KLAIM.map((m) => (
                    <TouchableOpacity key={m.value} disabled={!bisaDiedit} onPress={() => set("method", m.value)} style={[styles.chip, form.method === m.value && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: form.method === m.value }}>
                      <Text style={[styles.chipText, form.method === m.value && { color: "#fff" }]}>{m.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>Rekening tujuan{form.method === "TRANSFER" ? "" : " (jika ada)"}</Text>
                <View style={{ gap: 6 }}>
                  {rekening.length === 0 ? <Text style={styles.muted}>{form.method === "TRANSFER" ? "Belum ada rekening tujuan aktif." : "Tidak ada rekening untuk metode ini."}</Text> : null}
                  {rekening.map((a) => (
                    <TouchableOpacity key={a.id} disabled={!bisaDiedit} onPress={() => set("cashAccountId", form.cashAccountId === a.id ? "" : a.id)} style={[styles.acct, form.cashAccountId === a.id && styles.acctOn]} accessibilityRole="radio" accessibilityState={{ selected: form.cashAccountId === a.id }}>
                      <Text style={[styles.acctText, form.cashAccountId === a.id && { color: tokens.color.accent, fontWeight: "700" }]}>{a.name}{a.accountNumberMasked ? `  ${a.accountNumberMasked}` : ""}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>Catatan pembayaran</Text>
                <TextInput style={[styles.input, { minHeight: 76, textAlignVertical: "top" }]} multiline maxLength={1000} value={form.note} editable={bisaDiedit} onChangeText={(v) => set("note", v)} placeholder="Mis. transfer BCA a.n. pelanggan, dicek di mutasi pukul 10.15" placeholderTextColor={tokens.color.textMuted} maxFontSizeMultiplier={1.5} />

                <Text style={styles.label}>Bukti Pembayaran</Text>
                <View style={styles.buktiWrap}>
                  {bukti.map((b) => (
                    <View key={b.key} style={styles.buktiBox} testID={`bukti-${b.status}`}>
                      <BuktiKecil b={b} tokens={tokens} styles={styles} onRetry={() => kirimSatu(b)} />
                      {bisaDiedit ? <TouchableOpacity style={styles.buktiX} onPress={() => hapus(b)} accessibilityLabel={`Lepas ${b.nama}`}><X size={11} color={tokens.color.textSecondary} /></TouchableOpacity> : null}
                    </View>
                  ))}
                  {bisaDiedit ? (
                    <TouchableOpacity style={[styles.tambah, bukti.length >= MAKS_BUKTI && { opacity: 0.5 }]} disabled={bukti.length >= MAKS_BUKTI} onPress={pilihSumber} accessibilityRole="button">
                      <Camera size={16} color={tokens.color.textSecondary} /><Text style={styles.tambahText}>{bukti.length ? "Tambah bukti" : "Foto / unggah bukti"}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {bisaDiedit ? <Text style={styles.muted}>Foto transfer / struk QRIS / foto tunai, atau PDF. Bisa lebih dari satu. Maks. 8 MB per berkas.</Text> : null}

                {galat ? <Text style={[styles.muted, { color: tokens.color.danger }]} accessibilityRole="alert">{galat}</Text> : null}
                {bantu ? <Text style={styles.muted} testID="alasan-nonaktif">Belum bisa diajukan: {bantu}</Text> : null}
              </>
            )}
          </ScrollView>
          <View style={styles.footer}>
            {menunggu ? (
              <>
                <TouchableOpacity style={styles.ghost} onPress={onClose}><Text style={styles.ghostText}>Tutup</Text></TouchableOpacity>
                <TouchableOpacity style={styles.ghost} onPress={tarik} disabled={mengirim}><Text style={styles.ghostText}>Tarik Klaim</Text></TouchableOpacity>
              </>
            ) : (
              <>
                {bisaDiedit ? <TouchableOpacity style={[styles.ghost, (mengirim || adaUnggahan || memuat) && { opacity: 0.5 }]} disabled={mengirim || adaUnggahan || memuat} onPress={simpanDraft}><Text style={styles.ghostText}>Simpan Draft</Text></TouchableOpacity> : null}
                {bisaDiedit ? (
                  <TouchableOpacity style={[styles.primary, { flex: 1 }, !aktifTombol && { opacity: 0.4 }]} disabled={!aktifTombol} onPress={ajukan} accessibilityRole="button" accessibilityState={{ disabled: !aktifTombol }} testID="tombol-ajukan-klaim">
                    {mengirim ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{tombolAjukan}</Text>}
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function BuktiKecil({ b, tokens, styles, onRetry }) {
  const pdf = b.mime === "application/pdf" || /\.pdf$/i.test(b.nama || "");
  if (b.status === STATUS_BUKTI.MENGUNGGAH) return <View style={[styles.buktiThumb, { backgroundColor: tokens.color.subtle }]}><ActivityIndicator size="small" color={tokens.color.textMuted} /></View>;
  if (b.status === STATUS_BUKTI.GAGAL) {
    return <TouchableOpacity style={[styles.buktiThumb, { backgroundColor: "rgba(244,63,94,0.16)" }]} onPress={onRetry} accessibilityLabel={`Unggahan ${b.nama} gagal, ketuk untuk coba lagi`}><RefreshCw size={16} color={tokens.color.danger} /></TouchableOpacity>;
  }
  if (b.status === STATUS_BUKTI.ANTRE) return <View style={[styles.buktiThumb, { backgroundColor: tokens.color.subtle }]}>{pdf ? <FileText size={18} color={tokens.color.textSecondary} /> : <Image source={{ uri: b.file?.uri }} style={styles.buktiImg} />}<View style={styles.antreDot} /></View>;
  if (pdf) return <TouchableOpacity style={[styles.buktiThumb, { backgroundColor: tokens.color.subtle }]} onPress={() => Linking.openURL(mediaUrl(b.url))} accessibilityLabel={`Buka ${b.nama}`}><FileText size={18} color={tokens.color.textSecondary} /></TouchableOpacity>;
  return <TouchableOpacity style={styles.buktiThumb} onPress={() => Linking.openURL(mediaUrl(b.url))} accessibilityLabel={`Buka ${b.nama}`}><Image source={{ uri: mediaUrl(b.url) }} style={styles.buktiImg} /></TouchableOpacity>;
}

function createStyles(t) {
  return StyleSheet.create({
    card: { ...t.glass.surface, borderRadius: 12, padding: 12, gap: 10, marginTop: 10 },
    head: { flexDirection: "row", alignItems: "center", gap: 6 },
    title: { fontSize: 11, fontWeight: "700", color: t.color.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
    muted: { fontSize: 12, color: t.color.textSecondary, lineHeight: 17 },
    banner: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: t.color.subtle, borderRadius: 10, padding: 10 },
    bannerTitle: { fontSize: 12.5, fontWeight: "700", color: t.color.textPrimary },
    bannerText: { flex: 1, fontSize: 12, lineHeight: 17, color: t.color.textSecondary },
    primary: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: t.color.accent, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, minHeight: 46 },
    primaryText: { color: "#fff", fontWeight: "700", fontSize: 13.5 },
    ghost: { alignItems: "center", justifyContent: "center", backgroundColor: t.color.subtle, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, minHeight: 46 },
    ghostText: { color: t.color.textPrimary, fontWeight: "600", fontSize: 13 },
    overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
    sheet: { backgroundColor: t.color.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "92%" },
    sheetHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, gap: 8 },
    sheetTitle: { fontSize: 17, fontWeight: "700", color: t.color.textPrimary },
    closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    label: { fontSize: 11, fontWeight: "700", color: t.color.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
    input: { backgroundColor: t.color.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: t.color.textPrimary, minHeight: 44 },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: t.color.subtle, minHeight: 44, justifyContent: "center" },
    chipOn: { backgroundColor: t.color.accent },
    chipText: { fontSize: 13, fontWeight: "700", color: t.color.textSecondary },
    acct: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: t.color.subtle, minHeight: 44, justifyContent: "center", borderWidth: 1.5, borderColor: "transparent" },
    acctOn: { borderColor: t.color.accent },
    acctText: { fontSize: 13, color: t.color.textPrimary },
    buktiWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" },
    buktiBox: { position: "relative" },
    buktiThumb: { width: 56, height: 56, borderRadius: 10, alignItems: "center", justifyContent: "center", overflow: "hidden" },
    buktiImg: { width: 56, height: 56 },
    buktiX: { position: "absolute", top: -8, right: -8, width: 22, height: 22, borderRadius: 11, backgroundColor: t.color.bg, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: t.color.subtle },
    antreDot: { position: "absolute", bottom: 3, right: 3, width: 8, height: 8, borderRadius: 4, backgroundColor: "#F59E0B" },
    tambah: { flexDirection: "row", gap: 6, alignItems: "center", paddingHorizontal: 14, height: 56, borderRadius: 10, backgroundColor: t.color.subtle },
    tambahText: { fontSize: 13, color: t.color.textSecondary, fontWeight: "600" },
    footer: { flexDirection: "row", gap: 10, padding: 16, paddingTop: 10 },
  });
}
