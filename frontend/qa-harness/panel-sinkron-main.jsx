// Memasang komponen ASLI StatusSinkronMeta dengan payload dari window.__S (diset skrip QA). Bukan bagian build rilis.
import React from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import "../src/styles/tailwind.css";
import StatusSinkronMeta from "../src/features/laporan/components/marketing/StatusSinkronMeta.jsx";
createRoot(document.getElementById("root")).render(<div style={{ maxWidth: 520 }}><StatusSinkronMeta s={JSON.parse(new URLSearchParams(location.search).get("s"))} /></div>);
