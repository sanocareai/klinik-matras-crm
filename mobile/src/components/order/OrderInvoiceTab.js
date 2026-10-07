// Tab "Invoice" di Rincian Pesanan — paritas mobile dari features/orders/InvoicePanel.jsx (web).
// Nominal SELALU dari backend (services/invoice.js), layar ini tidak pernah menghitung tagihan
// sendiri. Scope v1: lihat, ubah "Ditagihkan ke"/jatuh tempo/catatan, bagikan PDF, kirim ke WhatsApp.
// Gabung invoice lintas-order belum ada di mobile (masih lewat web).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { FileText, Send, Pencil } from "lucide-react-native";
import { api, downloadAndShareFile } from "../../api";
import { useTokens } from "../../constants/theme";
import { formatRupiah, shortDate } from "../../utils/format";
import { MODE_DP, hitungDpDariInput, isianAwalDp, gantiModeDp } from "../../lib/invoiceDp";

const STATUS_LABEL = {
  DRAFT: "Draft", SENT: "Terkirim", VIEWED: "Dilihat", PARTIALLY_PAID: "Dibayar Sebagian",
  PAID: "Lunas", OVERDUE: "Jatuh Tempo", CANCELLED: "Dibatalkan",
};

function Row({ label, value, bold, color, styles }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, bold && { fontWeight: "800" }, color && { color }]}>{value}</Text>
    </View>
  );
}

