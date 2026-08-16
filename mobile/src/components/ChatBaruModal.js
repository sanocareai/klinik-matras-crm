// "Ketik nomor lalu chat" — seperti di aplikasi WhatsApp.
//
// GAP yang diperbaiki (16 Agustus 2026): percakapan sebelumnya HANYA bisa
// lahir dari customer yang chat duluan (lewat webhook). Kalau sales dapat
// nomor dari telepon, kartu nama, atau referral, tidak ada jalan memulai
// chat dari aplikasi — mereka harus keluar ke WhatsApp, dan percakapan itu
// tidak pernah tercatat di CRM sampai customer membalas.
//
// Versi web (frontend/src/features/inbox/components/ConversationList/
// ChatBaruDialog.jsx) dibuat lebih dulu; ini padanannya di mobile, memakai
// endpoint backend yang SAMA persis.
//
// Nomor DIPERIKSA DULU ke WhatsApp sebelum apa pun dibuat. Tanpa itu, salah
// ketik satu digit menghasilkan pelanggan hantu di database DAN pesan yang
// terkirim ke ruang hampa — WhatsApp tidak mengembalikan error untuk tujuan
// yang tidak ada.
import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Modal, TextInput, ActivityIndicator, ScrollView,
} from "react-native";
import { X, Check, AlertTriangle, MessageSquarePlus } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import PressableScale from "./PressableScale";

// Nomor CS aktif — WAJIB dipilih eksplisit, tidak boleh ditebak: pelanggan
// akan melihat pesan datang DARI nomor itu (lihat KNOWN_SESSIONS di
// backend/src/services/wahaClient.js).
const SESI = ["CS-1", "CS-2"];

