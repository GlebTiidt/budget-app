import { isUncategorizedReply } from "./draftCorrections.js";
export type BudgetQuestion = {
  kind: "balance" | "report" | "debts" | "history";
  month: string;
  category: string | null;
  explainTransfer: boolean;
};

const MONTHS = ["январ", "феврал", "март", "апрел", "ма[йяе]", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];

export function parseBudgetQuestion(text: string, timezone: string, categories: readonly string[], now = new Date()): BudgetQuestion | null {
  if (isUncategorizedReply(text)) return null;
  const value = text.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim();
  const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(now);
  let year = Number(dateParts.find(p => p.type === "year")!.value);
  let month = Number(dateParts.find(p => p.type === "month")!.value);
  const command = /^\/(balance|month|debts|history)(?:@\w+)?(?:\s|$)/.exec(value)?.[1];
  const asks = /^(?:а\s+)?(?:как(?:ой|ая|ие|ое|овы)|сколько|почему|откуда|покажи|покажите|расскажи|скажи|дай|выведи|можешь|хочу (?:увидеть|узнать|посмотреть))/.test(value) || /\?/.test(value);
  const reportPhrase = /^(?:мои\s+)?(?:расходы|доходы|траты|отчет|статистика|категории|история|операции)(?:\s+(?:за|по|в|этого|прошлого|месяц)|$)/.test(value);
  const balancePhrase = /^(?:мой\s+)?(?:остаток|баланс)(?:\s+(?:сейчас|денег))?[.!]?$/.test(value);
  const ownTransfer = /(?:перев[ео]л|перевод).*(?:себе|сво|между)/.test(value) || /(?:мои|свои) деньги/.test(value);
  if (!command && !asks && !reportPhrase && !balancePhrase) return null;
  let kind: BudgetQuestion["kind"];
  if (command === "balance" || /остаток|баланс|сколько.*(?:денег|средств|осталось)/.test(value) || (asks && ownTransfer)) kind = "balance";
  else if (command === "debts" || /долг|должен|должны/.test(value)) kind = "debts";
  else if (command === "history" || /истори|список.*операц|последни.*операц/.test(value)) kind = "history";
  else if (command === "month" || /расход|доход|трат|потрач|ушло|заплат|категори|отчет|статистик|заработал/.test(value)) kind = "report";
  else return null;
  if (/прошл(?:ый|ом|ого) месяц/.test(value)) { month--; if (month === 0) { month = 12; year--; } }
  const explicit = /\b(20\d{2})-(0[1-9]|1[0-2])\b/.exec(value);
  if (explicit) { year = Number(explicit[1]); month = Number(explicit[2]); }
  else {
    const namedMonth = MONTHS.findIndex(name => new RegExp(name).test(value));
    if (namedMonth >= 0) month = namedMonth + 1;
    const explicitYear = /\b(20\d{2})\b/.exec(value);
    if (explicitYear) year = Number(explicitYear[1]);
  }
  const category = [...categories].sort((a, b) => b.length - a.length).find(c => value.includes(c.toLocaleLowerCase("ru-RU").replaceAll("ё", "е"))) ??
    (/кофе/.test(value) ? "Кофешоп" : /подписк/.test(value) ? "Подписки" : /транспорт|такси/.test(value) ? "Транспорт" : null);
  return { kind, month: `${year}-${String(month).padStart(2, "0")}`, category, explainTransfer: ownTransfer || /почему|откуда/.test(value) };
}

export function isDraftFollowup(text: string): boolean {
  if (isUncategorizedReply(text)) return true;
  if (/^(?:покажи|показать)\s+черновик[.!]?$/iu.test(text.trim())) return true;
  const value = text.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim();
  return /^(?:все верно|верно|подтверждаю|ничего не пропустил|исправ|измени|замени|отмен|нет(?:\s|$)|неправильно|для всех|всем|тоже|долг\s*\d|\d+\s*[:.)]|счет|со счета|из |с моего|со своего|валюта|категория|дата|сумма|это |пусть|объедин)/.test(value) ||
    /^(?:crypto|крипто(?:кошелек|кошелька)?|карта|наличные|сбережения|вьетнамский счет)[.!]?$/.test(value);
}
