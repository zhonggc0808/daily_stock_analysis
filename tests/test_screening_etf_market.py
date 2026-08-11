from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from src.services.screening.daily import _fetch_daily_tencent, fetch_daily_history
from src.services.screening.models import Pick
from src.services.screening.pipeline import (
    _deduplicate_etf_themes,
    _preselect_by_theme,
    _select_theme_coverage_candidates,
)
from src.services.screening.pipeline import screen
from src.services.screening.config import Config
from src.services.screening.ranker import _build_ranking_prompt
from src.services.screening.snapshot_etf import (
    _fetch_tencent_etf_snapshot,
    _namespaced_path,
    _write_json_cache,
    classify_theme,
    fetch_etf_snapshot_with_fallback,
    qualify_etf_snapshot,
)


def _snapshot(*rows: tuple[str, str]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"code": code, "name": name, "price": 1.0, "amount": 100_000_000}
            for code, name in rows
        ]
    )


def test_authoritative_etf_universe_includes_domestic_and_excludes_cross_border():
    rows = (
        ("510300", "沪深300ETF"),
        ("159915", "创业板ETF"),
        ("512480", "半导体ETF"),
        ("562060", "标普中国A股红利ETF"),
        ("513100", "纳指ETF"),
        ("513130", "恒生科技ETF"),
        ("159941", "纳指ETF"),
        ("159010", "港股通科技ETF"),
        ("511990", "货币ETF"),
        ("511010", "国债ETF"),
        ("518880", "黄金ETF"),
    )
    exchange = {
        code: {"fund_type": "指数型-股票", "fund_size": 1_000_000}
        for code, _ in rows
    }
    types = {code: "指数型-股票" for code, _ in rows}
    with (
        patch(
            "src.services.screening.snapshot_etf._load_exchange_universe",
            return_value=(exchange, "exchange_live", []),
        ),
        patch(
            "src.services.screening.snapshot_etf._load_fund_types",
            return_value=(types, "fund_type_live", []),
        ),
    ):
        result = qualify_etf_snapshot(_snapshot(*rows))

    codes = set(result["code"])
    assert {"510300", "159915", "512480", "562060"} <= codes
    assert not ({"513100", "513130", "159941", "159010", "511990", "511010", "518880"} & codes)
    assert result.attrs["universe_mode"] == "authoritative"
    assert result.loc[result["code"] == "562060", "theme_key"].item() == "dividend"


def test_cold_start_uses_strict_positive_taxonomy_without_failing_batch():
    with (
        patch(
            "src.services.screening.snapshot_etf._load_exchange_universe",
            return_value=({}, "strict_taxonomy", ["offline"]),
        ),
        patch(
            "src.services.screening.snapshot_etf._load_fund_types",
            return_value=({}, "", ["offline"]),
        ),
    ):
        result = qualify_etf_snapshot(
            _snapshot(("512480", "半导体ETF"), ("560999", "未知主题ETF"))
        )

    assert result["code"].tolist() == ["512480"]
    assert result.attrs["universe_mode"] == "conservative_fallback"
    assert result.attrs["unclassified_count"] == 1


def test_exchange_qualification_survives_fund_type_outage_and_a500_is_distinct():
    exchange = {
        "560001": {"fund_type": "指数型-股票", "fund_size": 1_000_000},
        "563800": {"fund_type": "指数型-股票", "fund_size": 1_000_000},
    }
    with (
        patch(
            "src.services.screening.snapshot_etf._load_exchange_universe",
            return_value=(exchange, "exchange_cache", ["live list offline"]),
        ),
        patch(
            "src.services.screening.snapshot_etf._load_fund_types",
            return_value=({}, "", ["fund types offline"]),
        ),
    ):
        result = qualify_etf_snapshot(
            _snapshot(("560001", "中证全指ETF"), ("563800", "中证A500ETF"))
        )

    assert set(result["code"]) == {"560001", "563800"}
    assert classify_theme("中证A500ETF") == ("a500", "中证A500")
    assert result.attrs["universe_mode"] == "authoritative"


