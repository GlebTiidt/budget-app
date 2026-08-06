const telegram = window.Telegram?.WebApp;
const monthInput = document.querySelector("#report-month");
const incomeTotal = document.querySelector("#income-total");
const expenseTotal = document.querySelector("#expense-total");
const netTotal = document.querySelector("#net-total");
const chartCanvas = document.querySelector("#money-chart");
const chartHeading = document.querySelector("#chart-heading");
const loadingState = document.querySelector("#loading-state");
const emptyState = document.querySelector("#empty-state");
const errorState = document.querySelector("#error-state");
const errorMessage = document.querySelector("#error-message");
const retryButton = document.querySelector("#retry-button");
const categoryList = document.querySelector("#category-list");
const chartButtons = [...document.querySelectorAll(".chart-type")];

let report = null;
let chart = null;
let chartType = "bar";

telegram?.ready();
telegram?.expand();
monthInput.value = currentMonth();

monthInput.addEventListener("change", () => loadReport());
retryButton.addEventListener("click", () => loadReport());
for (const button of chartButtons) {
  button.addEventListener("click", () => {
    chartType = button.dataset.chart;
    for (const item of chartButtons) {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    }
    renderChart();
  });
}

loadReport();

async function loadReport() {
  showLoading();
  try {
    if (!telegram?.initData) {
      throw new Error("Откройте диаграммы из меню Telegram-бота.");
    }
    const response = await fetch(
      `/api/reports?month=${encodeURIComponent(monthInput.value)}`,
      {
        headers: { "x-telegram-init-data": telegram.initData },
        cache: "no-store"
      }
    );
    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Telegram не подтвердил доступ. Закройте окно и откройте отчёт из меню бота ещё раз."
          : "Не удалось прочитать данные из Notion. Попробуйте немного позже."
      );
    }
    report = await response.json();
    renderSummary();
    renderCategories();
    renderChart();
    errorState.hidden = true;
  } catch (error) {
    report = null;
    chart?.destroy();
    chart = null;
    chartCanvas.classList.remove("is-ready");
    loadingState.hidden = true;
    emptyState.hidden = true;
    errorMessage.textContent = error instanceof Error ? error.message : "Попробуйте ещё раз.";
    errorState.hidden = false;
  }
}

function renderSummary() {
  incomeTotal.textContent = formatMoney(report.income);
  expenseTotal.textContent = formatMoney(report.expense);
  netTotal.textContent = formatMoney(report.net);
  netTotal.style.color = report.net < 0 ? "var(--expense)" : "var(--income)";
}

function renderChart() {
  if (!report) return;
  chart?.destroy();
  chart = null;
  chartCanvas.classList.remove("is-ready");
  loadingState.hidden = true;

  if (report.income === 0 && report.expense === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sharedOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: reducedMotion ? 0 : 850,
      easing: "easeOutQuart"
    },
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: {
        labels: { color: css("--muted"), usePointStyle: true, boxWidth: 8 }
      },
      tooltip: {
        backgroundColor: "#f3f5ef",
        titleColor: "#171a15",
        bodyColor: "#171a15",
        padding: 12,
        cornerRadius: 12,
        callbacks: {
          label(context) {
            const value = context.parsed?.y ?? context.parsed ?? 0;
            return ` ${context.dataset.label}: ${formatMoney(value)}`;
          }
        }
      }
    }
  };

  if (chartType === "doughnut") {
    chartHeading.textContent = "Соотношение за месяц";
    chart = new Chart(chartCanvas, {
      type: "doughnut",
      data: {
        labels: ["Доход", "Расход"],
        datasets: [{
          label: "Сумма",
          data: [report.income, report.expense],
          backgroundColor: [css("--income"), css("--expense")],
          borderColor: "rgba(0,0,0,0)",
          hoverOffset: 10,
          spacing: 4,
          borderRadius: 8
        }]
      },
      options: {
        ...sharedOptions,
        cutout: "68%",
        animation: {
          ...sharedOptions.animation,
          animateRotate: true,
          animateScale: true
        }
      }
    });
  } else {
    const line = chartType === "line";
    chartHeading.textContent = line ? "Динамика по дням" : "По дням";
    chart = new Chart(chartCanvas, {
      type: chartType,
      data: {
        labels: report.days.map((day) => day.label),
        datasets: [
          dataset("Доход", report.days.map((day) => day.income), css("--income"), line),
          dataset("Расход", report.days.map((day) => day.expense), css("--expense"), line)
        ]
      },
      options: {
        ...sharedOptions,
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: css("--muted"), maxTicksLimit: 12 }
          },
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: "rgba(236,242,226,0.07)" },
            ticks: {
              color: css("--muted"),
              callback(value) { return compactMoney(value); }
            }
          }
        }
      }
    });
  }

  requestAnimationFrame(() => chartCanvas.classList.add("is-ready"));
}

function renderCategories() {
  categoryList.replaceChildren();
  const categories = report.expenseCategories.slice(0, 6);
  if (categories.length === 0) {
    const empty = document.createElement("li");
    empty.className = "category-empty";
    empty.textContent = "Расходов с категориями пока нет.";
    categoryList.append(empty);
    return;
  }

  const maximum = categories[0].amount;
  for (const item of categories) {
    const row = document.createElement("li");
    row.className = "category-item";

    const name = document.createElement("span");
    name.textContent = item.category;
    const bar = document.createElement("span");
    bar.className = "category-bar";
    const fill = document.createElement("span");
    fill.style.setProperty("--category-width", `${Math.max(4, item.amount / maximum * 100)}%`);
    bar.append(fill);
    const amount = document.createElement("span");
    amount.className = "category-amount";
    amount.textContent = formatMoney(item.amount);
    row.append(name, bar, amount);
    categoryList.append(row);
  }
}

function dataset(label, data, color, line) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: line ? `${color}2b` : color,
    borderWidth: line ? 2.5 : 0,
    borderRadius: line ? 0 : 6,
    borderSkipped: false,
    tension: 0.35,
    pointRadius: line ? 2 : 0,
    pointHoverRadius: 5,
    fill: line
  };
}

function showLoading() {
  errorState.hidden = true;
  emptyState.hidden = true;
  loadingState.hidden = false;
  chartCanvas.classList.remove("is-ready");
}

function formatMoney(value) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: report?.currency ?? "EUR",
    maximumFractionDigits: 2
  }).format(value);
}

function compactMoney(value) {
  return new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}`;
}

function css(variable) {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}
