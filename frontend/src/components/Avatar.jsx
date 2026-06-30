import React from "react";
import { getInitials, avatarColor } from "../utils/format.js";

export default function Avatar({ name, size = "sm" }) {
  const initials = getInitials(name);
  const { bg, text } = avatarColor(name || "?");

  return (
    <div
      className={`avatar avatar-${size}`}
      style={{ background: bg, color: text }}
    >
      {initials}
    </div>
  );
}
