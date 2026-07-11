import { useEffect, useState } from "react";

// Breakpoint SAMA dengan @media (max-width: 768px) di index.css — dipakai
// utk unmount kondisional kolom Inbox di mobile (bukan cuma sembunyikan
// via CSS), jadi ChatWindow/CustomerPanel benar-benar tidak ada di DOM
// saat tidak ditampilkan.
const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isMobile;
}
