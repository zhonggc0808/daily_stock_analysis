import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  applyMarketColorModeToDom,
  getStoredMarketColorMode,
  persistMarketColorMode,
  type MarketColorMode,
} from '../utils/marketColor';

export type { MarketColorMode } from '../utils/marketColor';

export type MarketColorContextValue = {
  marketColorMode: MarketColorMode;
  setMarketColorMode: (mode: MarketColorMode) => void;
  toggleMarketColorMode: () => void;
  getPriceColorClass: (changePct: number | null | undefined) => string;
  getPriceBgClass: (changePct: number | null | undefined) => string;
};

const defaultFallbackValue: MarketColorContextValue = {
  marketColorMode: 'cn',
  setMarketColorMode: () => undefined,
  toggleMarketColorMode: () => undefined,
  getPriceColorClass: (changePct) => {
    if (changePct == null || Number.isNaN(Number(changePct)) || Number(changePct) === 0) {
      return 'text-price-flat';
    }
    return Number(changePct) > 0 ? 'text-price-up' : 'text-price-down';
  },
  getPriceBgClass: (changePct) => {
    if (changePct == null || Number.isNaN(Number(changePct)) || Number(changePct) === 0) {
      return 'bg-subtle';
    }
    return Number(changePct) > 0 ? 'bg-price-up' : 'bg-price-down';
  },
};

const MarketColorContext = createContext<MarketColorContextValue | null>(null);

export const MarketColorProvider: React.FC<{
  children: React.ReactNode;
  defaultMode?: MarketColorMode;
}> = ({ children, defaultMode }) => {
  const [marketColorMode, setMarketColorModeState] = useState<MarketColorMode>(() => {
    return defaultMode || getStoredMarketColorMode();
  });

  const setMarketColorMode = useCallback((mode: MarketColorMode) => {
    setMarketColorModeState(mode);
    persistMarketColorMode(mode);
    applyMarketColorModeToDom(mode);
  }, []);

  const toggleMarketColorMode = useCallback(() => {
    setMarketColorMode(marketColorMode === 'cn' ? 'international' : 'cn');
  }, [marketColorMode, setMarketColorMode]);

  useEffect(() => {
    applyMarketColorModeToDom(marketColorMode);
  }, [marketColorMode]);

  const getPriceColorClass = useCallback((changePct: number | null | undefined): string => {
    if (changePct == null || Number.isNaN(Number(changePct)) || Number(changePct) === 0) {
      return 'text-price-flat';
    }
    return Number(changePct) > 0 ? 'text-price-up' : 'text-price-down';
  }, []);

  const getPriceBgClass = useCallback((changePct: number | null | undefined): string => {
    if (changePct == null || Number.isNaN(Number(changePct)) || Number(changePct) === 0) {
      return 'bg-subtle';
    }
    return Number(changePct) > 0 ? 'bg-price-up' : 'bg-price-down';
  }, []);

  const value = useMemo<MarketColorContextValue>(
    () => ({
      marketColorMode,
      setMarketColorMode,
      toggleMarketColorMode,
      getPriceColorClass,
      getPriceBgClass,
    }),
    [marketColorMode, setMarketColorMode, toggleMarketColorMode, getPriceColorClass, getPriceBgClass]
  );

  return <MarketColorContext.Provider value={value}>{children}</MarketColorContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components -- useMarketColorMode is a hook, co-located for context access
export function useMarketColorMode(): MarketColorContextValue {
  return useContext(MarketColorContext) ?? defaultFallbackValue;
}
