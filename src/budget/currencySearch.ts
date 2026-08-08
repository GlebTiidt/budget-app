import type { SupportedCurrency } from "./userSettings.js";

type CurrencySearchEntry = {
  code: SupportedCurrency;
  names: readonly string[];
};

const CURRENCY_SEARCH_ENTRIES: readonly CurrencySearchEntry[] = [
  {
    code: "USD",
    names: ["usd", "доллар", "доллары", "доллар сша", "американский доллар"]
  },
  {
    code: "RUB",
    names: ["rub", "руб", "рубль", "рубли", "российский рубль"]
  },
  {
    code: "VND",
    names: ["vnd", "донг", "донги", "вьетнамский донг"]
  },
  {
    code: "AUD",
    names: ["aud", "австралийский доллар", "доллар австралии"]
  },
  {
    code: "EUR",
    names: ["eur", "евро"]
  }
] as const;

export function searchSupportedCurrencies(query: string): SupportedCurrency[] {
  const normalizedQuery = normalizeCurrencyQuery(query);
  if (normalizedQuery.length < 2) {
    return [];
  }

  const exact = CURRENCY_SEARCH_ENTRIES.filter(
    (entry) =>
      normalizeCurrencyQuery(entry.code) === normalizedQuery ||
      entry.names.some((name) => normalizeCurrencyQuery(name) === normalizedQuery)
  );
  if (exact.length > 0) {
    return exact.map((entry) => entry.code);
  }

  return CURRENCY_SEARCH_ENTRIES.filter((entry) =>
    [entry.code, ...entry.names].some((name) =>
      normalizeCurrencyQuery(name).includes(normalizedQuery)
    )
  ).map((entry) => entry.code);
}

function normalizeCurrencyQuery(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}
