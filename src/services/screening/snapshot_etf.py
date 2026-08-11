# -*- coding: utf-8 -*-
# Derived from AlphaSift revision 9f522747caafd3c0b1ddb7e14d5cf44c8580b6cf.
# Licensed under Apache-2.0 and modified for daily_stock_analysis.
"""A-share equity-index ETF universe and snapshot adapter."""

from __future__ import annotations

from datetime import date, timedelta
from io import BytesIO
import hashlib
import json
import logging
from pathlib import Path
import time
from typing import Callable

import pandas as pd
import requests

logger = logging.getLogger(__name__)

_CACHE_VERSION = 1
_TENCENT_BATCH_SIZE = 150
_TENCENT_TOTAL_TIMEOUT_SECONDS = 15.0
_TENCENT_MIN_COVERAGE = 0.95
_EXCLUDED_EXPOSURE = (
    "港股通", "港股", "香港", "恒生", "沪港深", "纳斯达克", "纳指", "标普500",
    "日经", "德国", "法国", "沙特", "印度", "东南亚", "海外", "全球", "QDII",
)
_EXCLUDED_ASSET = (
    "货币", "现金", "债券", "国债", "信用债", "可转债", "黄金", "白银", "原油",
    "公司债", "地方债", "政金债", "城投债", "短融", "固收", "同业存单",
    "有色期货", "豆粕", "商品", "REIT",
)
_THEMES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("a500", "中证A500", ("中证A500", "A500")),
    ("csi500", "中证500", ("中证500", "500ETF")),
    ("csi1000", "中证1000", ("中证1000", "1000ETF")),
    ("csi2000", "中证2000", ("中证2000", "2000ETF")),
    ("chinext", "创业板", ("创业板", "创成长", "创业成长")),
    ("star50", "科创50", ("科创50", "科创板50")),
    ("star100", "科创100", ("科创100",)),
    ("a50", "A50", ("A50", "上证50", "中证A50")),
    ("dividend", "A股红利", ("A股红利", "红利低波", "红利ETF", "红利质量")),
    ("semiconductor", "半导体", ("半导体", "芯片", "集成电路")),
    ("medicine", "医药医疗", ("医药", "医疗", "创新药", "生物科技", "中药")),
    ("ai", "人工智能", ("人工智能", "AIETF", "机器人", "算力", "软件", "计算机")),
    ("consumer", "消费", ("消费", "食品饮料", "酒ETF", "家电")),
    ("finance", "金融", ("证券", "券商", "银行", "保险", "金融")),
    ("new_energy", "新能源", ("新能源", "光伏", "锂电", "电池", "储能", "风电")),
    ("defense", "国防军工", ("军工", "国防", "航空航天")),
    ("auto", "汽车", ("汽车", "智能车", "新能源车")),
    ("communications", "通信", ("通信", "5G", "光通信")),
    ("machinery", "高端制造", ("机械", "高端装备", "工业母机", "智能制造")),
    ("materials", "材料资源", ("有色金属", "稀土", "钢铁", "煤炭", "化工", "建材")),
    ("agriculture", "农业", ("农业", "养殖", "畜牧")),
    ("environment", "绿色环保", ("环保", "绿色电力", "碳中和")),
)


def classify_theme(name: object) -> tuple[str, str] | None:
    text = str(name or "").strip()
    if not text or _has_excluded_exposure(text) or any(word in text for word in _EXCLUDED_ASSET):
        return None
    normalized = "".join(text.split())
    if "创业板300" in normalized:
        return "chinext300", "创业板300"
    if "沪深300" in normalized:
        for suffix, key, label in (
            ("成长", "csi300_growth", "沪深300成长"),
            ("价值", "csi300_value", "沪深300价值"),
            ("增强", "csi300_enhanced", "沪深300增强"),
        ):
            if suffix in normalized:
                return key, label
        return "csi300", "沪深300"
    if normalized.upper().startswith("300ETF"):
        return "csi300", "沪深300"
    for key, label, aliases in _THEMES:
        if any(alias.lower() in text.lower() for alias in aliases):
            return key, label
    return None


def is_domestic_equity_etf(
    name: object,
    *,
    exchange_eligible: bool | None = None,
    fund_type: object = "",
) -> bool:
    text = str(name or "").strip()
    type_text = str(fund_type or "").strip()
    if not text or _has_excluded_exposure(text) or any(word in text for word in _EXCLUDED_ASSET):
        return False
    if type_text and type_text != "指数型-股票":
        return False
    if exchange_eligible is False:
        return False
    return exchange_eligible is True or classify_theme(text) is not None


