import type { ScreeningCandidate } from '../api/screening';
import type { UiLanguage } from '../i18n/uiText';

/**
 * Escapes a cell value for RFC 4180 compliant CSV export and prevents formula injection.
 * Formula injection prevention: if a cell starts with '=', '+', '-', '@', '\t', '\r',
 * it is prefixed with a single quote "'" to prevent spreadsheet applications from executing it as a macro/formula.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value == null) {
    return '';
  }

  let str = String(value);

  // Prevent CSV formula injection (DDE attacks in Excel/Sheets)
  if (/^[=+@\t\r]/.test(str) || (str.startsWith('-') && str.length > 1)) {
    str = `'${str}`;
  }

  // RFC 4180: If the string contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function generateScreeningCsv(
  candidates: ScreeningCandidate[],
  isEtfMarket = false,
  language: UiLanguage = 'zh'
): string {
  const headers = language === 'en'
    ? [
        'Rank',
        'Stock Code',
        'Stock Name',
        isEtfMarket ? 'Theme Sector' : 'Industry',
        'Latest Price',
        'Change (%)',
        'Total Score',
        'LLM Score',
        'Risk Level',
        'Signal',
        'Rationale',
      ]
    : [
        '排名',
        '股票代码',
        '股票名称',
        isEtfMarket ? '主题板块' : '所属行业',
        '最新价格',
        '涨跌幅(%)',
        '综合评分',
        'LLM评分',
        '风险等级',
        '操作信号',
        '核心理由',
      ];

  const rows = candidates.map((item) => {
    const changePctStr = item.changePct != null ? `${item.changePct}%` : '-';
    const signal = typeof item.signal === 'string' && item.signal.trim() ? item.signal : '-';
    const reason = item.reason || item.llmThesis || item.dsaAnalysisSummary || '-';

    return [
      sanitizeCsvCell(item.rank),
      sanitizeCsvCell(item.code),
      sanitizeCsvCell(item.name || '-'),
      sanitizeCsvCell(isEtfMarket ? item.themeName || '-' : item.industry || '-'),
      sanitizeCsvCell(item.price != null ? item.price : '-'),
      sanitizeCsvCell(changePctStr),
      sanitizeCsvCell(item.score != null ? item.score : '-'),
      sanitizeCsvCell(item.llmScore != null ? item.llmScore : '-'),
      sanitizeCsvCell(item.riskLevel || '-'),
      sanitizeCsvCell(signal),
      sanitizeCsvCell(reason),
    ].join(',');
  });

  // UTF-8 BOM (\uFEFF) ensures Excel correctly displays Chinese characters
  return `\uFEFF${[headers.map(sanitizeCsvCell).join(','), ...rows].join('\r\n')}`;
}

export function downloadScreeningCsv(
  candidates: ScreeningCandidate[],
  filename = `screening_results_${new Date().toISOString().slice(0, 10)}.csv`,
  isEtfMarket = false,
  language: UiLanguage = 'zh'
): void {
  const csvContent = generateScreeningCsv(candidates, isEtfMarket, language);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
