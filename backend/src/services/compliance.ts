const BLOCKED_COUNTRIES = new Set([
  "KP",
  "IR",
  "SY",
  "CU",
  "RU"
]);

export function isBlockedCountry(countryCode: string) {
  return BLOCKED_COUNTRIES.has(countryCode.toUpperCase());
}
