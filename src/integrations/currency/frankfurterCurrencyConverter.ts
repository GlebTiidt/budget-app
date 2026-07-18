export type CurrencyConversionInput = {
  amount: number;
  from: string;
  to?: string;
  occurredOn: string;
};

export type CurrencyConversion = {
  originalAmount: number;
  originalCurrency: string;
  occurredOn: string;
  convertedAmount: number;
  targetCurrency: string;
  rate: number;
  rateDate: string;
};

export type CurrencyConverter = {
  convert(input: CurrencyConversionInput): Promise<CurrencyConversion>;
};

type FrankfurterRate = {
  date: string;
  base: string;
  quote: string;
  rate: number;
};

export function createFrankfurterCurrencyConverter(
  baseUrl = "https://api.frankfurter.dev/v2",
  fetchImpl: typeof fetch = fetch
): CurrencyConverter {
  return {
    async convert(input) {
      validateInput(input);

      const from = input.from.trim().toUpperCase();
      const to = (input.to ?? "EUR").trim().toUpperCase();

      if (from === to) {
        return {
          originalAmount: input.amount,
          originalCurrency: from,
          occurredOn: input.occurredOn,
          convertedAmount: roundMoney(input.amount),
          targetCurrency: to,
          rate: 1,
          rateDate: input.occurredOn
        };
      }

      const url = new URL(
        `${baseUrl.replace(/\/$/, "")}/rate/${encodeURIComponent(from)}/${encodeURIComponent(to)}`
      );
      url.searchParams.set("date", input.occurredOn);

      const response = await fetchImpl(url);
      if (!response.ok) {
        const message = await readErrorMessage(response);
        throw new Error(`Frankfurter conversion failed (${response.status}): ${message}`);
      }

      const data = (await response.json()) as FrankfurterRate;
      validateRate(data, from, to, input.occurredOn);

      return {
        originalAmount: input.amount,
        originalCurrency: from,
        occurredOn: input.occurredOn,
        convertedAmount: roundMoney(input.amount * data.rate),
        targetCurrency: to,
        rate: data.rate,
        rateDate: data.date
      };
    }
  };
}

function validateInput(input: CurrencyConversionInput): void {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Currency amount must be a positive number.");
  }

  if (!isCurrencyCode(input.from) || !isCurrencyCode(input.to ?? "EUR")) {
    throw new Error("Currency codes must use three ISO letters.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) {
    throw new Error("Transaction date must use YYYY-MM-DD.");
  }
}

function validateRate(
  data: FrankfurterRate,
  from: string,
  to: string,
  requestedDate: string
): void {
  if (
    data.base !== from ||
    data.quote !== to ||
    !Number.isFinite(data.rate) ||
    data.rate <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.date)
  ) {
    throw new Error("Frankfurter returned an invalid exchange rate.");
  }

  if (data.date > requestedDate) {
    throw new Error("Frankfurter returned a rate from after the transaction date.");
  }
}

function isCurrencyCode(value: string): boolean {
  return /^[A-Za-z]{3}$/.test(value.trim());
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message?.trim() || response.statusText || "unknown error";
  } catch {
    return response.statusText || "unknown error";
  }
}
