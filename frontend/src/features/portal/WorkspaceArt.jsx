import React from "react";

// Ilustrasi kartu workspace — port 1:1 dari `workspaceArt` di file desain
// docs/design-system/SANSS-integrated-smart-system-v4.html.
//
// Kenapa SVG inline, bukan file .svg/.png di /public:
// ilustrasi ini ikut tema (semua turunan biru SANSS) dan dipakai SEKALI per
// kartu. Inline berarti nol request tambahan, ikut ter-tree-shake kalau
// kartunya tidak dirender, dan tidak ada aset biner yang harus disamakan
// manual tiap kali palet berubah.
//
// ⚠️ id di dalam <defs> (sg/ss, pg/ps, wg/ws, dg/ds, bg/bs) BERSIFAT GLOBAL
// per dokumen HTML, bukan per komponen. Prefiks per divisi di bawah sudah
// unik, JANGAN disamakan/di-copy antar ilustrasi — dua <linearGradient>
// dengan id sama membuat `url(#…)` mengambil yang pertama dirender, jadi
// ilustrasi kedua diam-diam salah warna (tanpa error apa pun di console).
//
// Kunci di sini memakai key portal APLIKASI (growth/bengkel/warehouse/
// armada/kendali), bukan nama divisi di mockup (sales/production/warehouse/
// delivery/dashboard) — pemetaannya: sales→growth, production→bengkel,
// delivery→armada, dashboard→kendali.