def _has_excluded_exposure(text: str) -> bool:
    # "标普中国A股" is a domestic index despite the index-provider brand.
    normalized = text.replace(" ", "")
    if "标普" in normalized and "A股" in normalized and "标普500" not in normalized:
        return any(word in normalized for word in _EXCLUDED_EXPOSURE if word not in {"标普500"})
    return any(word.lower() in normalized.lower() for word in _EXCLUDED_EXPOSURE)


def _fallback_theme(name: str) -> tuple[str, str]:
    """Derive a stable exposure key without using the fund-manager suffix."""
    normalized = "".join(str(name).split())
    exposure = normalized.split("ETF", 1)[0].strip("-—_ ") or normalized
    digest = hashlib.sha256(exposure.encode("utf-8")).hexdigest()[:12]
    return f"exposure_{digest}", exposure


def fetch_etf_snapshot_with_fallback(
    *,
    required_columns: list[str] | None = None,
    fallback_snapshot_path: str | Path | None = None,
    fallback_max_age_hours: float | None = None,
    cache_ttl_seconds: float = 0.0,
    universe_cache_dir: str | Path | None = None,
) -> pd.DataFrame:
    cache_path = _namespaced_path(fallback_snapshot_path, "cn_etf")
    from src.services.screening.snapshot import _read_last_good_snapshot, _write_last_good_snapshot

    required = required_columns or []
    cached_exchange_rows = _read_json_cache(_exchange_universe_cache_path(universe_cache_dir))
    cached_sources = _etf_snapshot_sources(cached_exchange_rows)
    if cache_ttl_seconds > 0:
        cached = _read_last_good_snapshot(
            cache_path, required_columns=required, source_errors=[],
            max_age_hours=cache_ttl_seconds / 3600, fresh=True,
            requested_snapshot_sources=[item[0] for item in cached_sources],
        )
        if cached is not None:
            return cached

    exchange_universe = _load_exchange_universe(universe_cache_dir)
    sources = _etf_snapshot_sources(exchange_universe[0])
    errors: list[str] = []
    for source, fetcher in sources:
        try:
            snapshot = fetcher()
            qualified = qualify_etf_snapshot(
                snapshot,
                cache_dir=universe_cache_dir,
                exchange_universe=exchange_universe,
            )
            missing = [column for column in required if column not in qualified or qualified[column].dropna().empty]
            if qualified.empty or missing:
                raise RuntimeError(f"empty or missing columns: {','.join(missing)}")
            qualified.attrs["snapshot_source"] = source
            qualified.attrs["source_errors"] = [*errors, *qualified.attrs.get("source_errors", [])]
            qualified.attrs["fallback_used"] = False
            _write_last_good_snapshot(cache_path, qualified, source_priority=[item[0] for item in sources])
            return qualified
        except Exception as exc:  # noqa: BLE001 - continue through explicit fallback chain
            errors.append(f"{source}: {exc}")
    cached = _read_last_good_snapshot(
        cache_path, required_columns=required, source_errors=errors,
        max_age_hours=fallback_max_age_hours,
    )
    if cached is not None:
        return cached
    raise RuntimeError(f"All ETF snapshot sources failed: {'; '.join(errors)}")


def _etf_snapshot_sources(
    exchange_rows: dict[str, object],
) -> tuple[tuple[str, Callable[[], pd.DataFrame]], ...]:
    sources: list[tuple[str, Callable[[], pd.DataFrame]]] = []
    if exchange_rows:
        sources.append(
            (
                "tencent_etf",
                lambda rows=exchange_rows: _fetch_tencent_etf_snapshot(rows),
            )
        )
    sources.extend(
        (
            ("sina_etf", _fetch_sina_etf_snapshot),
            ("akshare_etf", _fetch_akshare_etf_snapshot),
        )
    )
    return tuple(sources)


