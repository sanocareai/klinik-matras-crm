import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { elevation, radius, toneColors, type, useTheme } from "./theme";
import { Icon } from "./icons";

// Komponen dasar design system Delivery Control. Semua warna dari theme.js; tidak ada warna literal per layar.

/** Latar gradien halus (SVG) — dipakai hero dan kartu unggulan. `colors` 2–3 warna, diagonal kiri-atas → kanan-bawah. */
export function Gradient({ colors, style, radius: r = 0, children }) {
  const id = `g${colors.join("").replace(/[^a-zA-Z0-9]/g, "")}`;
  // Ukuran diukur dulu (onLayout) lalu SVG digambar dengan angka pasti: SVG berukuran persen di dalam
  // absoluteFill tidak selalu mengisi penuh di Android. Warna pertama menjadi latar cadangan.
  const [ukuran, setUkuran] = useState(null);
  return (
    <View
      style={[{ overflow: "hidden", borderRadius: r, backgroundColor: colors[0] }, style]}
      onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (!ukuran || ukuran.w !== width || ukuran.h !== height) setUkuran({ w: width, h: height }); }}
    >
      {!!ukuran && (
        <Svg style={StyleSheet.absoluteFill} width={ukuran.w} height={ukuran.h}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2={ukuran.w} y2={ukuran.h} gradientUnits="userSpaceOnUse">
              {colors.map((c, i) => <Stop key={i} offset={colors.length === 1 ? 0 : i / (colors.length - 1)} stopColor={c} />)}
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={ukuran.w} height={ukuran.h} fill={`url(#${id})`} />
        </Svg>
      )}
      {children}
    </View>
  );
}

export function Btn({ title, onPress, kind = "primary", disabled, busy, style, icon, size = "md" }) {
  const t = useTheme();
  const v = {
    primary: { bg: t.accent, fg: t.accentInk, border: "transparent" },
    secondary: { bg: t.accentSoft, fg: t.accent, border: "transparent" },
    ghost: { bg: t.surface, fg: t.ink, border: t.borderStrong },
    danger: { bg: t.redBg, fg: t.red, border: "transparent" },
    light: { bg: "#FFFFFF", fg: t.navy, border: "transparent" },
  }[kind] || {};
  const h = size === "sm" ? 38 : size === "lg" ? 54 : 48;
  return (
    <Pressable
      onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={title}
      style={({ pressed }) => [
        s.btn, { minHeight: h, backgroundColor: v.bg, borderColor: v.border, opacity: disabled || busy ? 0.5 : pressed ? 0.85 : 1 },
        kind === "primary" && elevation(t, 1), style,
      ]}
    >
      {busy ? <ActivityIndicator color={v.fg} /> : (
        <View style={s.btnInner}>
          {!!icon && <Icon name={icon} size={size === "sm" ? 16 : 18} color={v.fg} />}
          <Text style={{ color: v.fg, fontWeight: "700", fontSize: size === "sm" ? 13 : 15 }} numberOfLines={1}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, badge, tone = "neutral", style }) {
  const t = useTheme();
  const c = tone === "neutral" ? { fg: t.ink, bg: t.surface } : toneColors(t, tone);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => [s.iconBtn, { backgroundColor: c.bg, borderColor: t.border, opacity: pressed ? 0.7 : 1 }, tone === "neutral" && elevation(t, 1), style]}>
      <Icon name={icon} size={19} color={c.fg} />
      {!!badge && <View style={[s.badgeDot, { backgroundColor: t.red, borderColor: t.surface }]}><Text style={s.badgeTxt}>{badge > 9 ? "9+" : badge}</Text></View>}
    </Pressable>
  );
}

/** Wadah ikon berwarna (kotak membulat). */
export function IconBox({ name, tone = "accent", size = 42, iconSize, solid }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, alignItems: "center", justifyContent: "center", backgroundColor: solid ? c.fg : c.bg }}>
      <Icon name={name} size={iconSize || Math.round(size * 0.48)} color={solid ? "#FFFFFF" : c.fg} />
    </View>
  );
}

