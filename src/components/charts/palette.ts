// Shared chart palette — terracotta-first, then cool accents that still read
// well in both light and dark mode. Keeping colors in one module so every
// chart in the app stays consistent.

export const CHART_COLORS = [
  "#cc5500", // terracotta (primary)
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#6366f1", // indigo
  "#84cc16", // lime
  "#ef4444", // red
];

export const BOOK_BAND_COLORS = {
  personal: "#cc5500",
  business: "#3b82f6",
  nonprofit: "#10b981",
} as const;
