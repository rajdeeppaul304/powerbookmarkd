// src/utils.js
export function hostOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

export function formatDate(isoString) {
  if (!isoString) return "";
  return new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}