export default function ChatBaruModal({ visible, onClose, onJadi }) {
  const tokens = useTokens();
  const styles = React.useMemo(() => createStyles(tokens), [tokens]);

  const [nomor, setNomor] = useState("");
  const [sesi, setSesi] = useState(SESI[0]);
  const [nama, setNama] = useState("");
  const [cek, setCek] = useState(null);
  const [memeriksa, setMemeriksa] = useState(false);
  const [membuat, setMembuat] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef(null);

  useEffect(() => {
    if (visible) {
      setNomor(""); setNama(""); setCek(null); setError(""); setMembuat(false);
    }
  }, [visible]);

  // Periksa sambil mengetik — umpan balik langsung jauh lebih baik daripada
  // baru tahu salah setelah menekan tombol.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    setCek(null);
    setError("");
    const bersih = nomor.replace(/\D/g, "");
    if (bersih.length < 8) return;

    debounceRef.current = setTimeout(async () => {
      setMemeriksa(true);
      try {
        setCek(await api.cekNomorWa(nomor, sesi));
      } catch {
        setCek(null);
      } finally {
        setMemeriksa(false);
      }
    }, 500);
    return () => clearTimeout(debounceRef.current);
  }, [nomor, sesi]);

  async function handleMulai() {
    setMembuat(true);
    setError("");
    try {
      const hasil = await api.mulaiChatBaru({ phone: nomor, session: sesi, name: nama });
      onJadi?.(hasil);
      onClose();
    } catch (e) {
      setError(e.message || "Gagal memulai percakapan");
    } finally {
      setMembuat(false);
    }
  }

  const bolehMulai = cek?.valid && cek.adaDiWhatsApp !== false && !memeriksa && !membuat;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Chat Baru</Text>
            <PressableScale style={styles.closeBtn} onPress={onClose}>
              <X size={18} color={tokens.color.textPrimary} strokeWidth={2} />
            </PressableScale>
          </View>
          <Text style={styles.sub}>
            Ketik nomor langsung, tidak perlu menunggu pelanggan chat duluan.
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
            <Text style={styles.label}>Nomor WhatsApp</Text>
            <TextInput
              value={nomor}
              onChangeText={setNomor}
              placeholder="0851-8728-3900 atau 628518728390"
              placeholderTextColor={tokens.color.textMuted}
              keyboardType="phone-pad"
              autoFocus
              style={styles.input}
            />
            <Text style={styles.hint}>Boleh ditulis bebas — 08xx, +62, atau 8xx diterima.</Text>

            {memeriksa && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={tokens.color.textMuted} />
                <Text style={styles.statusMuted}>Memeriksa nomor...</Text>
              </View>
            )}

            {!memeriksa && cek && !cek.valid && (
              <View style={styles.statusRow}>
                <AlertTriangle size={14} color={tokens.color.danger} strokeWidth={2} />
                <Text style={[styles.statusText, { color: tokens.color.danger }]}>{cek.alasan}</Text>
              </View>
            )}

            {!memeriksa && cek?.valid && (
              <View style={styles.hasilBox}>
                <Text style={styles.nomorBaku}>{cek.nomor}</Text>

                {cek.adaDiWhatsApp === true && (
                  <View style={styles.statusRow}>
                    <Check size={13} color={tokens.color.success} strokeWidth={2.4} />
                    <Text style={[styles.statusText, { color: tokens.color.success }]}>
                      Terdaftar di WhatsApp
                    </Text>
                  </View>
                )}
                {cek.adaDiWhatsApp === false && (
                  <View style={styles.statusRow}>
                    <AlertTriangle size={13} color={tokens.color.danger} strokeWidth={2} />
                    <Text style={[styles.statusText, { color: tokens.color.danger }]}>
                      Tidak terdaftar di WhatsApp
                    </Text>
                  </View>
                )}
                {/* null = WAHA tidak terjangkau. SENGAJA dibedakan dari "tidak
                    terdaftar" — kalau disamakan, sales mengira nomornya salah
                    padahal layanannya yang sedang mati. */}
                {cek.adaDiWhatsApp === null && (
                  <View style={styles.statusRow}>
                    <AlertTriangle size={13} color={tokens.color.warning} strokeWidth={2} />
                    <Text style={[styles.statusText, { color: tokens.color.warning }]}>
                      Status tidak bisa dipastikan (WhatsApp tidak terjangkau)
                    </Text>
                  </View>
                )}

                {cek.sudahAdaDiCrm && (
                  <Text style={styles.statusMuted}>
                    Sudah ada di CRM{cek.namaDiCrm ? ` sebagai "${cek.namaDiCrm}"` : ""} — akan dibuka percakapannya.
                  </Text>
                )}
              </View>
            )}

            {/* Nama cuma relevan untuk kontak yang benar-benar baru */}
            {cek?.valid && !cek.sudahAdaDiCrm && (
              <>
                <Text style={styles.label}>Nama (opsional)</Text>
                <TextInput
                  value={nama}
                  onChangeText={setNama}
                  placeholder="Kosongkan untuk pakai nama dari WhatsApp"
                  placeholderTextColor={tokens.color.textMuted}
                  style={styles.input}
                />
              </>
            )}

            <Text style={styles.label}>Kirim dari nomor</Text>
            <View style={styles.sesiRow}>
              {SESI.map((s) => (
                <PressableScale
                  key={s}
                  style={[styles.sesiChip, sesi === s && styles.sesiChipAktif]}
                  onPress={() => setSesi(s)}
                >
                  <Text style={[styles.sesiText, sesi === s && styles.sesiTextAktif]}>{s}</Text>
                </PressableScale>
              ))}
            </View>
            <Text style={styles.hint}>Pelanggan akan melihat pesan datang dari nomor ini.</Text>

            {!!error && <Text style={[styles.statusText, { color: tokens.color.danger, marginTop: 10 }]}>{error}</Text>}
          </ScrollView>

          <PressableScale
            style={[styles.mulaiBtn, !bolehMulai && styles.mulaiBtnDisabled]}
            disabled={!bolehMulai}
            onPress={handleMulai}
          >
            <MessageSquarePlus size={16} color="#fff" strokeWidth={2.2} />
            <Text style={styles.mulaiBtnText}>
              {membuat ? "Membuka..." : cek?.sudahAdaDiCrm ? "Buka Percakapan" : "Mulai Chat"}
            </Text>
          </PressableScale>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: tokens.color.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: 20, paddingBottom: 32,
    },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { fontSize: 16, fontWeight: "700", color: tokens.color.textPrimary },
    closeBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
    sub: { fontSize: 12.5, color: tokens.color.textMuted, marginTop: 4, marginBottom: 14 },
    label: {
      fontSize: 12.5, fontWeight: "700", color: tokens.color.textPrimary,
      marginTop: 12, marginBottom: 6,
    },
    input: {
      backgroundColor: tokens.color.card, borderRadius: 12, paddingHorizontal: 14,
      paddingVertical: 11, fontSize: 15, color: tokens.color.textPrimary,
      borderWidth: 1, borderColor: tokens.color.border,
    },
    hint: { fontSize: 11.5, color: tokens.color.textMuted, marginTop: 5 },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
    statusText: { fontSize: 12.5, flex: 1 },
    statusMuted: { fontSize: 12.5, color: tokens.color.textMuted, marginTop: 6 },
    hasilBox: {
      backgroundColor: tokens.color.card, borderRadius: 12, padding: 12, marginTop: 12,
    },
    nomorBaku: { fontSize: 14, fontWeight: "700", color: tokens.color.textPrimary },
    sesiRow: { flexDirection: "row", gap: 8 },
    sesiChip: {
      flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: "center",
      backgroundColor: tokens.color.card, borderWidth: 1, borderColor: tokens.color.border,
    },
    sesiChipAktif: { backgroundColor: tokens.color.accent, borderColor: tokens.color.accent },
    sesiText: { fontSize: 13.5, fontWeight: "600", color: tokens.color.textPrimary },
    sesiTextAktif: { color: "#fff" },
    mulaiBtn: {
      marginTop: 18, backgroundColor: tokens.color.accent, borderRadius: 14,
      paddingVertical: 13, alignItems: "center", justifyContent: "center",
      flexDirection: "row", gap: 8,
    },
    mulaiBtnDisabled: { opacity: 0.4 },
    mulaiBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  });
}
