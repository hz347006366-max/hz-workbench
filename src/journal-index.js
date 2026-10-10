const MONTH_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function monthKey(date) {
  const match = String(date || '').match(MONTH_KEY);
  if (!match) return '';
  const [, year, month, day] = match;
  const value = new Date(Number(year), Number(month) - 1, Number(day));
  if (value.getFullYear() !== Number(year) || value.getMonth() !== Number(month) - 1 || value.getDate() !== Number(day)) return '';
  return `${year}-${month}`;
}

function buildJournalIndex(journals) {
  const itemsByMonth = new Map();
  for (const journal of journals || []) {
    const month = monthKey(journal?.date);
    if (!month) continue;
    const items = itemsByMonth.get(month) || [];
    items.push(journal);
    itemsByMonth.set(month, items);
  }

  for (const items of itemsByMonth.values()) {
    items.sort((a, b) => b.date.localeCompare(a.date) || a.file.path.localeCompare(b.file.path));
    items.splice(30);
  }

  const monthsByYear = new Map();
  for (const month of [...itemsByMonth.keys()].sort((a, b) => b.localeCompare(a))) {
    const year = month.slice(0, 4);
    const months = monthsByYear.get(year) || [];
    months.push(month.slice(5));
    monthsByYear.set(year, months);
  }
  const years = [...monthsByYear.keys()].sort((a, b) => b.localeCompare(a));
  return { years, monthsByYear, itemsByMonth };
}

function latestSelection(index) {
  const year = index?.years?.[0] || '';
  const month = index?.monthsByYear?.get(year)?.[0] || '';
  return { year, month };
}

function selectYear(index, year) {
  const month = index?.monthsByYear?.get(year)?.[0];
  return month ? { year, month } : latestSelection(index);
}

function selectMonth(index, year, month) {
  if (index?.itemsByMonth?.has(`${year}-${month}`)) return { year, month };
  return index?.monthsByYear?.has(year) ? selectYear(index, year) : latestSelection(index);
}

module.exports = { buildJournalIndex, latestSelection, selectYear, selectMonth };
