import React from "react";
import { Image } from "expo-image";

// Logo aplikasi SANSS Produksi (kasur + roda gigi + plus, Nov 2026) — aset yang sama dengan ikon peluncur.
const LOGO = require("../../assets/logo.png");

export function AppIcon({ size = 64 }: { size?: number }) {
  return <Image source={LOGO} style={{ width: size, height: size }} contentFit="contain" accessibilityLabel="Logo SANSS Produksi" />;
}