def qualify_etf_snapshot(
    df: pd.DataFrame,
    *,
    cache_dir: str | Path | None = None,
    exchange_universe: tuple[dict[str, dict[str, object]], str, list[str]] | None = None,
) -> pd.DataFrame:
    input_attrs = dict(df.attrs)
    exchange_rows, exchange_mode, exchange_errors = (
        exchange_universe
        if exchange_universe is not None
        else _load_exchange_universe(cache_dir)
    )
    fund_types, type_mode, type_errors = _load_fund_types(cache_dir)
    eligible_codes = set(exchange_rows)
    authoritative = bool(eligible_codes)
    rows: list[dict[str, object]] = []
    excluded: dict[str, int] = {}
    unclassified = 0
    for _, raw in df.iterrows():
        code = _code(raw.get("code", raw.get("代码", "")))
        name = str(raw.get("name", raw.get("名称", ""))).strip()
        exchange_info = exchange_rows.get(code, {})
        fund_type = str(
            fund_types.get(code, "") or exchange_info.get("fund_type", "")
        )
        exchange_eligible = code in eligible_codes if authoritative else None
        strict_theme = classify_theme(name)
        if (
            not is_domestic_equity_etf(
                name, exchange_eligible=exchange_eligible, fund_type=fund_type
            )
            or (not authoritative and not fund_type and strict_theme is None)
        ):
            reason = _exclusion_reason(name, fund_type, exchange_eligible)
            excluded[reason] = excluded.get(reason, 0) + 1
            if reason == "unclassified":
                unclassified += 1
            continue
        theme = strict_theme
        if theme is None:
            theme = _fallback_theme(name)
        row = dict(raw)
        fund_shares = pd.to_numeric(exchange_info.get("fund_shares"), errors="coerce")
        price = pd.to_numeric(raw.get("price", raw.get("最新价")), errors="coerce")
        fund_size = (
            float(fund_shares * price)
            if pd.notna(fund_shares) and pd.notna(price) and fund_shares > 0 and price > 0
            else None
        )
        row.update({
            "code": code, "name": name, "asset_type": "etf",
            "fund_type": fund_type or str(exchange_info.get("fund_type", "股票指数ETF")),
            "fund_size": fund_size,
            "theme_key": theme[0], "theme_name": theme[1],
            "industry": theme[1],
            "universe_mode": "authoritative" if authoritative else "conservative_fallback",
        })
        rows.append(row)
    result = pd.DataFrame(rows)
    result.attrs.update(input_attrs)
    result.attrs["universe_source"] = "+".join(item for item in (exchange_mode, type_mode) if item)
    result.attrs["universe_mode"] = "authoritative" if authoritative else "conservative_fallback"
    result.attrs["unclassified_count"] = unclassified
    result.attrs["exclusion_counts"] = excluded
    result.attrs["source_errors"] = [*exchange_errors, *type_errors]
    return result


def _fetch_sina_etf_snapshot() -> pd.DataFrame:
    import akshare as ak
    raw = ak.fund_etf_category_sina(symbol="ETF基金")
    if raw is None or raw.empty:
        raise RuntimeError("Sina ETF snapshot returned empty data")
    result = pd.DataFrame({
        "code": raw["代码"].astype(str).str.extract(r"(\d{6})", expand=False),
        "name": raw["名称"], "price": raw["最新价"], "change_pct": raw["涨跌幅"],
        "amount": raw["成交额"], "volume": raw["成交量"],
        "bid": raw["买入"], "ask": raw["卖出"],
    })
    numeric = (pd.to_numeric(result["ask"], errors="coerce") + pd.to_numeric(result["bid"], errors="coerce")) / 2
    result["bid_ask_spread_bps"] = (
        (pd.to_numeric(result["ask"], errors="coerce") - pd.to_numeric(result["bid"], errors="coerce"))
        / numeric.where(numeric > 0) * 10000
    )
    return _ensure_stock_compatible_columns(result)


