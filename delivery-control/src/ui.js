import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { toneColors, useTheme } from "./theme";

export function Btn({ title, onPress, kind = "primary", disabled, busy, style }) {
  const t = useTheme();
  const bg = kind === "primary" ? t.accent : kind === "danger" ? t.redBg : t.field;
  const fg = kind === "primary" ? "#fff" : kind === "danger" ? t.red : t.ink;
  return (
    <Pressable
      onPress={onPress} disabled={disabled || busy} accessibilityRole="button"
      style={[s.btn, { backgroundColor: bg, opacity: disabled || busy ? 0.55 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: "700", fontSize: 14 }}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, tone = "neutral" }) {
  const t = useTheme();
  const c = tone === "orange" ? { fg: t.orange, bg: t.orangeBg } : toneColors(t, tone);
  return <View style={[s.chip, { backgroundColor: c.bg }]}><Text style={{ color: c.fg, fontSize: 11, fontWeight: "700" }}>{label}</Text></View>;
}

export function Box({ tone = "red", children, action }) {
  const t = useTheme();
  const c = tone === "orange" ? { fg: t.orange, bg: t.orangeBg } : tone === "accent" ? { fg: t.accent, bg: t.accentBg } : { fg: t.red, bg: t.redBg };
  return (
    <View style={[s.box, { backgroundColor: c.bg }]}>
      <Text style={{ color: c.fg, fontSize: 13, flexShrink: 1 }}>{children}</Text>
      {action}
    </View>
  );
}

export function Section({ title, children }) {
  const t = useTheme();
  return (
    <View style={[s.section, { backgroundColor: t.surface, borderColor: t.border }]}>
      {!!title && <Text style={{ color: t.ink3, fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: 8 }}>{title.toUpperCase()}</Text>}
      {children}
    </View>
  );
}

export function Row({ label, value }) {
  const t = useTheme();
  return (
    <View style={s.row}>
      <Text style={{ color: t.ink2, fontSize: 13, flex: 1 }}>{label}</Text>
      <Text style={{ color: t.ink, fontSize: 13, fontWeight: "600", flex: 1.4, textAlign: "right" }}>{value ?? "-"}</Text>
    </View>
  );
}

export function Field({ label, hint, error, required, ...input }) {
  const t = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.ink, fontSize: 13, fontWeight: "700" }}>{label}{required ? " *" : ""}</Text>
      <TextInput
        placeholderTextColor={t.ink3}
        {...input}
        style={[s.input, { backgroundColor: t.field, color: t.ink, borderColor: error ? t.red : t.border }, input.multiline && { height: 84, textAlignVertical: "top", paddingTop: 10 }]}
      />
      {!!hint && !error && <Text style={{ color: t.ink3, fontSize: 12 }}>{hint}</Text>}
      {!!error && <Text style={{ color: t.red, fontSize: 12 }}>{error}</Text>}
    </View>
  );
}

// Pilihan dari daftar (jenis biaya, kendaraan, rute, job, sumber dana).
export function PickerField({ label, required, value, options, onSelect, placeholder = "Pilih…", error, allowClear, emptyText = "Tidak ada pilihan", loading }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.ink, fontSize: 13, fontWeight: "700" }}>{label}{required ? " *" : ""}</Text>
      <Pressable onPress={() => setOpen(true)} style={[s.input, { backgroundColor: t.field, borderColor: error ? t.red : t.border, justifyContent: "center" }]}>
        <Text style={{ color: selected ? t.ink : t.ink3, fontSize: 15 }} numberOfLines={1}>{loading ? "Memuat…" : (selected?.label || placeholder)}</Text>
      </Pressable>
      {!!error && <Text style={{ color: t.red, fontSize: 12 }}>{error}</Text>}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={s.sheetWrap}>
          <View style={[s.sheet, { backgroundColor: t.surface }]}>
            <Text style={{ color: t.ink, fontWeight: "800", fontSize: 16, marginBottom: 8 }}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o) => String(o.value)}
              ListEmptyComponent={<Text style={{ color: t.ink3, paddingVertical: 16 }}>{emptyText}</Text>}
              renderItem={({ item }) => (
                <Pressable onPress={() => { onSelect(item.value); setOpen(false); }} style={[s.opt, { borderColor: t.border }]}>
                  <Text style={{ color: item.value === value ? t.accent : t.ink, fontWeight: item.value === value ? "800" : "500", fontSize: 15 }}>{item.label}</Text>
                  {!!item.sub && <Text style={{ color: t.ink3, fontSize: 12 }}>{item.sub}</Text>}
                </Pressable>
              )}
              style={{ maxHeight: 360 }}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              {allowClear && !!value && <Btn title="Kosongkan" kind="ghost" onPress={() => { onSelect(""); setOpen(false); }} style={{ flex: 1 }} />}
              <Btn title="Tutup" kind="ghost" onPress={() => setOpen(false)} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Dialog konfirmasi; bila `reason` = true, wajib mengisi alasan (minimal minLength huruf).
export function ActionModal({ visible, title, message, confirmLabel, danger, reason, reasonLabel = "Alasan", minLength = 3, busy, error, onCancel, onConfirm }) {
  const t = useTheme();
  const [text, setText] = useState("");
  useEffect(() => { if (visible) setText(""); }, [visible]);
  const invalid = reason && text.trim().length < minLength;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.center}>
        <View style={[s.dialog, { backgroundColor: t.surface }]}>
          <Text style={{ color: t.ink, fontWeight: "800", fontSize: 17 }}>{title}</Text>
          {!!message && <Text style={{ color: t.ink2, fontSize: 14 }}>{message}</Text>}
          {reason && <Field label={reasonLabel} required multiline value={text} onChangeText={setText} placeholder="Tulis alasan" hint={`Minimal ${minLength} karakter`} />}
          {!!error && <Box>{error}</Box>}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn title="Batal" kind="ghost" onPress={onCancel} disabled={busy} style={{ flex: 1 }} />
            <Btn title={confirmLabel} kind={danger ? "danger" : "primary"} busy={busy} disabled={invalid} onPress={() => onConfirm(text.trim())} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  btn: { minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" },
  box: { borderRadius: 10, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "space-between" },
  section: { borderWidth: 1, borderRadius: 14, padding: 14 },
  row: { flexDirection: "row", gap: 12, paddingVertical: 4 },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 15 },
  sheetWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16 },
  opt: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.45)" },
  dialog: { borderRadius: 16, padding: 18, gap: 12 },
});
