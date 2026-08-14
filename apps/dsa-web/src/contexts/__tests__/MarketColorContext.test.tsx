import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  getStoredMarketColorMode,
  MARKET_COLOR_MODE_STORAGE_KEY,
} from '../../utils/marketColor';
import {
  MarketColorProvider,
  useMarketColorMode,
} from '../MarketColorContext';

describe('MarketColorContext', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-market-color-mode');
  });

  it('defaults to cn mode and sets DOM attribute', () => {
    const { result } = renderHook(() => useMarketColorMode(), {
      wrapper: ({ children }) => <MarketColorProvider>{children}</MarketColorProvider>,
    });

    expect(result.current.marketColorMode).toBe('cn');
    expect(document.documentElement.getAttribute('data-market-color-mode')).toBe('cn');
  });

  it('reads stored mode from localStorage', () => {
    localStorage.setItem(MARKET_COLOR_MODE_STORAGE_KEY, 'international');
    expect(getStoredMarketColorMode()).toBe('international');

    const { result } = renderHook(() => useMarketColorMode(), {
      wrapper: ({ children }) => <MarketColorProvider>{children}</MarketColorProvider>,
    });

    expect(result.current.marketColorMode).toBe('international');
    expect(document.documentElement.getAttribute('data-market-color-mode')).toBe('international');
  });

  it('switches market color mode and persists to localStorage', () => {
    const { result } = renderHook(() => useMarketColorMode(), {
      wrapper: ({ children }) => <MarketColorProvider>{children}</MarketColorProvider>,
    });

    act(() => {
      result.current.setMarketColorMode('international');
    });

    expect(result.current.marketColorMode).toBe('international');
    expect(localStorage.getItem(MARKET_COLOR_MODE_STORAGE_KEY)).toBe('international');
    expect(document.documentElement.getAttribute('data-market-color-mode')).toBe('international');

    act(() => {
      result.current.toggleMarketColorMode();
    });

    expect(result.current.marketColorMode).toBe('cn');
    expect(localStorage.getItem(MARKET_COLOR_MODE_STORAGE_KEY)).toBe('cn');
    expect(document.documentElement.getAttribute('data-market-color-mode')).toBe('cn');
  });

  it('provides semantic helper classes for price changes', () => {
    const { result } = renderHook(() => useMarketColorMode(), {
      wrapper: ({ children }) => <MarketColorProvider>{children}</MarketColorProvider>,
    });

    expect(result.current.getPriceColorClass(2.5)).toBe('text-price-up');
    expect(result.current.getPriceColorClass(-1.8)).toBe('text-price-down');
    expect(result.current.getPriceColorClass(0)).toBe('text-price-flat');
    expect(result.current.getPriceColorClass(null)).toBe('text-price-flat');

    expect(result.current.getPriceBgClass(2.5)).toBe('bg-price-up');
    expect(result.current.getPriceBgClass(-1.8)).toBe('bg-price-down');
    expect(result.current.getPriceBgClass(0)).toBe('bg-subtle');
  });

  it('provides safe fallback when used outside provider', () => {
    const { result } = renderHook(() => useMarketColorMode());
    expect(result.current.marketColorMode).toBe('cn');
    expect(result.current.getPriceColorClass(2.5)).toBe('text-price-up');
  });
});
