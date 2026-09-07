import assert from "node:assert/strict";
import test from "node:test";
import { parseBudgetQuestion, isDraftFollowup } from "../../src/budget/budgetQuestion.js";
const parse = (text: string) => parseBudgetQuestion(text, "Asia/Ho_Chi_Minh", ["Еда", "Еда вне дома", "Подписки"], new Date("2026-01-31T18:00:00Z"));
test("budget questions use local month and support category, named month and commands", () => {
  assert.equal(parse("Какой у меня остаток?")?.kind, "balance");
  assert.equal(parse("Какие у меня расходы в этом месяце по категориям?")?.month, "2026-02");
  assert.equal(parse("Покажи расходы за прошлый месяц")?.month, "2026-01");
  assert.equal(parse("Сколько потратил на подписки в декабре 2025?")?.month, "2025-12");
  assert.equal(parse("Сколько потратил на еда вне дома?")?.category, "Еда вне дома");
  assert.equal(parse("/month 2025-11")?.month, "2025-11");
  assert.equal(parse("Почему? Я перевёл свои деньги себе!")?.explainTransfer, true);
});
test("financial assertions remain data and field corrections remain pending-draft followups", () => {
  for (const text of ["Потратил 50 USD на еду", "Остаток 100 USD", "Сегодня доход 200 USD", "Перевел 100 USD себе"]) assert.equal(parse(text), null);
  for (const text of ["Со своего крипто кошелька", "1: счет Карта", "всё верно", "отмени всё", "для всех счет Crypto"]) assert.equal(isDraftFollowup(text), true);
  assert.equal(isDraftFollowup("Потратил 50 USD на еду"), false);
});
