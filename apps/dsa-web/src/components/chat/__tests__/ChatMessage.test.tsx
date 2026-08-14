import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatMessage } from '../ChatMessage';
import type { Message } from '../../../stores/agentChatStore';
import type { StockIndexItem } from '../../../types/stockIndex';

const mockStockIndex: StockIndexItem[] = [
  {
    canonicalCode: '600519.SH',
    displayCode: '600519',
    nameZh: '贵州茅台',
    market: 'CN',
    assetType: 'stock',
    active: true,
  },
  {
    canonicalCode: '300750.SZ',
    displayCode: '300750',
    nameZh: '宁德时代',
    market: 'CN',
    assetType: 'stock',
    active: true,
  },
];

describe('ChatMessage', () => {
  it('renders user message correctly', () => {
    const userMsg: Message = {
      id: 'm1',
      role: 'user',
      content: '请帮我分析一下贵州茅台',
    };

    render(<ChatMessage msg={userMsg} />);
    expect(screen.getByText('U')).toBeInTheDocument();
    expect(screen.getByText('请帮我分析一下贵州茅台')).toBeInTheDocument();
  });

  it('renders assistant message with skill badge and actions', () => {
    const assistantMsg: Message = {
      id: 'm2',
      role: 'assistant',
      content: '茅台当前处于多头趋势，支撑位看 1750。',
    };
    const onCopy = vi.fn();
    const onExport = vi.fn();

    render(
      <ChatMessage
        msg={assistantMsg}
        skillLabel="缠论分析"
        backendBadgeText="默认模型"
        onCopy={onCopy}
        onExport={onExport}
      />
    );

    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('缠论分析')).toBeInTheDocument();
    expect(screen.getByText('默认模型')).toBeInTheDocument();

    const copyBtn = screen.getByRole('button', { name: '复制' });
    fireEvent.click(copyBtn);
    expect(onCopy).toHaveBeenCalledWith('m2', assistantMsg.content);

    const exportBtn = screen.getByRole('button', { name: '导出此条消息为 Markdown' });
    fireEvent.click(exportBtn);
    expect(onExport).toHaveBeenCalledWith(assistantMsg);
  });

  it('detects stock codes in assistant message and renders actionable chips', () => {
    const assistantMsg: Message = {
      id: 'm3',
      role: 'assistant',
      content: '根据最新数据，600519 和 300750 均突破了前期高点。2024年的预期市盈率分别为 25x 和 20x。',
    };
    const onAnalyze = vi.fn();
    const onToggleWatchlist = vi.fn();
    const isStockInWatchlist = vi.fn((code: string) => code === '600519');

    render(
      <ChatMessage
        msg={assistantMsg}
        stockIndex={mockStockIndex}
        isStockInWatchlist={isStockInWatchlist}
        onAnalyzeStock={onAnalyze}
        onToggleWatchlist={onToggleWatchlist}
      />
    );

    // Should detect 600519 and 300750
    expect(screen.getByText('涉及标的：')).toBeInTheDocument();
    expect(screen.getByText(/贵州茅台/)).toBeInTheDocument();
    expect(screen.getAllByText(/600519/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/宁德时代/)).toBeInTheDocument();
    expect(screen.getAllByText(/300750/).length).toBeGreaterThanOrEqual(2);

    // Watchlist state
    expect(screen.getByText('已自选')).toBeInTheDocument();
    expect(screen.getByText('+自选')).toBeInTheDocument();

    // Click analyze button
    const analyzeBtn = screen.getByRole('button', { name: '进入分析 贵州茅台' });
    fireEvent.click(analyzeBtn);
    expect(onAnalyze).toHaveBeenCalledWith('600519');

    // Click toggle watchlist
    const watchlistBtn = screen.getByRole('button', { name: '加入自选 宁德时代' });
    fireEvent.click(watchlistBtn);
    expect(onToggleWatchlist).toHaveBeenCalledWith('300750');
  });

  it('ignores unknown codes and codes that only appear in Markdown code or link targets', () => {
    const assistantMsg: Message = {
      id: 'm4',
      role: 'assistant',
      content: '任务编号 123456，示例 `600519`，链接见 [行情](https://example.com/300750)。',
    };

    render(<ChatMessage msg={assistantMsg} stockIndex={mockStockIndex} onAnalyzeStock={vi.fn()} />);

    expect(screen.queryByText('涉及标的：')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /进入分析/ })).not.toBeInTheDocument();
  });
});
