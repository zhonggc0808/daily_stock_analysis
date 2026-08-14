import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ReportToc, type ReportTocSection } from '../ReportToc';

const mockSections: ReportTocSection[] = [
  { id: 'sec-overview', label: '核心概览' },
  { id: 'sec-strategy', label: '策略点位' },
  { id: 'sec-news', label: '资讯催化' },
  { id: 'sec-diagnostics', label: '运行诊断' },
];

describe('ReportToc', () => {
  beforeEach(() => {
    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders desktop TOC with all section labels', () => {
    render(<ReportToc sections={mockSections} />);

    expect(screen.getByRole('navigation', { name: '报告目录导航' })).toHaveClass('lg:sticky', 'lg:top-20');
    expect(screen.getByText('报告目录')).toBeInTheDocument();
    expect(screen.getAllByText('核心概览').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('策略点位').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('资讯催化').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('运行诊断').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: '核心概览' })[0]).toHaveAttribute('aria-current', 'location');
  });

  it('toggles mobile dropdown on click', () => {
    render(<ReportToc sections={mockSections} />);

    const mobileToggle = screen.getByRole('button', { name: '切换报告目录' });
    expect(mobileToggle).toBeInTheDocument();

    fireEvent.click(mobileToggle);
    expect(mobileToggle).toHaveAttribute('aria-expanded', 'true');

    // Click again to close
    fireEvent.click(mobileToggle);
    expect(mobileToggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('calls scrollIntoView and onSelectSection when clicking a section item', () => {
    const onSelect = vi.fn();
    // Create target element in document
    const targetEl = document.createElement('div');
    targetEl.id = 'sec-strategy';
    document.body.appendChild(targetEl);

    render(<ReportToc sections={mockSections} onSelectSection={onSelect} />);

    const strategyButtons = screen.getAllByRole('button', { name: '策略点位' });
    fireEvent.click(strategyButtons[0]);

    expect(onSelect).toHaveBeenCalledWith('sec-strategy');
    expect(targetEl.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });

    document.body.removeChild(targetEl);
  });

  it('disables smooth scrolling when reduced motion is preferred', () => {
    const targetEl = document.createElement('div');
    targetEl.id = 'sec-news';
    document.body.appendChild(targetEl);
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });

    render(<ReportToc sections={mockSections} />);
    fireEvent.click(screen.getAllByRole('button', { name: '资讯催化' })[0]);

    expect(targetEl.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });

    window.matchMedia = originalMatchMedia;
    document.body.removeChild(targetEl);
  });
});
