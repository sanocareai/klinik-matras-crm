import React, { useState } from "react";
import { getInitials, avatarColor } from "../utils/format.js";

export default function Avatar({ name, src, size = "sm" }) {
  const [imgError, setImgError] = useState(false);
  const initials        = getInitials(name);
  const { bg, text }    = avatarColor(name || "?");

  if (src && !imgError) {
    return (
      <img
        src={src}
        alt={initials}
        className={`avatar avatar-${size}`}
        style={{ objectFit: "cover" }}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div className={`avatar avatar-${size}`} style={{ background: bg, color: text }}>
      {initials}
    </div>
  );
}
