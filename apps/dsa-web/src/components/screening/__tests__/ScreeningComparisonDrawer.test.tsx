import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScreeningComparisonDrawer } from '../ScreeningComparisonDrawer';
import type { ScreeningCandidate } from '../../../api/screening';

const mockCandidates: ScreeningCandidate[] = [
  {
    rank: 1,
    code: '600519',
    name: '贵州茅台',
    industry: '白酒',
    price: 1800.5,
    changePct: 2.5,
    score: 95,
    llmScore: 92,
    riskLevel: 'low',
    signal: '看多',
    reason: '高端白酒龙头',
  } as unknown as ScreeningCandidate,
  {
    rank: 2,
    code: '000858',
    name: '五粮液',
    industry: '白酒',
    price: 150.2,
    changePct: -1.2,
    score: 88,
    llmScore: 86,
    riskLevel: 'medium',
    signal: '观望',
    reason: '次高端稳健',
  } as unknown as ScreeningCandidate,
];

describe('ScreeningComparisonDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ScreeningComparisonDrawer
        isOpen={false}
        onClose={vi.fn()}
        selectedCandidates={mockCandidates}
        onRemoveCandidate={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders empty message when no candidates selected', () => {
    render(
      <ScreeningComparisonDrawer
        isOpen={true}
        onClose={vi.fn()}
        selectedCandidates={[]}
        onRemoveCandidate={vi.fn()}
      />
    );
    expect(screen.getByText('暂未选择对比股票')).toBeInTheDocument();
  });

  it('renders candidate comparison metrics side by side', () => {
    render(
      <ScreeningComparisonDrawer
        isOpen={true}
        onClose={vi.fn()}
        selectedCandidates={mockCandidates}
        onRemoveCandidate={vi.fn()}
      />
    );

    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    expect(screen.getByText('600519')).toBeInTheDocument();
    expect(screen.getByText('五粮液')).toBeInTheDocument();
    expect(screen.getByText('000858')).toBeInTheDocument();
    expect(screen.getByText('1800.50')).toBeInTheDocument();
    expect(screen.getByText('+2.50%')).toBeInTheDocument();
    expect(screen.getByText('-1.20%')).toBeInTheDocument();
    expect(screen.getByText('95.0')).toBeInTheDocument();
    expect(screen.getByText('88.0')).toBeInTheDocument();
    expect(screen.getByText('低风险')).toBeInTheDocument();
    expect(screen.getByText('中风险')).toBeInTheDocument();
  });

  it('calls onRemoveCandidate when removing a stock from comparison', () => {
    const onRemoveCandidate = vi.fn();
    render(
      <ScreeningComparisonDrawer
        isOpen={true}
        onClose={vi.fn()}
        selectedCandidates={mockCandidates}
        onRemoveCandidate={onRemoveCandidate}
      />
    );

    const removeBtn = screen.getByLabelText('移出 贵州茅台');
    fireEvent.click(removeBtn);
    expect(onRemoveCandidate).toHaveBeenCalledWith('600519');
  });

  it('triggers onAnalyzeCandidate and closes drawer when clicking action', () => {
    const onAnalyzeCandidate = vi.fn();
    const onClose = vi.fn();
    render(
      <ScreeningComparisonDrawer
        isOpen={true}
        onClose={onClose}
        selectedCandidates={mockCandidates}
        onRemoveCandidate={vi.fn()}
        onAnalyzeCandidate={onAnalyzeCandidate}
      />
    );

    const analyzeButtons = screen.getAllByRole('button', { name: /进入分析/i });
    expect(analyzeButtons.length).toBe(2);
    fireEvent.click(analyzeButtons[0]);

    expect(onAnalyzeCandidate).toHaveBeenCalledWith(mockCandidates[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