/** Badge status: titik warna + label. */
export function Chip({ label, tone = "neutral", size = "md" }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View style={[s.chip, { backgroundColor: c.bg, paddingVertical: size === "sm" ? 2 : 4 }]}>
      <View style={[s.chipDot, { backgroundColor: c.fg }]} />
      <Text style={{ color: c.fg, fontSize: size === "sm" ? 11 : 12, fontWeight: "700" }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function Card({ children, style, onPress, padded = true, level = 1 }) {
  const t = useTheme();
  const base = [s.card, { backgroundColor: t.surface, borderColor: t.border }, padded && { padding: 16 }, elevation(t, level), style];
  if (!onPress) return <View style={base}>{children}</View>;
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [...base, pressed && { opacity: 0.88, transform: [{ scale: 0.995 }] }]}>{children}</Pressable>;
}

/** Pesan berwarna (galat/peringatan/info) dengan ikon dan aksi opsional. */
export function Box({ tone = "red", children, action, icon }) {
  const t = useTheme();
  const c = toneColors(t, tone === "red" ? "red" : tone);
  const ic = icon || (tone === "red" ? "alert" : tone === "orange" ? "info" : "info");
  return (
    <View style={[s.box, { backgroundColor: c.bg }]}>
      <Icon name={ic} size={18} color={c.fg} />
      <Text style={{ color: c.fg, fontSize: 13, fontWeight: "600", flex: 1, lineHeight: 18 }}>{children}</Text>
      {action}
    </View>
  );
}

export function Section({ title, icon, children, right, style }) {
  const t = useTheme();
  return (
    <Card style={[{ gap: 12 }, style]}>
      {!!title && (
        <View style={s.sectionHead}>
          {!!icon && <Icon name={icon} size={16} color={t.ink3} />}
          <Text style={[type.overline, { color: t.ink3, flex: 1 }]}>{title.toUpperCase()}</Text>
          {right}
        </View>
      )}
      {children}
    </Card>
  );
}

export function Row({ label, value, icon, last }) {
  const t = useTheme();
  return (
    <View style={[s.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}>
      {!!icon && <Icon name={icon} size={16} color={t.ink3} />}
      <Text style={{ color: t.ink2, fontSize: 13, flex: 1 }}>{label}</Text>
      <Text style={{ color: t.ink, fontSize: 14, fontWeight: "600", flex: 1.4, textAlign: "right" }}>{value ?? "-"}</Text>
    </View>
  );
}

export function Field({ label, hint, error, required, icon, ...input }) {
  const t = useTheme();
  const [fokus, setFokus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.label, { color: t.ink }]}>{label}{required ? <Text style={{ color: t.red }}> *</Text> : null}</Text>
      <View style={[s.input, { backgroundColor: t.field, borderColor: error ? t.red : fokus ? t.accent : t.fieldBorder }, input.multiline && { minHeight: 92, alignItems: "flex-start", paddingTop: 12 }]}>
        {!!icon && <Icon name={icon} size={18} color={fokus ? t.accent : t.ink3} />}
        <TextInput
          placeholderTextColor={t.ink3}
          {...input}
          onFocus={(e) => { setFokus(true); input.onFocus?.(e); }}
          onBlur={(e) => { setFokus(false); input.onBlur?.(e); }}
          style={[{ flex: 1, color: t.ink, fontSize: 15, paddingVertical: 10 }, input.multiline && { textAlignVertical: "top", paddingTop: 0 }, input.style]}
        />
      </View>
      {!!hint && !error && <Text style={[type.caption, { color: t.ink3 }]}>{hint}</Text>}
      {!!error && <Text style={[type.caption, { color: t.red }]}>{error}</Text>}
    </View>
  );
}

// Pilihan dari daftar (jenis biaya, kendaraan, rute, job, sumber dana) — lembar bawah.
export function PickerField({ label, required, value, options, onSelect, placeholder = "Pilih…", error, allowClear, emptyText = "Tidak ada pilihan", loading, icon }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.label, { color: t.ink }]}>{label}{required ? <Text style={{ color: t.red }}> *</Text> : null}</Text>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={label}
        style={[s.input, { backgroundColor: t.field, borderColor: error ? t.red : t.fieldBorder }]}>
        {!!(selected?.icon || icon) && <Icon name={selected?.icon || icon} size={18} color={selected ? t.accent : t.ink3} />}
        <Text style={{ color: selected ? t.ink : t.ink3, fontSize: 15, flex: 1, fontWeight: selected ? "600" : "400" }} numberOfLines={1}>{loading ? "Memuat…" : (selected?.label || placeholder)}</Text>
        <Icon name="chevronRight" size={18} color={t.ink3} />
      </Pressable>
      {!!error && <Text style={[type.caption, { color: t.red }]}>{error}</Text>}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={[s.sheetWrap, { backgroundColor: t.scrim }]} onPress={() => setOpen(false)}>
          <Pressable style={[s.sheet, { backgroundColor: t.surface }]} onPress={() => {}}>
            <View style={[s.grabber, { backgroundColor: t.borderStrong }]} />
            <Text style={[type.heading, { color: t.ink, marginBottom: 8 }]}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o) => String(o.value)}
              ListEmptyComponent={<Text style={{ color: t.ink3, paddingVertical: 16 }}>{emptyText}</Text>}
              renderItem={({ item }) => {
                const aktif = item.value === value;
                return (
                  <Pressable onPress={() => { onSelect(item.value); setOpen(false); }} style={[s.opt, { backgroundColor: aktif ? t.accentBg : "transparent" }]}>
                    {!!item.icon && <IconBox name={item.icon} tone={aktif ? "accent" : "neutral"} size={34} />}
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: aktif ? t.accent : t.ink, fontWeight: aktif ? "800" : "600", fontSize: 15 }}>{item.label}</Text>
                      {!!item.sub && <Text style={{ color: t.ink3, fontSize: 12 }}>{item.sub}</Text>}
                    </View>
                    {aktif && <Icon name="checkCircle" size={20} color={t.accent} />}
                  </Pressable>
                );
              }}
              style={{ maxHeight: 380 }}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              {allowClear && !!value && <Btn title="Kosongkan" kind="ghost" onPress={() => { onSelect(""); setOpen(false); }} style={{ flex: 1 }} />}
              <Btn title="Tutup" kind="secondary" onPress={() => setOpen(false)} style={{ flex: 1 }} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// Dialog konfirmasi; bila `reason` = true, wajib mengisi alasan (minimal minLength huruf).
