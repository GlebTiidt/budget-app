export type CategoryTotal = {
  category: string;
  amountEur: number;
};

export type ChartImageRenderer = {
  renderCategoryExpenses(totals: CategoryTotal[], title: string): Promise<Uint8Array>;
};

export function createQuickChartRenderer(
  baseUrl = "https://quickchart.io/chart",
  fetchImpl: typeof fetch = fetch
): ChartImageRenderer {
  return {
    async renderCategoryExpenses(totals, title) {
      const normalized = normalizeTotals(totals);
      if (normalized.length === 0) {
        throw new Error("There are no positive category totals to chart.");
      }

      const response = await fetchImpl(baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          width: 720,
          height: 480,
          format: "png",
          backgroundColor: "white",
          chart: buildCategoryExpensesChart(normalized, title)
        })
      });

      if (!response.ok) {
        throw new Error(`QuickChart failed with HTTP ${response.status}.`);
      }

      return new Uint8Array(await response.arrayBuffer());
    }
  };
}

export function buildCategoryExpensesChart(totals: CategoryTotal[], title: string) {
  const normalized = normalizeTotals(totals);

  return {
    type: "doughnut",
    data: {
      labels: normalized.map((item) => item.category),
      datasets: [
        {
          label: "EUR",
          data: normalized.map((item) => roundCurrency(item.amountEur)),
          backgroundColor: [
            "#2563EB",
            "#14B8A6",
            "#F59E0B",
            "#EF4444",
            "#8B5CF6",
            "#EC4899",
            "#64748B",
            "#84CC16"
          ]
        }
      ]
    },
    options: {
      plugins: {
        title: { display: true, text: title },
        legend: { position: "right" }
      }
    }
  };
}

function normalizeTotals(totals: CategoryTotal[]): CategoryTotal[] {
  return totals
    .filter((item) => Number.isFinite(item.amountEur) && item.amountEur > 0)
    .map((item) => ({
      category: item.category.trim() || "Без категории",
      amountEur: item.amountEur
    }))
    .sort((a, b) => b.amountEur - a.amountEur);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