def test_theme_classifier_keeps_specific_300_exposures_distinct():
    assert classify_theme("创业板300ETF天弘") == ("chinext300", "创业板300")
    assert classify_theme("沪深300ETF") == ("csi300", "沪深300")
    assert classify_theme("沪深300价值ETF") == ("csi300_value", "沪深300价值")
    assert classify_theme("沪深300成长ETF") == ("csi300_growth", "沪深300成长")
    assert classify_theme("沪深300增强ETF") == ("csi300_enhanced", "沪深300增强")


def test_etf_daily_auto_excludes_baostock_and_routes_akshare(tmp_path: Path):
    hist = pd.DataFrame(
        {"日期": ["2026-01-01"], "开盘": [1], "收盘": [1], "最高": [1], "最低": [1], "成交量": [1]}
    )
    with (
        patch("src.services.screening.daily._has_tushare_token", return_value=False),
        patch("src.services.screening.daily._fetch_daily_tencent", side_effect=RuntimeError("down")),
        patch("src.services.screening.daily._fetch_daily_sina", side_effect=RuntimeError("down")),
        patch("src.services.screening.daily._fetch_daily_akshare", return_value=hist) as akshare,
        patch("src.services.screening.daily._fetch_daily_baostock") as baostock,
    ):
        result = fetch_daily_history(
            "510300", source="auto", retries=0, cache_dir=tmp_path, market="cn_etf"
        )

    assert result.attrs["daily_source"] == "akshare"
    assert result.attrs["daily_adjustment"] == "qfq"
    akshare.assert_called_once_with("510300", lookback_days=120, is_etf=True)
    baostock.assert_not_called()
    assert (tmp_path / "cn_etf").is_dir()


def test_etf_daily_auto_keeps_tushare_explicit_when_token_exists(tmp_path: Path):
    hist = pd.DataFrame(
        {"date": ["2026-01-01"], "open": [1], "close": [1], "high": [1], "low": [1], "volume": [1]}
    )
    with (
        patch("src.services.screening.daily._has_tushare_token", return_value=True),
        patch("src.services.screening.daily._fetch_daily_tencent", return_value=hist) as tencent,
        patch("src.services.screening.daily._fetch_daily_tushare") as tushare,
    ):
        result = fetch_daily_history(
            "510300", source="auto", retries=0, cache_dir=tmp_path, market="cn_etf"
        )

    assert result.attrs["daily_source"] == "tencent"
    tencent.assert_called_once()
    tushare.assert_not_called()


def test_tencent_daily_marks_plain_day_payload_unadjusted():
    response = MagicMock()
    response.json.return_value = {
        "code": 0,
        "data": {
            "sh510300": {
                "day": [["2026-01-01", "1", "1.1", "1.2", "0.9", "100"]]
            }
        },
    }
    with patch("src.services.screening.daily.requests.get", return_value=response):
        result = _fetch_daily_tencent("510300", lookback_days=30)

    assert result.attrs["daily_adjustment"] == "unadjusted_fallback"


def test_etf_snapshot_cache_path_isolated_from_cn(tmp_path: Path):
    stock_cache = tmp_path / "snapshot.last_good.json"
    etf_cache = _namespaced_path(stock_cache, "cn_etf")
    assert etf_cache == tmp_path / "snapshot.last_good_cn_etf.json"
    assert etf_cache != stock_cache


def _tencent_quote_line(symbol: str, code: str) -> str:
    fields = [""] * 88
    fields[1] = f"ETF-{code}"
    fields[2] = code
    fields[3] = "1.234"
    fields[6] = "123"
    fields[9] = "1.233"
    fields[19] = "1.234"
    fields[32] = "1.25"
    fields[35] = "1.234/123/15178.2"
    fields[37] = "2"
    return f'v_s_{symbol}="{"~".join(fields)}";'


