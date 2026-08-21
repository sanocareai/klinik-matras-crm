// Input tanggal PASTI (bukan estimasi) — pengganti TextInput mentah
// "YYYY-MM-DD" yang sebelumnya dipakai OrderFormModal.js untuk Tanggal Pick
// Up Pasti & Tanggal Kirim Pasti. Ketik ISO manual rawan salah nyata (sales
// terbiasa nulis DD-MM-YYYY, hasilnya tersimpan sebagai tanggal lain tanpa
// ada yang sadar) — date picker native menghilangkan seluruh kelas bug itu.
//
// KENAPA CUMA untuk field "Pasti", BUKAN "Estimasi": pickupEstimate/
// deliveryEstimate SENGAJA teks bebas (lihat komentar di
// backend/prisma/schema.prisma) — sales di lapangan sering perlu menulis
// rentang kasar ("est 24/25 Agustus") yang tidak bisa direpresentasikan
// date picker satu-tanggal. Field "Pasti" SUDAH kolom DateTime asli di
// database, dan versi web SUDAH pakai <input type="date">, jadi ini murni
// menyamakan mobile ke pola yang sudah benar di sana — bukan desain baru.
import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform, Modal } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Calendar, X } from "lucide-react-native";
import { useTokens } from "../constants/theme";

const BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

function formatTampil(isoDate) {
  if (!isoDate) return null;
  // Parse manual (bukan `new Date(isoDate)`) — string "YYYY-MM-DD" polos
  // ditafsirkan UTC tengah malam oleh JS, yang di WIB (+7) bisa mundur satu
  // hari saat dirender. Parsing manual menghindari itu sepenuhnya.
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  return `${d} ${BULAN[m - 1]} ${y}`;
}

/**
 * @param {string} value tanggal ISO "YYYY-MM-DD" atau "" (kosong)
 * @param {(next: string) => void} onChange dipanggil dengan ISO string baru, atau "" saat dikosongkan
 */
export default function DateField({ value, onChange, placeholder = "Pilih tanggal" }) {
  const tokens = useTokens();
  const styles = React.useMemo(() => createStyles(tokens), [tokens]);
  const [showPicker, setShowPicker] = useState(false);

  const dateValue = value ? new Date(`${value}T00:00:00`) : new Date();

  function toIso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  // Android: dialog native SELALU self-dismiss begitu user pilih/batal —
  // event.type "dismissed" berarti batal (JANGAN commit apa pun), "set"
  // berarti user benar-benar memilih tanggal.
  function handleChangeAndroid(event, selected) {
    setShowPicker(false);
    if (event.type === "set" && selected) onChange(toIso(selected));
  }

  // iOS: mode "spinner" TIDAK self-dismiss (scroll inline terus-menerus),
  // jadi ditaruh di dalam sheet kecil dengan tombol "Selesai" eksplisit.
  function handleChangeIOS(event, selected) {
    if (selected) onChange(toIso(selected));
  }

  function openPicker() {
    setShowPicker(true);
  }
  function clearValue(e) {
    e.stopPropagation?.();
    onChange("");
  }

  const tampil = formatTampil(value);

  return (
    <>
      <TouchableOpacity style={styles.field} onPress={openPicker}>
        <Calendar size={16} color={tokens.color.textMuted} strokeWidth={2} />
        <Text style={tampil ? styles.fieldText : styles.fieldPlaceholder}>
          {tampil || placeholder}
        </Text>
        {!!tampil && (
          <TouchableOpacity onPress={clearValue} hitSlop={8} style={styles.clearBtn}>
            <X size={14} color={tokens.color.textMuted} strokeWidth={2.2} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {showPicker && Platform.OS === "android" && (
        <DateTimePicker value={dateValue} mode="date" display="default" onChange={handleChangeAndroid} />
      )}

      {Platform.OS === "ios" && (
        <Modal visible={showPicker} transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
          <TouchableOpacity style={styles.iosOverlay} activeOpacity={1} onPress={() => setShowPicker(false)}>
            <View style={styles.iosSheet}>
              <View style={styles.iosHeader}>
                <TouchableOpacity onPress={() => setShowPicker(false)}>
                  <Text style={styles.iosDoneText}>Selesai</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker value={dateValue} mode="date" display="spinner" onChange={handleChangeIOS} />
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    field: {
      flexDirection: "row", alignItems: "center", gap: 8,
      backgroundColor: tokens.color.card, borderRadius: 12, paddingHorizontal: 14,
      paddingVertical: 12, borderWidth: 1, borderColor: tokens.color.border,
    },
    fieldText: { flex: 1, fontSize: 14, color: tokens.color.textPrimary },
    fieldPlaceholder: { flex: 1, fontSize: 14, color: tokens.color.textMuted },
    clearBtn: { padding: 2 },
    iosOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    iosSheet: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
    iosHeader: {
      flexDirection: "row", justifyContent: "flex-end", padding: 12,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
    },
    iosDoneText: { color: tokens.color.accent, fontWeight: "700", fontSize: 15 },
  });
}