def _fetch_tencent_etf_snapshot(exchange_rows: dict[str, object]) -> pd.DataFrame:
    codes = sorted({_code(value) for value in exchange_rows if _code(value)})
    if not codes:
        raise RuntimeError("Tencent ETF snapshot requires a non-empty ETF code universe")

    deadline = time.monotonic() + _TENCENT_TOTAL_TIMEOUT_SECONDS
    records: dict[str, dict[str, object]] = {}
    batch_count = 0
    session = requests.Session()
    session.headers.update(
        {
            "Referer": "https://gu.qq.com/",
            "User-Agent": "Mozilla/5.0",
        }
    )
    try:
        for offset in range(0, len(codes), _TENCENT_BATCH_SIZE):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(
                    f"Tencent ETF snapshot exceeded {_TENCENT_TOTAL_TIMEOUT_SECONDS:.0f}s total timeout"
                )
            batch_codes = codes[offset:offset + _TENCENT_BATCH_SIZE]
            symbols = [_to_tencent_etf_symbol(code) for code in batch_codes]
            symbol_to_code = dict(zip(symbols, batch_codes))
            response = session.get(
                "https://qt.gtimg.cn/q=" + ",".join(symbols),
                timeout=(max(0.1, min(3.0, remaining)), max(0.1, min(5.0, remaining))),
            )
            response.raise_for_status()
            if time.monotonic() > deadline:
                raise TimeoutError(
                    f"Tencent ETF snapshot exceeded {_TENCENT_TOTAL_TIMEOUT_SECONDS:.0f}s total timeout"
                )
            batch_count += 1
            for line in response.content.decode("gbk", errors="replace").split(";"):
                if '="' not in line:
                    continue
                symbol = line.split("=", 1)[0].rsplit("_", 1)[-1]
                code = symbol_to_code.get(symbol)
                if code is None:
                    continue
                payload = line.split('"', 2)
                if len(payload) < 2:
                    continue
                fields = payload[1].split("~")
                if len(fields) < 53 or not fields[2]:
                    continue
                records[code] = {
                    "code": code,
                    "name": fields[1],
                    "price": _tencent_number(fields, 3),
                    "change_pct": _tencent_number(fields, 32),
                    "amount": _tencent_amount(fields),
                    "volume": _tencent_volume(fields),
                    "bid": _tencent_number(fields, 9),
                    "ask": _tencent_number(fields, 19),
                }
    finally:
        session.close()

    coverage = len(records) / len(codes)
    if coverage < _TENCENT_MIN_COVERAGE:
        raise RuntimeError(
            "Tencent ETF snapshot coverage too low: "
            f"returned={len(records)} requested={len(codes)} coverage={coverage:.1%}"
        )
    result = _ensure_stock_compatible_columns(pd.DataFrame(records.values()))
    result.attrs.update(
        {
            "requested_code_count": len(codes),
            "returned_code_count": len(records),
            "batch_count": batch_count,
        }
    )
    return result


def _to_tencent_etf_symbol(code: str) -> str:
    return f"sh{code}" if code.startswith("5") else f"sz{code}"


def _tencent_number(fields: list[str], index: int) -> float | None:
    if len(fields) <= index or not fields[index]:
        return None
    value = pd.to_numeric(fields[index], errors="coerce")
    return float(value) if pd.notna(value) else None


def _tencent_amount(fields: list[str]) -> float | None:
    if len(fields) > 35 and fields[35]:
        parts = fields[35].split("/")
        if len(parts) >= 3:
            value = pd.to_numeric(parts[2], errors="coerce")
            if pd.notna(value):
                return float(value)
    fallback = _tencent_number(fields, 37)
    return fallback * 10_000 if fallback is not None else None


def _tencent_volume(fields: list[str]) -> float | None:
    # Tencent's ETF quote payload reports field 6 in lots.
    volume_lots = _tencent_number(fields, 6)
    return volume_lots * 100 if volume_lots is not None else None


def _fetch_akshare_etf_snapshot() -> pd.DataFrame:
    import akshare as ak
    raw = ak.fund_etf_spot_em()
    if raw is None or raw.empty:
        raise RuntimeError("AkShare ETF snapshot returned empty data")
    mapping = {"代码": "code", "名称": "name", "最新价": "price", "涨跌幅": "change_pct", "成交额": "amount"}
    result = raw.rename(columns=mapping).copy()
    return _ensure_stock_compatible_columns(result)


def _ensure_stock_compatible_columns(df: pd.DataFrame) -> pd.DataFrame:
    result = df.copy()
    for column in ("price", "change_pct", "amount", "bid", "ask", "bid_ask_spread_bps"):
        if column in result:
            result[column] = pd.to_numeric(result[column], errors="coerce")
    for column in ("total_mv", "circ_mv", "pe_ratio", "pb_ratio", "volume_ratio", "turnover_rate"):
        if column not in result:
            result[column] = pd.NA
    return result


