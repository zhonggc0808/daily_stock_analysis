# -*- coding: utf-8 -*-
# Derived from AlphaSift revision 9f522747caafd3c0b1ddb7e14d5cf44c8580b6cf.
# Licensed under Apache-2.0 and modified for daily_stock_analysis.
"""Central market capabilities for the screening pipeline."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ScreeningMarketProfile:
    market: str
    asset_type: str
    snapshot_kind: str = "stock"
    daily_market: str = "cn"
    daily_candidate_limit: int | None = None
    enrich_industry: bool = True
    collect_company_context: bool = True
    allow_dsa: bool = True
    allow_candidate_context: bool = True
    allow_portfolio_overlay: bool = True
    theme_preselect_limit: int | None = None
    hard_theme_dedup: bool = False


_PROFILES = {
    "cn": ScreeningMarketProfile(market="cn", asset_type="stock"),
    "us": ScreeningMarketProfile(
        market="us", asset_type="stock", daily_market="us"
    ),
    "cn_etf": ScreeningMarketProfile(
        market="cn_etf",
        asset_type="etf",
        snapshot_kind="etf",
        daily_market="cn_etf",
        daily_candidate_limit=60,
        enrich_industry=False,
        collect_company_context=False,
        allow_dsa=False,
        allow_candidate_context=False,
        allow_portfolio_overlay=False,
        theme_preselect_limit=3,
        hard_theme_dedup=True,
    ),
}


def get_market_profile(market: str) -> ScreeningMarketProfile:
    normalized = str(market or "cn").strip().lower()
    try:
        return _PROFILES[normalized]
    except KeyError as exc:
        raise ValueError(
            f"Unsupported market: {market!r} (supported: {', '.join(_PROFILES)})"
        ) from exc


def supported_screening_markets() -> list[str]:
    return list(_PROFILES)