export function ActionModal({ visible, title, message, confirmLabel, danger, reason, reasonLabel = "Alasan", minLength = 3, busy, error, onCancel, onConfirm, icon }) {
  const t = useTheme();
  const [text, setText] = useState("");
  useEffect(() => { if (visible) setText(""); }, [visible]);
  const invalid = reason && text.trim().length < minLength;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[s.center, { backgroundColor: t.scrim }]}>
        <View style={[s.dialog, { backgroundColor: t.surface }, elevation(t, 2)]}>
          <IconBox name={icon || (danger ? "alert" : "info")} tone={danger ? "red" : "accent"} size={46} />
          <Text style={[type.heading, { color: t.ink, fontSize: 18 }]}>{title}</Text>
          {!!message && <Text style={{ color: t.ink2, fontSize: 14, lineHeight: 20 }}>{message}</Text>}
          {reason && <Field label={reasonLabel} required multiline value={text} onChangeText={setText} placeholder="Tulis alasan" hint={`Minimal ${minLength} karakter`} />}
          {!!error && <Box>{error}</Box>}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <Btn title="Batal" kind="ghost" onPress={onCancel} disabled={busy} style={{ flex: 1 }} />
            <Btn title={confirmLabel} kind={danger ? "danger" : "primary"} busy={busy} disabled={invalid} onPress={() => onConfirm(text.trim())} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Keadaan kosong / galat / memuat yang seragam. */
export function StateView({ icon = "inbox", title, message, tone = "accent", action, loading }) {
  const t = useTheme();
  return (
    <View style={s.state}>
      {loading ? <ActivityIndicator size="large" color={t.accent} /> : <IconBox name={icon} tone={tone} size={64} />}
      {!!title && <Text style={[type.heading, { color: t.ink, textAlign: "center" }]}>{title}</Text>}
      {!!message && <Text style={{ color: t.ink2, fontSize: 14, textAlign: "center", lineHeight: 20, maxWidth: 300 }}>{message}</Text>}
      {action}
    </View>
  );
}

/** Kerangka pemuatan (placeholder abu) untuk daftar. */
export function SkeletonList({ count = 4 }) {
  const t = useTheme();
  return (
    <View style={{ gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[s.card, s.skel, { backgroundColor: t.surface, borderColor: t.border }]}>
          <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: t.neutralBg }} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ width: "55%", height: 12, borderRadius: 6, backgroundColor: t.neutralBg }} />
            <View style={{ width: "35%", height: 10, borderRadius: 5, backgroundColor: t.neutralBg }} />
          </View>
          <View style={{ width: 70, height: 14, borderRadius: 7, backgroundColor: t.neutralBg }} />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  btn: { borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderWidth: 1 },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  badgeDot: { position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  badgeTxt: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.pill, paddingHorizontal: 10, alignSelf: "flex-start" },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  card: { borderWidth: 1, borderRadius: radius.lg },
  box: { borderRadius: radius.md, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 18, paddingTop: 10 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  opt: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 10, borderRadius: radius.md },
  center: { flex: 1, justifyContent: "center", padding: 22 },
  dialog: { borderRadius: radius.xl, padding: 22, gap: 12 },
  state: { alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 48, paddingHorizontal: 24 },
  skel: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
});
