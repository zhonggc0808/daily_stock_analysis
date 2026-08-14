import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ScreeningResultsTable } from '../ScreeningResultsTable';
import * as screeningCsvModule from '../../../utils/screeningCsv';
import type { ScreeningCandidate } from '../../../api/screening';

const mockCandidates: ScreeningCandidate[] = Array.from({ length: 25 }, (_, i) => ({
  rank: i + 1,
  code: `60000${i}`,
  name: `测试股票${i + 1}`,
  industry: '科技',
  price: 10 + i,
  changePct: i % 2 === 0 ? 1.5 : -1.5,
  score: 90 - i,
  llmScore: 88 - i,
  riskLevel: 'low',
  signal: '看多',
  reason: `推荐理由 ${i + 1}`,
  dsaAnalysisSummary: { summary: '增强摘要' },
  dsaContext: { warnings: [] },
  dsaNews: [],
  dsaEvents: [],
})) as unknown as ScreeningCandidate[];

const mockProps = {
  formatNumber: (v: unknown) => (v != null ? String(v) : '-'),
  formatScore: (v: unknown) => (v != null ? String(v) : '-'),
  formatPercent: (v: unknown) => (v != null ? `${v}%` : '-'),
  formatAmount: (v: unknown) => (v != null ? `${v}万` : '-'),
  formatEnrichmentSummary: (v: unknown) => String(v),
  getRiskLabel: () => '低风险',
  getRiskClassName: () => 'bg-emerald-500/10 text-emerald-500',
  getRiskLabels: () => ['低估值'],
  getFactorEntries: () => [],
  getFactorLabel: (k: string) => k,
  hasLlmInsight: () => true,
  getCandidateReason: (item: ScreeningCandidate) => item.reason || '',
  getSignal: (item: ScreeningCandidate) => (item as unknown as { signal: string }).signal || '',
};

describe('ScreeningResultsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when candidates is empty', () => {
    render(<ScreeningResultsTable {...mockProps} candidates={[]} />);
    expect(screen.getByText('暂无符合条件的候选')).toBeInTheDocument();
  });

  it('renders first page of 20 items by default with range text', () => {
    render(<ScreeningResultsTable {...mockProps} candidates={mockCandidates} />);

    expect(screen.getByText('25 条候选')).toBeInTheDocument();
    expect(screen.getByText('显示 1 - 20 / 共 25 条')).toBeInTheDocument();
    expect(screen.getByText('测试股票1')).toBeInTheDocument();
    expect(screen.getByText('测试股票20')).toBeInTheDocument();
    expect(screen.queryByText('测试股票21')).not.toBeInTheDocument();
  });

  it('changes page size and updates pagination', () => {
    render(<ScreeningResultsTable {...mockProps} candidates={mockCandidates} />);

    const pageSizeSelect = screen.getByRole('combobox');
    fireEvent.change(pageSizeSelect, { target: { value: '50' } });

    expect(screen.getByText('显示 1 - 25 / 共 25 条')).toBeInTheDocument();
    expect(screen.getByText('测试股票21')).toBeInTheDocument();
    expect(screen.getByText('测试股票25')).toBeInTheDocument();
  });

  it('allows multi-selecting up to 5 candidates for comparison', () => {
    render(<ScreeningResultsTable {...mockProps} candidates={mockCandidates} />);

    const selectButtons = screen.getAllByRole('button', { name: /对比 测试股票/i });
    expect(selectButtons.length).toBe(20);

    // Select first 5 items
    for (let i = 0; i < 5; i++) {
      fireEvent.click(selectButtons[i]);
    }

    expect(screen.getByText('对比已选 (5/5)')).toBeInTheDocument();

    // 6th item button should be disabled because max 5 is reached
    expect(selectButtons[5]).toBeDisabled();

    // Deselect one item
    fireEvent.click(selectButtons[0]);
    expect(screen.getByText('对比已选 (4/5)')).toBeInTheDocument();
    expect(selectButtons[5]).not.toBeDisabled();
  });

  it('opens comparison drawer when clicking comparison button', () => {
    render(<ScreeningResultsTable {...mockProps} candidates={mockCandidates} />);

    const selectButtons = screen.getAllByRole('button', { name: /对比 测试股票/i });
    fireEvent.click(selectButtons[0]);
    fireEvent.click(selectButtons[1]);

    const compareBtn = screen.getByRole('button', { name: /对比已选 \(2\/5\)/i });
    fireEvent.click(compareBtn);

    expect(screen.getByText('选股候选横向对比')).toBeInTheDocument();
    expect(screen.getAllByText('测试股票1').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('测试股票2').length).toBeGreaterThanOrEqual(2);
  });

  it('clears selection when clicking clear button', () => {
    render(<ScreeningResultsTable {...mockProps} candidates={mockCandidates} />);

    const selectButtons = screen.getAllByRole('button', { name: /对比 测试股票/i });
    fireEvent.click(selectButtons[0]);
    expect(screen.getByText('对比已选 (1/5)')).toBeInTheDocument();

    const clearBtn = screen.getByRole('button', { name: '清空已选' });
    fireEvent.click(clearBtn);

    expect(screen.queryByText(/对比已选/i)).not.toBeInTheDocument();
  });

  it('triggers CSV download when clicking export button', () => {
    const downloadSpy = vi.spyOn(screeningCsvModule, 'downloadScreeningCsv').mockImplementation(() => {});
    render(<ScreeningResultsTable {...mockProps} candidates={mockCandidates} />);

    const exportBtn = screen.getByRole('button', { name: /导出 CSV/i });
    fireEvent.click(exportBtn);

    expect(downloadSpy).toHaveBeenCalledWith(mockCandidates, undefined, false, 'zh');
  });

  it('expands and collapses row details', () => {
    render(<ScreeningResultsTable {...mockProps} candidates={mockCandidates} />);

    // First candidate is expanded initially (may appear in both summary and thesis)
    expect(screen.getAllByText('推荐理由 1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('增强摘要')).toBeInTheDocument();

    const collapseButton = screen.getByRole('button', { name: '收起' });
    fireEvent.click(collapseButton);
    expect(screen.queryByText('推荐理由 1')).not.toBeInTheDocument();

    // Now expand candidate 2
    const expandButtons = screen.getAllByRole('button', { name: '展开查看' });
    fireEvent.click(expandButtons[1]); // Expand candidate 2
    expect(screen.getAllByText('推荐理由 2').length).toBeGreaterThanOrEqual(1);
  });

  it('resets selection and pagination when a new result set arrives', async () => {
    const { rerender } = render(
      <ScreeningResultsTable key="result-1" {...mockProps} candidates={mockCandidates} />
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    const selectButtons = screen.getAllByRole('button', { name: /对比 测试股票/i });
    selectButtons.slice(0, 5).forEach((button) => fireEvent.click(button));
    expect(screen.getByText('对比已选 (5/5)')).toBeInTheDocument();

    const nextCandidates = mockCandidates.slice(0, 3).map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      code: `00000${index}`,
      name: `新候选${index + 1}`,
    }));
    rerender(
      <ScreeningResultsTable key="result-2" {...mockProps} candidates={nextCandidates} />
    );

    await waitFor(() => {
      expect(screen.queryByText(/对比已选/)).not.toBeInTheDocument();
    });
    expect(screen.getByText('显示 1 - 3 / 共 3 条')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '对比 新候选1' })).not.toBeDisabled();
  });
});
