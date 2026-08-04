export const EXPENSE_CATEGORIES = [
  "Кот",
  "Еда",
  "Транспорт",
  "Жильё",
  "Подписки",
  "Здоровье",
  "Развлечения",
  "Покупки",
  "Другое",
  "Кофешоп",
  "Еда вне дома",
  "Спорт"
] as const;

export const INCOME_CATEGORIES = ["Фриланс", "Работа"] as const;

export const TRANSACTION_CATEGORIES = [
  ...EXPENSE_CATEGORIES,
  ...INCOME_CATEGORIES
] as const;

export const ACCOUNTS = [
  "Наличные",
  "Карта",
  "Сбережения",
  "Вьетнамский счёт",
  "Crypto"
] as const;

export const CURRENCIES = ["USD", "RUB", "VND", "AUD", "EUR"] as const;
