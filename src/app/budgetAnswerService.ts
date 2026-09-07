import { calculateBalanceTimeline, roundMoney } from "../budget/balanceTimeline.js";
import type { BudgetQuestion } from "../budget/budgetQuestion.js";
import type { SupportedCurrency } from "../budget/userSettings.js";
import type { BudgetHistoryRepository } from "../integrations/notion/notionBudgetHistoryRepository.js";
import type { MasterOpeningBalanceRepository } from "../integrations/notion/notionMasterOpeningBalanceRepository.js";
import { buildMasterReport } from "../reports/masterReport.js";

export function createBudgetAnswerService(options: { historyRepository: BudgetHistoryRepository; openingBalanceRepository: MasterOpeningBalanceRepository }) {
  return {
    async answer(question: BudgetQuestion, baseCurrency: SupportedCurrency): Promise<string> {
      const [opening, history] = await Promise.all([options.openingBalanceRepository.find(), options.historyRepository.read()]);
      if (!opening) return "Стартовый остаток ещё не задан. Пришлите остатки по кошелькам на одну дату.";
      if (opening.currency !== baseCurrency) return "Валюта истории отличается от выбранной. Нужен пересчёт валюты; пока итоги не показываю, чтобы не смешивать суммы.";
      const balance = calculateBalanceTimeline(opening, history).currentBalance;
      const total = `Общий остаток: ${money(balance)} ${baseCurrency}.`;
      if (question.kind === "balance") return [
        total,
        question.explainTransfer ? "Перевод между своими счетами не меняет общий остаток: деньги остаются вашими. В расчёт входят только подтверждённые операции; черновики ещё не учтены." : "По подтверждённым операциям. Черновики ещё не учтены."
      ].join("\n\n");
      if (question.kind === "debts") {
        const positions = new Map<string, { who: string; currency: string; amount: number; side: string }>();
        for (const operation of history.operations.filter(o => o.kind === "debt")) {
          const side = operation.action === "borrow" || operation.action === "repay_borrowed" ? "Я должен" : "Мне должны";
          const key = `${side}\0${operation.counterparty}\0${operation.originalCurrency}`;
          const entry = positions.get(key) ?? { who: operation.counterparty!, currency: operation.originalCurrency!, amount: 0, side };
          entry.amount = roundMoney(entry.amount + (operation.action === "borrow" || operation.action === "lend" ? 1 : -1) * operation.originalAmount!);
          positions.set(key, entry);
        }
        const rows = [...positions.values()].filter(p => p.amount !== 0).map(p => `${p.side} · ${p.who}: ${money(p.amount)} ${p.currency}`);
        return [...(rows.length ? rows : ["По записям открытых долгов нет."]), "", total].join("\n");
      }
      const transactions = history.operations.filter(o => o.kind === "transaction");
      if (question.kind === "history") {
        const rows = transactions.filter(o => o.occurredOn.startsWith(question.month)).sort((a,b) => b.occurredOn.localeCompare(a.occurredOn) || b.order-a.order);
        return [`Последние операции за ${question.month} (${Math.min(rows.length, 15)} из ${rows.length}):`, ...rows.slice(0,15).map(o => `${o.occurredOn} · ${o.direction === "income" ? "+" : o.direction === "expense" ? "−" : "Перевод "}${money(o.baseAmount)} ${baseCurrency} · ${o.description}`), ...(rows.length ? [] : ["Операций пока нет."]), "", total].join("\n");
      }
      const report = buildMasterReport(question.month, transactions.map(o => ({ occurredOn: o.occurredOn, direction: o.direction!, amount: o.baseAmount, category: o.category ?? null })), baseCurrency);
      const categories = question.category ? report.expenseCategories.filter(c => c.category === question.category) : report.expenseCategories;
      const rows = categories.map(c => `• ${c.category}: ${money(c.amount)} ${baseCurrency}`);
      return [`За ${question.month}:`, `Доходы: ${money(report.income)} ${baseCurrency}`, `Расходы: ${money(report.expense)} ${baseCurrency}`, "", question.category ? `Категория «${question.category}»:` : "Расходы по категориям:", ...(rows.length ? rows : [`${question.category ? "В этой категории расходов" : "Расходов"} нет.`]), "", total].join("\n");
    }
  };
}
function money(value: number) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value); }