function SalesArt() {
  return (
    <svg viewBox="0 0 520 220" aria-hidden="true">
      <defs>
        <linearGradient id="sanss-sg" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#2F73F2" />
          <stop offset="1" stopColor="#1457D9" />
        </linearGradient>
        <filter id="sanss-ss" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#123B86" floodOpacity=".16" />
        </filter>
      </defs>
      <path d="M46 174C110 113 173 92 252 109s137 6 220-57" fill="none" stroke="#C6D8FF" strokeWidth="2" strokeDasharray="6 8" />
      <g filter="url(#sanss-ss)">
        <rect x="54" y="46" width="146" height="118" rx="24" fill="#fff" />
        <circle cx="94" cy="86" r="20" fill="#DCE8FF" />
        <path d="M85 91c3-13 19-13 22 0" fill="none" stroke="#2F73F2" strokeWidth="5" strokeLinecap="round" />
        <circle cx="96" cy="80" r="7" fill="#2F73F2" />
        <rect x="124" y="71" width="53" height="9" rx="4.5" fill="#173B78" />
        <rect x="124" y="89" width="36" height="7" rx="3.5" fill="#B9CFFF" />
        <rect x="76" y="123" width="102" height="10" rx="5" fill="#E8EFFF" />
      </g>
      <g filter="url(#sanss-ss)">
        <rect x="226" y="32" width="238" height="148" rx="28" fill="#fff" />
        <rect x="250" y="58" width="108" height="15" rx="7.5" fill="#173B78" />
        <rect x="250" y="86" width="158" height="12" rx="6" fill="#D9E5FF" />
        <rect x="250" y="108" width="126" height="12" rx="6" fill="#D9E5FF" />
        <path d="M269 148l35-21 35 9 44-44 39 17" fill="none" stroke="url(#sanss-sg)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="383" cy="92" r="8" fill="#2F73F2" />
      </g>
      <circle cx="205" cy="54" r="13" fill="#58D6B0" />
      <path d="M200 54h10M205 49v10" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ProductionArt() {
  return (
    <svg viewBox="0 0 520 220" aria-hidden="true">
      <defs>
        <linearGradient id="sanss-pg" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#4E8BFF" />
          <stop offset="1" stopColor="#1457D9" />
        </linearGradient>
        <filter id="sanss-ps" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#123B86" floodOpacity=".16" />
        </filter>
      </defs>
      <g filter="url(#sanss-ps)">
        <path d="M66 171V82l82 34V78l81 37V50h61v121Z" fill="#fff" stroke="#C7D8FB" strokeWidth="2" />
        <rect x="260" y="50" width="30" height="121" rx="8" fill="url(#sanss-pg)" />
        <rect x="91" y="132" width="39" height="23" rx="6" fill="#DCE8FF" />
        <rect x="157" y="132" width="39" height="23" rx="6" fill="#DCE8FF" />
      </g>
      <g filter="url(#sanss-ps)">
        <rect x="287" y="125" width="172" height="35" rx="17.5" fill="#173B78" />
        <circle cx="315" cy="143" r="7" fill="#C7D8FB" />
        <circle cx="349" cy="143" r="7" fill="#C7D8FB" />
        <circle cx="383" cy="143" r="7" fill="#C7D8FB" />
        <circle cx="417" cy="143" r="7" fill="#C7D8FB" />
        <rect x="314" y="91" width="91" height="37" rx="13" fill="#fff" stroke="#AFC6F7" strokeWidth="2" />
        <path d="M325 104h68M325 114h50" stroke="#79A4FF" strokeWidth="4" strokeLinecap="round" />
      </g>
      <rect x="333" y="39" width="105" height="43" rx="15" fill="#fff" filter="url(#sanss-ps)" />
      <circle cx="355" cy="60" r="9" fill="#58D6B0" />
      <path d="m350 60 4 4 7-9" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="374" y="54" width="44" height="7" rx="3.5" fill="#173B78" />
      <path d="M47 183h425" stroke="#BFD2F8" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function WarehouseArt() {
  return (
    <svg viewBox="0 0 520 220" aria-hidden="true">
      <defs>
        <linearGradient id="sanss-wg" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#2F73F2" />
          <stop offset="1" stopColor="#0E3B96" />
        </linearGradient>
        <filter id="sanss-ws" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#123B86" floodOpacity=".16" />
        </filter>
      </defs>
      <g filter="url(#sanss-ws)">
        <path d="M61 170V66h170v104" fill="#fff" stroke="#ADC5F7" strokeWidth="3" />
        <path d="M61 103h170M61 139h170M103 66v104M188 66v104" stroke="#B7CDF8" strokeWidth="3" />
        <rect x="76" y="76" width="53" height="20" rx="5" fill="#4E8BFF" />
        <rect x="143" y="77" width="35" height="19" rx="5" fill="#D8E5FF" />
        <rect x="83" y="112" width="47" height="20" rx="5" fill="#D8E5FF" />
        <rect x="149" y="111" width="63" height="21" rx="5" fill="#2F73F2" />
        <rect x="76" y="148" width="67" height="16" rx="5" fill="#D8E5FF" />
      </g>
      <g filter="url(#sanss-ws)">
        <path d="M298 104 365 70l70 35-67 35Z" fill="#DCE8FF" />
        <path d="m298 104 70 36v53l-70-36Z" fill="#ABC7FF" />
        <path d="m368 140 67-35v53l-67 35Z" fill="url(#sanss-wg)" />
        <path d="M335 86l69 35" stroke="#fff" strokeWidth="5" opacity=".7" />
      </g>
      <g filter="url(#sanss-ws)">
        <rect x="255" y="35" width="116" height="50" rx="17" fill="#fff" />
        <rect x="275" y="50" width="43" height="9" rx="4.5" fill="#173B78" />
        <rect x="275" y="67" width="72" height="7" rx="3.5" fill="#B7CDF8" />
        <circle cx="348" cy="55" r="9" fill="#F0B35B" />
      </g>
      <path d="M249 54c-24 17-24 52 2 66" fill="none" stroke="#7DA5F6" strokeWidth="3" strokeLinecap="round" strokeDasharray="5 8" />
    </svg>
  );
}

function DeliveryArt() {
  return (
    <svg viewBox="0 0 520 220" aria-hidden="true">
      <defs>
        <linearGradient id="sanss-dg" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#4E8BFF" />
          <stop offset="1" stopColor="#1457D9" />
        </linearGradient>
        <filter id="sanss-ds" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#123B86" floodOpacity=".16" />
        </filter>
      </defs>
      <path d="M47 162c77-66 155-36 221-66s134-42 206 2" fill="none" stroke="#95B5F7" strokeWidth="4" strokeLinecap="round" strokeDasharray="8 10" />
      <circle cx="52" cy="160" r="10" fill="#58D6B0" />
      <circle cx="468" cy="98" r="10" fill="#F0B35B" />
      <g filter="url(#sanss-ds)">
        <path d="M112 92h190v72H94v-54a18 18 0 0 1 18-18Z" fill="#fff" stroke="#B8CDF8" strokeWidth="2" />
        <path d="M302 114h72l49 50H302Z" fill="url(#sanss-dg)" />
        <path d="M323 126h41l24 25h-65Z" fill="#D8E6FF" />
        <circle cx="155" cy="167" r="27" fill="#173B78" />
        <circle cx="155" cy="167" r="11" fill="#DCE8FF" />
        <circle cx="362" cy="167" r="27" fill="#173B78" />
        <circle cx="362" cy="167" r="11" fill="#DCE8FF" />
        <rect x="128" y="111" width="116" height="31" rx="13" fill="#E8EFFF" />
        <path d="M146 127h79" stroke="#6D99F7" strokeWidth="6" strokeLinecap="round" />
      </g>
      <g filter="url(#sanss-ds)">
        <path d="M416 36c21 0 37 16 37 36 0 29-37 57-37 57s-37-28-37-57c0-20 16-36 37-36Z" fill="#fff" stroke="#AFC6F7" strokeWidth="2" />
        <circle cx="416" cy="72" r="13" fill="#2F73F2" />
      </g>
    </svg>
  );
}

function DashboardArt() {
  return (
    <svg viewBox="0 0 520 220" aria-hidden="true">
      <defs>
        <linearGradient id="sanss-bg" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#77A4FF" />
          <stop offset="1" stopColor="#FFFFFF" />
        </linearGradient>
        <filter id="sanss-bs" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#03143B" floodOpacity=".24" />
        </filter>
      </defs>
      <g filter="url(#sanss-bs)">
        <rect x="72" y="38" width="376" height="148" rx="28" fill="rgba(255,255,255,.96)" />
        <rect x="98" y="62" width="90" height="52" rx="16" fill="#E3ECFF" />
        <rect x="207" y="62" width="90" height="52" rx="16" fill="#E3ECFF" />
        <rect x="316" y="62" width="106" height="52" rx="16" fill="#D6E4FF" />
        <path d="M111 98V83h12v15m12 0V72h12v26m12 0V89h12v9" fill="none" stroke="#2F73F2" strokeWidth="6" strokeLinecap="round" />
        <path d="M223 96l17-15 17 7 22-18" fill="none" stroke="#2F73F2" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="279" cy="70" r="6" fill="#58D6B0" />
        <circle cx="369" cy="88" r="26" fill="none" stroke="#B8CDF8" strokeWidth="11" />
        <path d="M369 62a26 26 0 0 1 23 14" fill="none" stroke="#2F73F2" strokeWidth="11" strokeLinecap="round" />
        <rect x="98" y="133" width="211" height="10" rx="5" fill="#D8E5FF" />
        <rect x="98" y="155" width="154" height="10" rx="5" fill="#D8E5FF" />
        <rect x="335" y="132" width="87" height="33" rx="12" fill="#2F73F2" />
      </g>
      <circle cx="58" cy="102" r="9" fill="#7EA7FF" />
      <circle cx="460" cy="136" r="9" fill="#58D6B0" />
      <path d="M67 102h24M429 136h22" stroke="rgba(255,255,255,.72)" strokeWidth="3" strokeDasharray="4 6" />
    </svg>
  );
}

export const WORKSPACE_ART = {
  growth: SalesArt,
  bengkel: ProductionArt,
  warehouse: WarehouseArt,
  armada: DeliveryArt,
  kendali: DashboardArt,
};
