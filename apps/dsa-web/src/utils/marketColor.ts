export type MarketColorMode = 'cn' | 'international';

export const MARKET_COLOR_MODE_STORAGE_KEY = 'dsa-market-color-mode';

export function getStoredMarketColorMode(): MarketColorMode {
  if (typeof window === 'undefined') {
    return 'cn';
  }
  try {
    const saved = window.localStorage.getItem(MARKET_COLOR_MODE_STORAGE_KEY);
    if (saved === 'international' || saved === 'cn') {
      return saved;
    }
  } catch {
    // Ignore localStorage errors
  }
  return 'cn';
}

export function persistMarketColorMode(mode: MarketColorMode): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(MARKET_COLOR_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore localStorage errors
  }
}

export function applyMarketColorModeToDom(mode: MarketColorMode): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.setAttribute('data-market-color-mode', mode);
}