def test_tencent_etf_snapshot_batches_and_normalizes_quote_fields():
    exchange = {
        f"5{index:05d}": {"fund_type": "指数型-股票"}
        for index in range(151)
    }
    session = MagicMock()

    def respond(url: str, **_kwargs):
        symbols = url.split("q=", 1)[1].split(",")
        response = MagicMock()
        response.content = "".join(
            _tencent_quote_line(symbol, symbol[2:]) for symbol in symbols
        ).encode("gbk")
        return response

    session.get.side_effect = respond
    with patch(
        "src.services.screening.snapshot_etf.requests.Session",
        return_value=session,
    ):
        result = _fetch_tencent_etf_snapshot(exchange)

    assert len(result) == 151
    assert session.get.call_count == 2
    assert result.iloc[0]["price"] == pytest.approx(1.234)
    assert result.iloc[0]["amount"] == pytest.approx(15178.2)
    assert result.iloc[0]["volume"] == pytest.approx(12300)
    assert result.iloc[0]["bid"] == pytest.approx(1.233)
    assert result.iloc[0]["ask"] == pytest.approx(1.234)
    assert result.attrs["batch_count"] == 2
    assert result.attrs["returned_code_count"] == 151
    session.close.assert_called_once()


def test_tencent_etf_snapshot_rejects_truncated_market_response():
    exchange = {
        "510300": {"fund_type": "指数型-股票"},
        "512480": {"fund_type": "指数型-股票"},
    }
    response = MagicMock()
    response.content = _tencent_quote_line("sh510300", "510300").encode("gbk")
    session = MagicMock()
    session.get.return_value = response
    with (
        patch(
            "src.services.screening.snapshot_etf.requests.Session",
            return_value=session,
        ),
        pytest.raises(RuntimeError, match="coverage too low"),
    ):
        _fetch_tencent_etf_snapshot(exchange)


def test_tencent_etf_snapshot_rejects_response_after_total_deadline():
    exchange = {"510300": {"fund_type": "指数型-股票"}}
    response = MagicMock()
    response.content = _tencent_quote_line("sh510300", "510300").encode("gbk")
    session = MagicMock()
    session.get.return_value = response
    with (
        patch(
            "src.services.screening.snapshot_etf.requests.Session",
            return_value=session,
        ),
        patch(
            "src.services.screening.snapshot_etf.time.monotonic",
            side_effect=[100.0, 100.0, 116.0],
        ),
        pytest.raises(TimeoutError, match="exceeded 15s total timeout"),
    ):
        _fetch_tencent_etf_snapshot(exchange)

    session.close.assert_called_once()


def test_etf_snapshot_prefers_tencent_when_exchange_codes_are_cached(tmp_path: Path):
    exchange = {
        "510300": {"fund_type": "指数型-股票", "fund_shares": 1_000_000}
    }
    _write_json_cache(tmp_path / "cn_etf_exchange_universe.json", exchange)
    with (
        patch(
            "src.services.screening.snapshot_etf._load_exchange_universe",
            return_value=(exchange, "exchange_cache", ["live list offline"]),
        ),
        patch(
            "src.services.screening.snapshot_etf._load_fund_types",
            return_value=({"510300": "指数型-股票"}, "fund_type_cache", []),
        ),
        patch(
            "src.services.screening.snapshot_etf._fetch_tencent_etf_snapshot",
            return_value=_snapshot(("510300", "沪深300ETF")),
        ) as tencent,
        patch("src.services.screening.snapshot_etf._fetch_sina_etf_snapshot") as sina,
    ):
        result = fetch_etf_snapshot_with_fallback(
            fallback_snapshot_path=tmp_path / "snapshot.last_good.json",
            universe_cache_dir=tmp_path,
        )

    assert result.attrs["snapshot_source"] == "tencent_etf"
    tencent.assert_called_once_with(exchange)
    sina.assert_not_called()


