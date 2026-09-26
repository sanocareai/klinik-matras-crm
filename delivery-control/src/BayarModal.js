import React, { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { formatRupiah } from "@sano/delivery-shared";
import { biayaArmadaApi } from "./client";
import { elevation, radius, type, useTheme } from "./theme";
import { hariIniWIB } from "./format";
import { Box, Btn, Field, IconBox, PickerField } from "./ui";

// Pembayaran FinExpense (finance:post) — POST /finance/expenses/:id/pay yang sudah ada.
// Rekening & jenis biaya transfer dari server (/finance/cash-accounts); validasi akhir tetap di server
// (status wajib DISETUJUI, rekening bank untuk transfer, batas biaya custom).
const CARA = [{ value: "TUNAI", label: "Tunai", icon: "wallet" }, { value: "TRANSFER", label: "Transfer", icon: "send" }];

export function BayarModal({ visible, amount, busy, error, onCancel, onConfirm }) {
  const t = useTheme();
  const [data, setData] = useState(null);
  const [muatGagal, setMuatGagal] = useState("");
  const [f, setF] = useState({ cashAccountId: "", paymentMethod: "TUNAI", transferFeeType: "", transferFeeAmount: "", paidAt: hariIniWIB() });

  useEffect(() => {
    if (!visible) return;
    setF({ cashAccountId: "", paymentMethod: "TUNAI", transferFeeType: "", transferFeeAmount: "", paidAt: hariIniWIB() });
    setMuatGagal("");
    biayaArmadaApi.rekeningKas().then(setData).catch((e) => setMuatGagal(e.message || "Rekening tidak dapat dimuat"));
  }, [visible]);

  const rekening = useMemo(() => (data?.accounts || []).filter((a) => a.active !== false).map((a) => ({
    value: a.id, label: a.name, sub: `${a.kind === "KAS" ? "Kas tunai" : "Bank/e-wallet"} · saldo ${formatRupiah(a.saldo)}`, icon: a.kind === "KAS" ? "wallet" : "store", kind: a.kind, preset: a.presetBiayaTransfer,
  })), [data]);
  const pilih = rekening.find((r) => r.value === f.cashAccountId);
  const jenis = (data?.jenisBiayaTransfer || []).map((j) => ({ value: j.code, label: j.label, sub: j.bawaan != null ? formatRupiah(pilih?.preset?.[j.code] ?? j.bawaan) : "Isi nominal" }));
  const transfer = f.paymentMethod === "TRANSFER";
  const custom = transfer && f.transferFeeType === "LAINNYA";
  const salah = !f.cashAccountId ? "Pilih rekening sumber" : transfer && pilih?.kind === "KAS" ? "Transfer hanya dari rekening bank/e-wallet"
    : transfer && !f.transferFeeType ? "Pilih jenis biaya transfer" : custom && f.transferFeeAmount === "" ? "Isi biaya transfer" : !/^\d{4}-\d{2}-\d{2}$/.test(f.paidAt) ? "Tanggal bayar tidak valid" : "";
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  function kirim() {
    const body = { cashAccountId: f.cashAccountId, paymentMethod: f.paymentMethod, paidAt: f.paidAt };
    if (transfer) { body.transferFeeType = f.transferFeeType; if (custom) body.transferFeeAmount = Number(f.transferFeeAmount); }
    onConfirm(body);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={[s.wrap, { backgroundColor: t.scrim }]}>
        <View style={[s.sheet, { backgroundColor: t.surface }, elevation(t, 2)]}>
          <ScrollView contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <IconBox name="wallet" tone="green" size={46} />
              <View style={{ flex: 1 }}>
                <Text style={[type.heading, { color: t.ink }]}>Catat pembayaran</Text>
                <Text style={{ color: t.ink2, fontSize: 13 }}>Nominal {formatRupiah(amount)} — jurnal kas diposting saat disimpan.</Text>
              </View>
            </View>
            {!!muatGagal && <Box>{muatGagal}</Box>}
            <PickerField label="Rekening sumber" required value={f.cashAccountId} options={rekening} onSelect={(v) => set("cashAccountId", v)} loading={!data && !muatGagal} icon="wallet" emptyText="Belum ada rekening aktif" />
            <PickerField label="Cara bayar" required value={f.paymentMethod} options={CARA} onSelect={(v) => setF((x) => ({ ...x, paymentMethod: v, transferFeeType: "", transferFeeAmount: "" }))} />
            {transfer && <PickerField label="Biaya admin transfer" required value={f.transferFeeType} options={jenis} onSelect={(v) => set("transferFeeType", v)} icon="send" />}
            {custom && <Field label="Biaya transfer (Rp)" required keyboardType="numeric" icon="wallet" value={String(f.transferFeeAmount)} onChangeText={(v) => set("transferFeeAmount", v.replace(/[^0-9]/g, ""))} placeholder="0" />}
            <Field label="Tanggal bayar" required icon="calendar" value={f.paidAt} onChangeText={(v) => set("paidAt", v)} hint="Format TTTT-BB-HH" autoCapitalize="none" />
            {!!error && <Box>{error}</Box>}
            {!!salah && !!data && <Text style={{ color: t.ink3, fontSize: 12 }}>{salah}</Text>}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Btn title="Batal" kind="ghost" onPress={onCancel} disabled={busy} style={{ flex: 1 }} />
              <Btn title="Bayar" icon="checkCircle" onPress={kirim} busy={busy} disabled={!!salah} style={{ flex: 1 }} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, maxHeight: "90%" },
});
