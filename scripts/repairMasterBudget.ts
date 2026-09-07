import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../src/config/loadConfig.js";
import { calculateBalanceTimeline } from "../src/budget/balanceTimeline.js";
import { createNotionBudgetHistoryRepository } from "../src/integrations/notion/notionBudgetHistoryRepository.js";
import { createNotionMasterOpeningBalanceRepository } from "../src/integrations/notion/notionMasterOpeningBalanceRepository.js";

const config = loadConfig();
if (!config.notionApiKey || !config.notionBudgetDataSourceId || !config.notionDebtDataSourceId || !config.notionBalanceDataSourceId || !config.notionMasterSettingsDataSourceId || !config.masterTelegramUserId) throw new Error("Master budget is not configured.");
const historyRepository = createNotionBudgetHistoryRepository({ apiKey: config.notionApiKey, transactionDataSourceId: config.notionBudgetDataSourceId, debtDataSourceId: config.notionDebtDataSourceId, balanceDataSourceId: config.notionBalanceDataSourceId });
const opening = await createNotionMasterOpeningBalanceRepository({ apiKey: config.notionApiKey, dataSourceId: config.notionMasterSettingsDataSourceId, masterTelegramUserId: config.masterTelegramUserId }).find();
if (!opening) throw new Error("No opening balance.");
const history = await historyRepository.read();
const timeline = calculateBalanceTimeline(opening, history);
const changed = history.operations.filter(o => o.runningBalance !== timeline.runningBalances.get(o.sourceId));
const importedOpening = [...history.anchors].sort((a,b) => a.createdAt.localeCompare(b.createdAt)).find(a => a.occurredOn === opening.effectiveOn && a.balance === opening.amount && a.baseCurrency === opening.currency);
console.log(JSON.stringify({ mode: process.argv.includes("--apply") ? "apply" : "dry-run", operations: history.operations.length, derivedRowsToRepair: changed.length, currentBalance: timeline.currentBalance, currency: opening.currency }));
if (process.argv.includes("--apply")) {
  const directory = join(".data", "budget-repair");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, `${new Date().toISOString().replaceAll(":", "-")}.json`), JSON.stringify({ opening, history }, null, 2), { mode: 0o600, flag: "wx" });
  // Normalize only an imported opening row; ordinary Telegram anchors retain their order.
  if (importedOpening && importedOpening.order >= 1_000_000_000) {
    const response = await fetch(`https://api.notion.com/v1/pages/${encodeURIComponent(importedOpening.pageId)}`, {
      method: "PATCH", headers: { authorization: `Bearer ${config.notionApiKey}`, "content-type": "application/json", "notion-version": "2026-03-11" },
      body: JSON.stringify({ properties: { "Порядок": { number: 0 } } })
    });
    if (!response.ok) throw new Error(`Opening order repair failed (${response.status}).`);
  }
  await historyRepository.repair(opening);
  const after = await historyRepository.read();
  const verified = calculateBalanceTimeline(opening, after);
  if (after.operations.length !== history.operations.length || verified.currentBalance !== timeline.currentBalance || after.operations.some(o => o.runningBalance !== verified.runningBalances.get(o.sourceId))) throw new Error("Repair verification failed.");
  for (const original of history.operations) {
    const updated = after.operations.find(o => o.sourceId === original.sourceId);
    if (JSON.stringify({ ...original, runningBalance: null }) !== JSON.stringify({ ...updated, runningBalance: null })) throw new Error("Original operation changed during repair.");
  }
  console.log(JSON.stringify({ verified: true, originalOperationsPreserved: true, currentBalance: verified.currentBalance, currency: opening.currency }));
}