def test_etf_snapshot_falls_back_to_sina_and_keeps_tencent_error(tmp_path: Path):
    exchange = {
        "510300": {"fund_type": "指数型-股票", "fund_shares": 1_000_000}
    }
    _write_json_cache(tmp_path / "cn_etf_exchange_universe.json", exchange)
    with (
        patch(
            "src.services.screening.snapshot_etf._load_exchange_universe",
            return_value=(exchange, "exchange_cache", []),
        ),
        patch(
            "src.services.screening.snapshot_etf._load_fund_types",
            return_value=({"510300": "指数型-股票"}, "fund_type_cache", []),
        ),
        patch(
            "src.services.screening.snapshot_etf._fetch_tencent_etf_snapshot",
            side_effect=RuntimeError("coverage too low"),
        ) as tencent,
        patch(
            "src.services.screening.snapshot_etf._fetch_sina_etf_snapshot",
            return_value=_snapshot(("510300", "沪深300ETF")),
        ) as sina,
    ):
        result = fetch_etf_snapshot_with_fallback(
            fallback_snapshot_path=tmp_path / "snapshot.last_good.json",
            universe_cache_dir=tmp_path,
        )

    assert result.attrs["snapshot_source"] == "sina_etf"
    assert "tencent_etf: coverage too low" in result.attrs["source_errors"]
    tencent.assert_called_once_with(exchange)
    sina.assert_called_once()


def test_etf_snapshot_cold_start_uses_sina_to_enumerate_codes(tmp_path: Path):
    with (
        patch(
            "src.services.screening.snapshot_etf._load_exchange_universe",
            return_value=({}, "strict_taxonomy", ["offline"]),
        ),
        patch(
            "src.services.screening.snapshot_etf._load_fund_types",
            return_value=({}, "", ["offline"]),
        ),
        patch("src.services.screening.snapshot_etf._fetch_tencent_etf_snapshot") as tencent,
        patch(
            "src.services.screening.snapshot_etf._fetch_sina_etf_snapshot",
            return_value=_snapshot(("512480", "半导体ETF")),
        ) as sina,
    ):
        result = fetch_etf_snapshot_with_fallback(
            fallback_snapshot_path=tmp_path / "snapshot.last_good.json",
            universe_cache_dir=tmp_path,
        )

    assert result.attrs["snapshot_source"] == "sina_etf"
    assert result.attrs["universe_mode"] == "conservative_fallback"
    tencent.assert_not_called()
    sina.assert_called_once()