def _load_exchange_universe(cache_dir: str | Path | None) -> tuple[dict[str, dict[str, object]], str, list[str]]:
    cache = _exchange_universe_cache_path(cache_dir)
    errors: list[str] = []
    rows: dict[str, dict[str, object]] = {}
    try:
        import akshare as ak
        sse = pd.DataFrame()
        for offset in range(8):
            day = (date.today() - timedelta(days=offset)).strftime("%Y%m%d")
            try:
                sse = ak.fund_etf_scale_sse(date=day)
                if not sse.empty:
                    break
            except Exception:
                continue
        if sse.empty:
            raise RuntimeError("SSE ETF list returned empty data")
        for _, item in sse.iterrows():
            if str(item.get("ETF类型", "")).strip() in {"单市", "跨市"}:
                rows[_code(item.get("基金代码"))] = {"fund_type": "指数型-股票", "fund_shares": _number(item.get("基金份额"))}
        try:
            szse = ak.fund_etf_scale_szse()
        except (TypeError, ValueError):
            szse = _fetch_szse_etf_list_direct()
        if szse is None or szse.empty:
            raise RuntimeError("SZSE ETF list returned empty data")
        for _, item in szse.iterrows():
            if str(item.get("基金类别", "")).strip() == "ETF" and str(item.get("投资类别", "")).strip() == "股票基金":
                rows[_code(item.get("基金代码"))] = {"fund_type": "指数型-股票", "fund_shares": _number(item.get("基金份额"))}
        if rows:
            _write_json_cache(cache, rows)
            return rows, "exchange_live", errors
        raise RuntimeError("exchange ETF lists returned no eligible rows")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"exchange universe: {exc}")
        cached = _read_json_cache(cache)
        return cached, "exchange_cache" if cached else "strict_taxonomy", errors


def _exchange_universe_cache_path(cache_dir: str | Path | None) -> Path:
    return Path(cache_dir or ".cache/screening") / "cn_etf_exchange_universe.json"


def _fetch_szse_etf_list_direct() -> pd.DataFrame:
    response = requests.get(
        "https://fund.szse.cn/api/report/ShowReport",
        params={
            "SHOWTYPE": "xlsx", "CATALOGID": "1000_lf", "TABKEY": "tab1"
        },
        headers={
            "Referer": "https://fund.szse.cn/marketdata/fundslist/index.html",
            "User-Agent": "Mozilla/5.0",
        },
        timeout=20,
    )
    response.raise_for_status()
    frame = pd.read_excel(
        BytesIO(response.content), engine="openpyxl", dtype={"基金代码": str}
    )
    return frame.rename(columns={"当前规模(份)": "基金份额"})


def _load_fund_types(cache_dir: str | Path | None) -> tuple[dict[str, str], str, list[str]]:
    cache = Path(cache_dir or ".cache/screening") / "cn_etf_fund_types.json"
    try:
        import akshare as ak
        raw = ak.fund_name_em()
        code_col = next((c for c in raw.columns if "基金代码" in str(c)), raw.columns[0])
        type_col = next((c for c in raw.columns if "基金类型" in str(c)), raw.columns[-1])
        values = {_code(row[code_col]): str(row[type_col]) for _, row in raw.iterrows()}
        _write_json_cache(cache, values)
        return values, "fund_type_live", []
    except Exception as exc:  # noqa: BLE001
        cached = _read_json_cache(cache)
        return {str(k): str(v) for k, v in cached.items()}, "fund_type_cache" if cached else "", [f"fund types: {exc}"]


def _exclusion_reason(name: str, fund_type: str, exchange_eligible: bool | None) -> str:
    if _has_excluded_exposure(name) or any(word in fund_type for word in ("海外", "QDII")):
        return "cross_border"
    if any(word in name + fund_type for word in _EXCLUDED_ASSET):
        return "non_equity"
    if exchange_eligible is False:
        return "exchange_ineligible"
    return "unclassified"


def _code(value: object) -> str:
    text = str(value or "").strip()
    digits = "".join(char for char in text if char.isdigit())
    return digits.zfill(6)[-6:] if digits else text


def _number(value: object) -> float | None:
    parsed = pd.to_numeric(str(value).replace(",", ""), errors="coerce")
    return float(parsed) if pd.notna(parsed) else None


def _namespaced_path(path_like: str | Path | None, namespace: str) -> Path | None:
    if path_like is None:
        return None
    path = Path(path_like)
    return path.with_name(f"{path.stem}_{namespace}{path.suffix}")


def _write_json_cache(path: Path, data: dict[str, object]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": _CACHE_VERSION, "created_at": time.time(), "data": data}
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, default=str), encoding="utf-8")
        tmp.replace(path)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to cache ETF universe at %s: %s", path, exc)


def _read_json_cache(path: Path) -> dict[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("version") == _CACHE_VERSION and isinstance(payload.get("data"), dict):
            return payload["data"]
    except Exception:
        pass
    return {}
