/** Currencies an account can be kept in, with a sensible default locale. */
export const WORKSPACE_CURRENCIES = [
  { code: "USD", symbol: "$", label: "US Dollar", locale: "en-US" },
  { code: "EUR", symbol: "€", label: "Euro", locale: "de-DE" },
  { code: "GBP", symbol: "£", label: "British Pound", locale: "en-GB" },
  { code: "INR", symbol: "₹", label: "Indian Rupee", locale: "en-IN" },
  { code: "AED", symbol: "د.إ", label: "UAE Dirham", locale: "ar-AE" },
  { code: "SAR", symbol: "﷼", label: "Saudi Riyal", locale: "ar-SA" },
  { code: "QAR", symbol: "﷼", label: "Qatari Riyal", locale: "ar-QA" },
  { code: "KWD", symbol: "د.ك", label: "Kuwaiti Dinar", locale: "ar-KW" },
  { code: "OMR", symbol: "﷼", label: "Omani Rial", locale: "ar-OM" },
  { code: "BHD", symbol: ".د.ب", label: "Bahraini Dinar", locale: "ar-BH" },
  { code: "CAD", symbol: "$", label: "Canadian Dollar", locale: "en-CA" },
  { code: "AUD", symbol: "$", label: "Australian Dollar", locale: "en-AU" },
  { code: "NZD", symbol: "$", label: "New Zealand Dollar", locale: "en-NZ" },
  { code: "ZAR", symbol: "R", label: "South African Rand", locale: "en-ZA" },
  { code: "PKR", symbol: "₨", label: "Pakistani Rupee", locale: "en-PK" },
  { code: "BDT", symbol: "৳", label: "Bangladeshi Taka", locale: "en-BD" },
  { code: "LKR", symbol: "Rs", label: "Sri Lankan Rupee", locale: "en-LK" },
  { code: "NGN", symbol: "₦", label: "Nigerian Naira", locale: "en-NG" },
  { code: "KES", symbol: "KSh", label: "Kenyan Shilling", locale: "en-KE" },
  { code: "EGP", symbol: "E£", label: "Egyptian Pound", locale: "en-EG" },
  { code: "MAD", symbol: "DH", label: "Moroccan Dirham", locale: "fr-MA" },
  { code: "TRY", symbol: "₺", label: "Turkish Lira", locale: "tr-TR" },
  { code: "RUB", symbol: "₽", label: "Russian Ruble", locale: "ru-RU" },
  { code: "BRL", symbol: "R$", label: "Brazilian Real", locale: "pt-BR" },
  { code: "MXN", symbol: "$", label: "Mexican Peso", locale: "es-MX" },
  { code: "JPY", symbol: "¥", label: "Japanese Yen", locale: "ja-JP" },
  { code: "CNY", symbol: "¥", label: "Chinese Yuan", locale: "zh-CN" },
  { code: "SGD", symbol: "$", label: "Singapore Dollar", locale: "en-SG" },
  { code: "MYR", symbol: "RM", label: "Malaysian Ringgit", locale: "en-MY" },
  { code: "PHP", symbol: "₱", label: "Philippine Peso", locale: "en-PH" },
  { code: "IDR", symbol: "Rp", label: "Indonesian Rupiah", locale: "id-ID" },
  { code: "THB", symbol: "฿", label: "Thai Baht", locale: "th-TH" },
  { code: "VND", symbol: "₫", label: "Vietnamese Dong", locale: "vi-VN" },
  { code: "CHF", symbol: "CHF", label: "Swiss Franc", locale: "de-CH" },
  { code: "SEK", symbol: "kr", label: "Swedish Krona", locale: "sv-SE" },
  { code: "NOK", symbol: "kr", label: "Norwegian Krone", locale: "nb-NO" },
  { code: "DKK", symbol: "kr", label: "Danish Krone", locale: "da-DK" },
  { code: "PLN", symbol: "zł", label: "Polish Zloty", locale: "pl-PL" },
  { code: "CZK", symbol: "Kč", label: "Czech Koruna", locale: "cs-CZ" },
  { code: "HUF", symbol: "Ft", label: "Hungarian Forint", locale: "hu-HU" },
  { code: "RON", symbol: "lei", label: "Romanian Leu", locale: "ro-RO" },
  { code: "BGN", symbol: "лв", label: "Bulgarian Lev", locale: "bg-BG" },
  { code: "UAH", symbol: "₴", label: "Ukrainian Hryvnia", locale: "uk-UA" },
] as const;

export const DEFAULT_CURRENCY = "USD";

export type CurrencyCode = (typeof WORKSPACE_CURRENCIES)[number]["code"];

/** The saved code if it is one we know, otherwise US Dollar. */
export function currencyOrDefault(code: string | undefined): CurrencyCode {
  const found = WORKSPACE_CURRENCIES.find((c) => c.code === code);
  return found?.code ?? DEFAULT_CURRENCY;
}

/** The symbol to show for a saved code. */
export function currencySymbol(code: string | undefined): string {
  return (
    WORKSPACE_CURRENCIES.find((c) => c.code === codeOrDefault(code))?.symbol ??
    "$"
  );
}

function codeOrDefault(code: string | undefined): string {
  return code ?? DEFAULT_CURRENCY;
}

/** Format an amount in the workspace currency, e.g. "$1,234.50". */
export function formatCurrency(
  amount: number,
  code: string | undefined,
  fractionDigits = 2,
): string {
  const resolved = currencyOrDefault(code);
  const entry =
    WORKSPACE_CURRENCIES.find((c) => c.code === resolved) ??
    WORKSPACE_CURRENCIES[0];
  return new Intl.NumberFormat(entry.locale, {
    style: "currency",
    currency: resolved,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

/** Validate a code coming from the client before it is stored. */
export function cleanCurrency(code: string): CurrencyCode {
  const upper = code.trim().toUpperCase();
  if (!WORKSPACE_CURRENCIES.some((c) => c.code === upper)) {
    throw new Error("Pick a currency from the list.");
  }
  return upper as CurrencyCode;
}
