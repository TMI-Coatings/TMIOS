export const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
export const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");
export const pct = (v: number) => Math.round(v * 100) + "%";
/** Whole cents to a short dollar figure. */
/** Whole dollars with separators, e.g. $1,000, for thresholds where "$1K" reads oddly. */
export const usdFull = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("en-US");

export const usd = (cents: number) => {
  const v = cents / 100;
  return v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + Math.round(v / 1e3) + "K" : "$" + Math.round(v);
};
export const dollars = (cents: number) => "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
/** Dollars typed in a box to whole cents. */
export const toCents = (s: string) => Math.round(parseFloat(s.replace(/[$,\s]/g, "")) * 100);
export const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

/** 1st, 2nd, 3rd, 4th … 21st, 22nd. */
export const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th"));
