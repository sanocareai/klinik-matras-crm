import React from "react";
import Svg, { Path } from "react-native-svg";

// Set ikon garis tunggal (gaya Lucide, stroke 2, sudut membulat) digambar dengan react-native-svg.
// Satu sumber agar ketebalan, ukuran, dan gaya ikon konsisten di seluruh aplikasi.
const P = {
  home: ["M3 10.5 12 3l9 7.5", "M5 9.5V20h14V9.5", "M10 20v-6h4v6"],
  wallet: ["M3 7a2 2 0 0 1 2-2h13v4", "M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Z", "M16 14.5h.01"],
  receipt: ["M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3Z", "M9 8h6", "M9 12h6", "M9 16h3"],
  users: ["M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20", "M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35", "M15.5 4.15a3.5 3.5 0 0 1 0 6.7"],
  route: ["M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M8 17h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"],
  mapPin: ["M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z", "M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"],
  alert: ["M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z", "M12 9.5v4", "M12 17h.01"],
  chart: ["M4 20V10", "M10 20V4", "M16 20v-7", "M22 20H2"],
  bell: ["M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9Z", "M10.3 21a1.9 1.9 0 0 0 3.4 0"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  plus: ["M12 5v14", "M5 12h14"],
  chevronRight: ["m9 18 6-6-6-6"],
  arrowUpRight: ["M7 17 17 7", "M8 7h9v9"],
  camera: ["M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z", "M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"],
  checkCircle: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m8.5 12.5 2.5 2.5 4.5-5"],
  fileText: ["M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z", "M14 3v6h6", "M8 13h8", "M8 17h5"],
  edit: ["M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z", "M13.5 6.5l4 4"],
  x: ["M18 6 6 18", "M6 6l12 12"],
  refresh: ["M20 11a8 8 0 0 0-14.3-4.9L4 8", "M4 4v4h4", "M4 13a8 8 0 0 0 14.3 4.9L20 16", "M20 20v-4h-4"],
  user: ["M20 21v-1.5a4.5 4.5 0 0 0-4.5-4.5h-7A4.5 4.5 0 0 0 4 19.5V21", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"],
  calendar: ["M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z", "M16 3v4", "M8 3v4", "M4 10h16"],
  truck: ["M3 6h11v10H3z", "M14 10h4l3 3v3h-7", "M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M17.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
  fuel: ["M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16", "M3 21h12", "M4 10h10", "M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"],
  road: ["M5 21 9 3", "M19 21 15 3", "M12 4v2", "M12 10v3", "M12 17v3"],
  parking: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M9 17V7h4a3 3 0 0 1 0 6H9"],
  wrench: ["M14.7 6.3a4 4 0 0 0-5.4 5.3L3 18l3 3 6.4-6.3a4 4 0 0 0 5.3-5.4l-2.5 2.5-2.6-.4-.4-2.6 2.5-2.5Z"],
  droplet: ["M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z"],
  ticket: ["M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4V8Z", "M13 6v12"],
  box: ["M21 8 12 3 3 8v8l9 5 9-5V8Z", "m3 8 9 5 9-5", "M12 13v8"],
  cloudOff: ["M3 3l18 18", "M7.4 7.5A5.5 5.5 0 0 0 7 18h10.5", "M20.7 16.2A4 4 0 0 0 18 9h-1A6 6 0 0 0 10.4 5.2"],
  send: ["M21 3 10 14", "M21 3l-7 18-4-7-7-4 18-7Z"],
  undo: ["M9 14 4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-3"],
  shield: ["M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6l-7-3Z"],
  info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 11v5", "M12 8h.01"],
  inbox: ["M3 13h5l1.5 3h5L16 13h5", "M5.5 5h13L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5l2.5-8Z"],
  image: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z", "m21 15-5-5L5 21"],
  store: ["M4 10v10h16V10", "M3 4h18l-1 6H4L3 4Z", "M10 20v-5h4v5"],
  hash: ["M5 9h14", "M5 15h14", "M10 4 8 20", "M16 4l-2 16"],
  note: ["M4 5h16", "M4 10h16", "M4 15h10", "M4 20h7"],
  gauge: ["M12 14l4-4", "M3.5 18a9 9 0 1 1 17 0"],
};

export function Icon({ name, size = 20, color = "#000", strokeWidth = 2 }) {
  const d = P[name] || P.info;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {d.map((p, i) => <Path key={i} d={p} />)}
    </Svg>
  );
}

// Ikon per jenis biaya (kode dari config server). Kode lain jatuh ke ikon struk umum.
const KATEGORI = { BBM: "fuel", TOL: "road", PARKIR: "parking", SERVIS: "wrench", BAN: "gauge", CUCI: "droplet", DENDA: "ticket", SEWA: "truck" };
export function iconForExpense(code) {
  return KATEGORI[String(code || "").toUpperCase()] || "receipt";
}

