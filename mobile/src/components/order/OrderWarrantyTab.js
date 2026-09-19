// Tab "Garansi" — paritas mobile dari features/orders/WarrantyPanel.jsx (web): pilih varian
// 10/20 tahun, bagikan PDF kartu garansi, kirim ke WhatsApp customer. Nama & alamat pemilik
// garansi mengikuti invoice order ini (ubah lewat tab Invoice > "Ditagihkan ke").
import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { ShieldCheck, FileText, Send } from "lucide-react-native";
import { api, downloadAndShareFile } from "../../api";
import { useTokens } from "../../constants/theme";
import { shortDate } from "../../utils/format";

const YEARS = [10, 20];

export default function OrderWarrantyTab({ orderId, order }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [tahun, setTahun] = useState(order?.warrantyYears || 10);
  const [sentAt, setSentAt] = useState(order?.warrantySentAt || null);
  const [sentYears, setSentYears] = useState(order?.warrantyYears || null);
  const [busy, setBusy] = useState(null);

  async function sharePdf() {
    setBusy("pdf");
    try {
      await downloadAndShareFile(`/orders/${orderId}/warranty/pdf?years=${tahun}`, `kartu-garansi-${tahun}th.pdf`, "application/pdf");
    } catch (e) {
      Alert.alert("Gagal membuat PDF", e.message);
    } finally {
      setBusy(null);
    }
  }

  function sendWa() {
    Alert.alert("Kirim kartu garansi?", `Kartu garansi ${tahun} tahun akan dikirim ke WhatsApp customer.`, [
      { text: "Batal", style: "cancel" },
      {
        text: "Kirim",
        onPress: async () => {
          setBusy("send");
          try {
            await api.sendOrderWarranty(orderId, tahun);
            setSentAt(new Date().toISOString());
            setSentYears(tahun);
            Alert.alert("Terkirim", "Kartu garansi sudah dikirim ke WhatsApp customer.");
          } catch (e) {
            Alert.alert("Gagal kirim", e.message);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <ShieldCheck size={15} color={tokens.color.accent} strokeWidth={2.2} />
        <Text style={styles.title}>Kartu Garansi E-Warranty</Text>
      </View>
      {sentAt ? <Text style={styles.muted}>Terakhir dikirim {shortDate(sentAt)}{sentYears ? ` · ${sentYears} th` : ""}</Text> : null}
      <Text style={styles.muted}>
        Nama dan alamat pemilik garansi mengikuti invoice order ini. Kalau perlu dikoreksi, ubah lewat tab Invoice pada bagian "Ditagihkan ke".
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {YEARS.map((th) => (
          <TouchableOpacity key={th} style={[styles.chip, tahun === th && styles.chipOn]} onPress={() => setTahun(th)}>
            <Text style={[styles.chipText, tahun === th && { color: "#fff" }]}>{th} Tahun</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={styles.primary} onPress={sendWa} disabled={!!busy}>
        {busy === "send" ? <ActivityIndicator color="#fff" /> : <Send size={15} color="#fff" strokeWidth={2.2} />}
        <Text style={styles.primaryText}>Kirim Kartu Garansi ke WhatsApp</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.ghost} onPress={sharePdf} disabled={!!busy}>
        {busy === "pdf" ? <ActivityIndicator color={tokens.color.accent} /> : <FileText size={15} color={tokens.color.textPrimary} strokeWidth={2.2} />}
        <Text style={styles.ghostText}>Lihat / Bagikan PDF</Text>
      </TouchableOpacity>
    </View>
  );
}

function createStyles(t) {
  return StyleSheet.create({
    card: { backgroundColor: t.color.card, borderRadius: 12, padding: 12, gap: 10 },
    head: { flexDirection: "row", alignItems: "center", gap: 6 },
    title: { fontSize: 11, fontWeight: "700", color: t.color.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
    muted: { fontSize: 12, color: t.color.textSecondary, lineHeight: 17 },
    chip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: t.color.subtle },
    chipOn: { backgroundColor: t.color.accent },
    chipText: { fontSize: 13, fontWeight: "700", color: t.color.textSecondary },
    primary: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: t.color.accent, borderRadius: 12, paddingVertical: 13 },
    primaryText: { color: "#fff", fontWeight: "700", fontSize: 13.5 },
    ghost: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: t.color.subtle, borderRadius: 12, paddingVertical: 12 },
    ghostText: { color: t.color.textPrimary, fontWeight: "600", fontSize: 13 },
  });
}