def test_tushare_etf_uses_fund_daily(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("TUSHARE_TOKEN", "TOKEN")
    pro = MagicMock()
    pro.fund_daily.return_value = pd.DataFrame(
        [{"trade_date": "20260101", "open": 1, "high": 1, "low": 1, "close": 1, "vol": 1, "amount": 1}]
    )
    module = MagicMock()
    module.pro_api.return_value = pro
    with patch.dict("sys.modules", {"tushare": module}):
        result = fetch_daily_history("159915", source="tushare", retries=0, market="cn_etf")
    pro.fund_daily.assert_called_once()
    pro.daily.assert_not_called()
    assert result.attrs["daily_adjustment"] == "unadjusted_fallback"


def test_theme_preselection_global_cap_and_hard_final_dedup():
    frame = pd.DataFrame(
        [
            {"code": f"{index:06d}", "theme_key": f"theme_{index // 4}", "screen_score": 100 - index}
            for index in range(100)
        ]
    )
    selected = _preselect_by_theme(frame, 3).head(60)
    assert len(selected) == 60
    assert selected.groupby("theme_key").size().max() == 3

    picks = [
        Pick(1, "510300", "沪深300ETF", 90, 90, asset_type="etf", theme_key="csi300", amount=10),
        Pick(2, "159919", "300ETF", 89, 89, asset_type="etf", theme_key="csi300", amount=20),
        Pick(3, "159915", "创业板ETF", 88, 88, asset_type="etf", theme_key="chinext", amount=10),
    ]
    deduplicated = _deduplicate_etf_themes(picks)
    assert [item.code for item in deduplicated] == ["510300", "159915"]


def test_theme_coverage_is_reserved_before_top_k_truncation():
    frame = pd.DataFrame(
        [
            {"code": "510300", "theme_key": "csi300", "screen_score": 100},
            {"code": "159919", "theme_key": "csi300", "screen_score": 99},
            {"code": "510310", "theme_key": "csi300", "screen_score": 98},
            {"code": "159915", "theme_key": "chinext", "screen_score": 97},
            {"code": "512480", "theme_key": "semiconductor", "screen_score": 96},
        ]
    )

    selected = _select_theme_coverage_candidates(
        frame,
        limit=3,
        required_themes=3,
    )

    assert selected["code"].tolist() == ["510300", "159915", "512480"]


def test_etf_prompt_is_evidence_bound_and_omits_stock_fundamentals():
    pick = Pick(
        1, "512480", "半导体ETF", 80, 80,
        asset_type="etf", theme_key="semiconductor", theme_name="半导体",
        amount=100_000_000, bid_ask_spread_bps=2.5,
    )
    prompt = _build_ranking_prompt([pick], "按趋势排序")
    assert "asset_type=etf" in prompt
    assert "PE=" not in prompt
    assert "PB=" not in prompt
    assert "DSA" not in prompt
    assert "公司基本面" in prompt and "不得推断" in prompt


def test_etf_pipeline_skips_dsa_and_market_context_boundaries():
    snapshot = pd.DataFrame([
        {"code": "510300", "name": "沪深300ETF", "price": 4.0, "change_pct": 1.0, "amount": 200_000_000, "theme_key": "csi300", "theme_name": "沪深300", "asset_type": "etf"},
        {"code": "159915", "name": "创业板ETF", "price": 2.0, "change_pct": 1.0, "amount": 180_000_000, "theme_key": "chinext", "theme_name": "创业板", "asset_type": "etf"},
        {"code": "512480", "name": "半导体ETF", "price": 1.2, "change_pct": 1.0, "amount": 160_000_000, "theme_key": "semiconductor", "theme_name": "半导体", "asset_type": "etf"},
    ])
    snapshot.attrs.update(
        snapshot_source="fixture", universe_source="exchange_cache",
        universe_mode="authoritative", unclassified_count=0, exclusion_counts={},
    )

    def enrich(frame: pd.DataFrame, **kwargs) -> pd.DataFrame:
        assert kwargs["market"] == "cn_etf"
        result = frame.copy()
        result["change_60d"] = 10.0
        result["ma_bullish"] = True
        result["price_above_ma20"] = True
        result["signal_score"] = 75.0
        result["macd_status"] = "bullish"
        result["rsi_status"] = "neutral"
        result.attrs["daily_success_count"] = len(result)
        return result

    config = Config(
        post_analyzers=[], risk_enabled=False, portfolio_diversity_enabled=False,
        daily_enrich_max_candidates=100,
    )
    with (
        patch("src.services.screening.pipeline.fetch_snapshot_with_fallback", return_value=snapshot),
        patch("src.services.screening.pipeline.enrich_daily_features", side_effect=enrich),
        patch("src.services.screening.pipeline.apply_dsa_provider_context") as dsa,
    ):
        result = screen("etf_trend", market="cn_etf", max_output=3, use_llm=False, config=config)

    assert len(result.picks) == 3
    assert result.universe_mode == "authoritative"
    assert all(pick.asset_type == "etf" for pick in result.picks)
    dsa.assert_not_called()


def test_api_normalization_keeps_additive_etf_fields_and_supported_market():
    from src.services.screening_service import _call_screening_status, _normalize_candidate

    candidate = _normalize_candidate(
        {
            "code": "512480", "name": "半导体ETF", "asset_type": "etf",
            "fund_type": "指数型-股票", "fund_size": 12_000_000_000,
            "theme_key": "semiconductor", "theme_name": "半导体",
            "bid_ask_spread_bps": 2.5, "universe_mode": "authoritative",
        },
        1,
    )
    assert candidate["asset_type"] == "etf"
    assert candidate["theme_name"] == "半导体"
    assert candidate["bid_ask_spread_bps"] == 2.5
    assert _call_screening_status()["supported_markets"] == ["cn", "cn_etf"]