export default function OrderInvoiceTab({ orderId }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(false);
  const [nama, setNama] = useState("");
  const [alamat, setAlamat] = useState("");
  const [jatuhTempo, setJatuhTempo] = useState("");
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(null); // "save" | "pdf" | "send" | "jenis" | "dp"
  // Jenis tagihan yang dipilih Sales: null = otomatis; "DP" | "TOTAL" = pilihan eksplisit. Dikirim ke server pada lihat/PDF/kirim supaya dokumen
  // yang DIKIRIM sama dengan yang tampil. dpTarget order TIDAK pernah dihapus oleh pilihan ini.
  const [jenis, setJenis] = useState(null);
  const [formDp, setFormDp] = useState(false);
  const [dpDraft, setDpDraft] = useState("");
  const [dpMode, setDpMode] = useState(MODE_DP.PERSEN); // DP diisi dalam PERSEN dari total atau langsung NOMINAL (Rp); yang disimpan selalu nominal

  const load = useCallback((j = null) => {
    setError("");
    api.getOrderInvoice(orderId, j).then(setView).catch((e) => setError(e.message));
  }, [orderId]);
  useEffect(() => { setView(null); load(); }, [load]);

  async function gantiJenis(k) {
    setBusy("jenis");
    try {
      setView(await api.getOrderInvoice(orderId, k));
      setJenis(k); setFormDp(false);
    } catch (e) {
      Alert.alert("Gagal mengganti jenis tagihan", e.message);
    } finally {
      setBusy(null);
    }
  }

  // Pilih DP: sudah disepakati → langsung; belum → form (default 30% dari total, bisa diganti ke nominal), disimpan sebagai "DP disepakati" order.
  function bukaFormDp(dpTarget = null) {
    const awal = isianAwalDp({ total: view?.nominal?.totalTagihan || 0, dpTarget });
    setDpMode(awal.mode); setDpDraft(awal.nilai); setFormDp(true);
  }
  function pilihDp() {
    const n = view?.nominal;
    if (n?.bisaDP) return gantiJenis("DP");
    if (!(n?.dpTarget > 0)) bukaFormDp();
  }
  function ubahModeDp(ke) {
    if (ke === dpMode) return;
    setDpDraft(gantiModeDp({ dari: dpMode, ke, nilai: dpDraft, total: view?.nominal?.totalTagihan || 0 }));
    setDpMode(ke);
  }

  async function simpanDp() {
    const hitung = hitungDpDariInput({ mode: dpMode, nilai: dpDraft, total: view?.nominal?.totalTagihan || 0 });
    if (!hitung.ok) { Alert.alert("DP", hitung.galat); return; }
    setBusy("dp");
    try {
      await api.updateOrder(view.order?.id || orderId, { dpTarget: hitung.nominal });
      setView(await api.getOrderInvoice(orderId, "DP"));
      setJenis("DP"); setFormDp(false);
    } catch (e) {
      Alert.alert("Gagal menyimpan DP", e.message);
    } finally {
      setBusy(null);
    }
  }

  function startEdit() {
    const inv = view.invoice;
    setNama(inv.namaTujuan || view.customer?.nama || "");
    setAlamat(inv.alamatTujuan || view.order?.deliveryAddress || "");
    setJatuhTempo(inv.dueDate ? String(inv.dueDate).slice(0, 10) : "");
    setCatatan(inv.notes || "");
    setEdit(true);
  }

  async function save() {
    if (jatuhTempo && !/^\d{4}-\d{2}-\d{2}$/.test(jatuhTempo)) {
      Alert.alert("Jatuh tempo", "Tulis tanggal dengan format TTTT-BB-HH, mis. 2026-10-05");
      return;
    }
    setBusy("save");
    try {
      const v = await api.updateOrderInvoice(orderId, {
        namaTujuan: nama.trim(), alamatTujuan: alamat.trim(), dueDate: jatuhTempo, notes: catatan.trim(),
      }, jenis);
      setView(v);
      setEdit(false);
    } catch (e) {
      Alert.alert("Gagal menyimpan", e.message);
    } finally {
      setBusy(null);
    }
  }

  async function sharePdf() {
    setBusy("pdf");
    try {
      const j = view.nominal?.jenisTagihan;
      await downloadAndShareFile(`/orders/${orderId}/invoice/pdf${j ? `?jenis=${j}` : ""}`, `${view.invoice.invoiceNumber}${j === "DP" ? "-DP" : ""}.pdf`, "application/pdf");
    } catch (e) {
      Alert.alert("Gagal membuat PDF", e.message);
    } finally {
      setBusy(null);
    }
  }

  function sendWa() {
    const jenisKirim = view.nominal?.jenisTagihan;
    Alert.alert("Kirim invoice?", `Invoice ${jenisKirim === "DP" ? "DP " : ""}${view.invoice.invoiceNumber} akan dikirim ke WhatsApp ${view.customer?.nama || "customer"}.`, [
      { text: "Batal", style: "cancel" },
      {
        text: "Kirim",
        onPress: async () => {
          setBusy("send");
          try {
            await api.sendOrderInvoice(orderId, jenisKirim);
            Alert.alert("Terkirim", "Invoice sudah dikirim ke WhatsApp customer.");
            load(jenis);
          } catch (e) {
            Alert.alert("Gagal kirim", e.message);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  if (error) return <Text style={styles.err}>{error}</Text>;
  if (!view) return <ActivityIndicator color={tokens.color.accent} style={{ marginTop: 24 }} />;

  const { invoice, nominal, items = [], customer } = view;
  const batal = invoice.status === "CANCELLED";

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.number}>{invoice.invoiceNumber}</Text>
          <View style={styles.pill}><Text style={styles.pillText}>{STATUS_LABEL[invoice.status] || invoice.status}</Text></View>
        </View>
        {invoice.dueDate ? <Text style={styles.muted}>Jatuh tempo {shortDate(invoice.dueDate)}</Text> : null}
        {invoice.sentAt ? <Text style={styles.muted}>Terakhir dikirim {shortDate(invoice.sentAt)}</Text> : null}
      </View>

      <View style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.section}>Ditagihkan ke</Text>
          {!edit && !batal && (
            <TouchableOpacity onPress={startEdit} hitSlop={8}><Pencil size={14} color={tokens.color.accent} strokeWidth={2.2} /></TouchableOpacity>
          )}
        </View>
        {edit ? (
          <View style={{ gap: 8 }}>
            <TextInput style={styles.input} value={nama} onChangeText={setNama} placeholder="Nama" placeholderTextColor={tokens.color.textMuted} />
            <TextInput style={[styles.input, { minHeight: 64 }]} value={alamat} onChangeText={setAlamat} multiline placeholder="Alamat" placeholderTextColor={tokens.color.textMuted} />
            <TextInput style={styles.input} value={jatuhTempo} onChangeText={setJatuhTempo} placeholder="Jatuh tempo (TTTT-BB-HH)" placeholderTextColor={tokens.color.textMuted} />
            <TextInput style={[styles.input, { minHeight: 52 }]} value={catatan} onChangeText={setCatatan} multiline placeholder="Catatan invoice" placeholderTextColor={tokens.color.textMuted} />
            <Text style={styles.muted}>Perubahan ini hanya untuk tampilan invoice, tidak mengubah data pelanggan atau order.</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity style={styles.btnGhost} onPress={() => setEdit(false)} disabled={busy === "save"}><Text style={styles.btnGhostText}>Batal</Text></TouchableOpacity>
              <TouchableOpacity style={styles.btnPrimary} onPress={save} disabled={busy === "save"}>
                <Text style={styles.btnPrimaryText}>{busy === "save" ? "Menyimpan…" : "Simpan"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.value}>{invoice.namaTujuan || customer?.nama || "—"}</Text>
            <Text style={styles.muted}>{invoice.alamatTujuan || view.order?.deliveryAddress || "Alamat belum diisi"}</Text>
            {invoice.notes ? <Text style={styles.muted}>Catatan: {invoice.notes}</Text> : null}
          </>
        )}
      </View>

      {!batal && !nominal.lunas ? (
        <View style={styles.card} testID="pilih-jenis-tagihan">
          <Text style={styles.section}>Jenis tagihan</Text>
          <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="radiogroup">
            {[["TOTAL", "Total / Pelunasan"], ["DP", "DP (uang muka)"]].map(([k, label]) => {
              const aktif = nominal.jenisTagihan === k;
              const nonaktif = !!busy || (k === "DP" && nominal.dpTarget > 0 && !nominal.bisaDP);
              return (
                <TouchableOpacity
                  key={k} disabled={nonaktif} onPress={() => (k === "DP" ? pilihDp() : gantiJenis("TOTAL"))}
                  style={[styles.chip, aktif && styles.chipOn, nonaktif && { opacity: 0.45 }]}
                  accessibilityRole="radio" accessibilityState={{ selected: aktif, disabled: nonaktif }} testID={`jenis-tagihan-${k}`}
                >
                  <Text style={[styles.chipText, aktif && { color: "#fff" }]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {nominal.dpTarget > 0 && !nominal.bisaDP && !nominal.dibayarTidakRinci ? (
            <Text style={styles.muted}>DP {formatRupiah(nominal.dpTarget)} sudah terpenuhi — tagihan berikutnya berupa pelunasan.</Text>
          ) : null}
          {formDp ? (() => {
            const hitung = hitungDpDariInput({ mode: dpMode, nilai: dpDraft, total: nominal.totalTagihan });
            return (
              <View style={{ gap: 6 }} testID="form-dp-invoice">
                <Text style={styles.muted}>DP yang disepakati — isi dalam:</Text>
                <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="radiogroup">
                  {[[MODE_DP.PERSEN, "Persen (%)"], [MODE_DP.NOMINAL, "Nominal (Rp)"]].map(([k, label]) => (
                    <TouchableOpacity key={k} onPress={() => ubahModeDp(k)} style={[styles.chip, dpMode === k && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: dpMode === k }} testID={`dp-mode-${k}`}>
                      <Text style={[styles.chipText, dpMode === k && { color: "#fff" }]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={styles.input} keyboardType={dpMode === MODE_DP.PERSEN ? "decimal-pad" : "numeric"} value={dpDraft}
                  onChangeText={(v) => setDpDraft(v.replace(dpMode === MODE_DP.PERSEN ? /[^0-9.,]/g : /[^0-9]/g, ""))}
                  placeholder={dpMode === MODE_DP.PERSEN ? "mis. 30" : "mis. 1500000"} placeholderTextColor={tokens.color.textMuted}
                />
                <Text style={[styles.muted, !hitung.ok && { color: tokens.color.danger }]} testID="pratinjau-dp">
                  {hitung.ok ? `= ${formatRupiah(hitung.nominal)} (${String(hitung.persen).replace(".", ",")}% dari total ${formatRupiah(nominal.totalTagihan)})` : hitung.galat}
                </Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity style={styles.btnGhost} onPress={() => setFormDp(false)} disabled={!!busy}><Text style={styles.btnGhostText}>Batal</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.btnPrimary, !hitung.ok && { opacity: 0.4 }]} onPress={simpanDp} disabled={!!busy || !hitung.ok} testID="simpan-dp-invoice">
                    <Text style={styles.btnPrimaryText}>{busy === "dp" ? "Menyimpan…" : "Simpan & Pakai"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })() : null}
          {!formDp && nominal.modeDP ? (
            <TouchableOpacity onPress={() => bukaFormDp(nominal.dpTarget)} disabled={!!busy} testID="ubah-dp-invoice">
              <Text style={[styles.muted, { color: tokens.color.accent, fontWeight: "700" }]}>Ubah DP ({formatRupiah(nominal.dpTarget)})</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.section}>Rincian</Text>
        {items.length === 0 && <Text style={styles.muted}>Belum ada item layanan.</Text>}
        {items.map((i) => (
          <Row key={i.id} label={i.nama} value={formatRupiah(i.harga || 0)} styles={styles} />
        ))}
        <View style={styles.sep} />
        {nominal.nilaiDiskon > 0 && <Row label={`Diskon${nominal.diskonPersen ? ` ${nominal.diskonPersen}%` : ""}`} value={`− ${formatRupiah(nominal.nilaiDiskon)}`} styles={styles} />}
        {nominal.ongkir > 0 && <Row label="Ongkir" value={formatRupiah(nominal.ongkir)} styles={styles} />}
        {nominal.modeDP ? (
          <Row label="Tagihan DP" value={formatRupiah(nominal.dpTarget)} bold styles={styles} />
        ) : (
          <Row label="Total tagihan" value={formatRupiah(nominal.totalTagihan)} bold styles={styles} />
        )}
        <Row label="Sudah dibayar" value={formatRupiah(nominal.dibayar)} color={tokens.color.success} styles={styles} />
        {nominal.modeDP ? (
          <>
            <Row label="Sisa DP" value={formatRupiah(nominal.dpKurang)} bold color={tokens.color.danger} styles={styles} />
            <Text style={styles.muted}>Total keseluruhan order: {formatRupiah(nominal.totalTagihan)}</Text>
          </>
        ) : (
          <Row label="Sisa tagihan" value={formatRupiah(nominal.sisa)} bold color={nominal.sisa > 0 ? tokens.color.danger : undefined} styles={styles} />
        )}
      </View>

      {!batal && (
        <View style={{ gap: 8 }}>
          <TouchableOpacity style={styles.btnPrimary} onPress={sendWa} disabled={!!busy}>
            {busy === "send" ? <ActivityIndicator color="#fff" /> : <Send size={15} color="#fff" strokeWidth={2.2} />}
            <Text style={styles.btnPrimaryText}>Kirim Invoice ke WhatsApp</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnGhost} onPress={sharePdf} disabled={!!busy}>
            {busy === "pdf" ? <ActivityIndicator color={tokens.color.accent} /> : <FileText size={15} color={tokens.color.textPrimary} strokeWidth={2.2} />}
            <Text style={styles.btnGhostText}>Lihat / Bagikan PDF</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function createStyles(t) {
  return StyleSheet.create({
    chip: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: t.color.border, backgroundColor: t.color.subtle },
    chipOn: { backgroundColor: t.color.accent, borderColor: t.color.accent },
    chipText: { fontSize: 12.5, fontWeight: "700", color: t.color.textSecondary },
    card: { ...t.glass.surface, borderRadius: 12, padding: 12, gap: 6 },
    head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    number: { fontSize: 14, fontWeight: "800", color: t.color.textPrimary, fontFamily: "monospace" },
    pill: { backgroundColor: t.color.accentSoft, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
    pillText: { fontSize: 11, fontWeight: "700", color: t.color.accent },
    section: { fontSize: 10, fontWeight: "700", color: t.color.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
    value: { fontSize: 13.5, fontWeight: "700", color: t.color.textPrimary },
    muted: { fontSize: 12, color: t.color.textSecondary, lineHeight: 17 },
    row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
    rowLabel: { flex: 1, fontSize: 12.5, color: t.color.textSecondary },
    rowValue: { fontSize: 12.5, fontWeight: "600", color: t.color.textPrimary },
    sep: { height: 1, backgroundColor: t.color.border, marginVertical: 4 },
    input: { backgroundColor: t.color.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13.5, color: t.color.textPrimary },
    btnPrimary: { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: t.color.accent, borderRadius: 12, paddingVertical: 13 },
    btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 13.5 },
    btnGhost: { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", ...t.glass.surface, borderRadius: 12, paddingVertical: 12 },
    btnGhostText: { color: t.color.textPrimary, fontWeight: "600", fontSize: 13 },
    err: { color: t.color.danger, fontSize: 12.5, marginTop: 12 },
  });
}
