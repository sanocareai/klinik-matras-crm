import React from "react";
import { Text, View } from "react-native";
import { useTheme } from "./theme";
import { font, toneColors, type Tone } from "./tokens";
import { statusInfo } from "@/lib/strings";

type Props = {
  /** Kode status dari server (mis. MENUNGGU_APPROVAL). Status tak dikenal tampil apa adanya. */
  status?: string;
  /** Untuk lencana bebas (bukan status server). */
  label?: string;
  tone?: Tone;
};

export function StatusBadge({ status, label, tone }: Props) {
  const { colors } = useTheme();
  const info = status ? statusInfo(status) : { label: label ?? "", tone: tone ?? "neutral" };
  const { fg, bg } = toneColors(colors, tone ?? info.tone);
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ color: fg, fontFamily: font.medium, fontSize: 12, lineHeight: 16 }} numberOfLines={1}>
        {label ?? info.label}
      </Text>
    </View>
  );
}
