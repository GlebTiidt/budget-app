import { CURRENCIES } from "./catalog.js";

export type SupportedCurrency = (typeof CURRENCIES)[number];

export type UserSettings = {
  telegramUserId: string;
  baseCurrency: SupportedCurrency;
  onboardingHelpShown: boolean;
};

export type UserSettingsRepository = {
  findByTelegramUserId(telegramUserId: string): Promise<UserSettings | null>;
  save(settings: UserSettings): Promise<void>;
};

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (CURRENCIES as readonly string[]).includes(value);
}
