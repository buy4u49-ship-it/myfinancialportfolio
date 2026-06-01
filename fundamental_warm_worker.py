from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


FUNDAMENTALS_TABLE = "financial_fundamentals_cache"
SEC_TICKERS_EXCHANGE_URL = "https://www.sec.gov/files/company_tickers_exchange.json"
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_CIKS = {
    "FARM": "0000034563",
}
SEC_FACT_FIELDS: dict[str, list[str]] = {
    "revenue": [
        "Revenues",
        "Revenue",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "RevenueFromContractsWithCustomers",
        "SalesRevenueNet",
        "SalesRevenueGoodsNet",
        "SalesRevenueServicesNet",
        "SalesRevenueGoodsGross",
        "SalesRevenueServicesGross",
        "RevenueMineralSales",
        "RealEstateRevenueNet",
        "RentalIncome",
        "PassengerRevenue",
        "FreightRevenue",
        "OilAndGasRevenue",
        "HealthCareOrganizationRevenue",
        "OperatingLeasesIncomeStatementLeaseRevenue",
        "GrossInvestmentIncomeOperating",
        "InterestAndDividendIncomeOperating",
        "InterestIncomeOperating",
        "InterestIncomeExpenseOperatingNet",
        "InvestmentIncomeInterest",
        "InvestmentIncomeNet",
        "PremiumsEarnedNet",
    ],
    "operating_income": ["OperatingIncomeLoss", "OperatingProfitLoss"],
    "net_income": ["NetIncomeLoss", "ProfitLoss"],
    "total_assets": ["Assets"],
    "total_equity": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "Equity"],
    "depreciation": ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization"],
    "short_term_debt": ["ShortTermBorrowings", "ShortTermDebtCurrent"],
    "long_term_debt": ["LongTermDebtNoncurrent", "LongTermDebtAndFinanceLeaseObligationsNoncurrent"],
    "cash_short_investments": ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "CashAndCashEquivalentsAtCarryingValue", "ShortTermInvestments"],
}
SEC_EPS_FACT_FIELDS = [
    "EarningsPerShareDiluted",
    "EarningsPerShareBasic",
    "EarningsPerShareBasicAndDiluted",
    "IncomeLossFromContinuingOperationsPerDilutedShare",
    "IncomeLossFromContinuingOperationsPerBasicShare",
    "IncomeLossFromContinuingOperationsPerBasicAndDilutedShare",
]
SEC_EPS_UNITS = ["USD/shares", "USD/share", "USD / shares", "USD / share", "USD-per-shares", "USD-per-share"]
SEC_SHARE_FIELDS = [
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "WeightedAverageNumberOfSharesOutstandingDiluted",
    "WeightedAverageNumberOfShareOutstandingDiluted",
    "WeightedAverageNumberOfSharesOutstandingBasic",
    "WeightedAverageNumberOfShareOutstandingBasic",
    "WeightedAverageNumberOfSharesOutstandingBasicAndDiluted",
    "WeightedAverageNumberOfShareOutstandingBasicAndDiluted",
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_streamlit_secrets() -> dict[str, Any]:
    secrets_path = Path(".streamlit") / "secrets.toml"
    if not secrets_path.exists():
        return {}
    try:
        import tomllib
    except Exception:
        return {}
    try:
        return tomllib.loads(secrets_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def config_value(*names: str) -> str:
    for key in names:
        value = os.environ.get(key, "")
        if value:
            return value.strip()

    secrets = read_streamlit_secrets()
    for key in names:
        value = secrets.get(key, "")
        if value:
            return str(value).strip()

    supabase = secrets.get("supabase", {})
    if hasattr(supabase, "get"):
        for key in names:
            for candidate in {key, key.lower(), key.replace("SUPABASE_", "").lower()}:
                value = supabase.get(candidate, "")
                if value:
                    return str(value).strip()
    return ""


def supabase_config() -> tuple[str, str]:
    return (
        config_value("SUPABASE_URL").rstrip("/"),
        config_value("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY"),
    )


def sec_user_agent() -> str:
    return os.environ.get("SEC_USER_AGENT", "myfinancialportfolio/1.0 contact@example.com")


def request_json(url: str, headers: dict[str, str] | None = None, timeout: int = 20) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": sec_user_agent(),
            **(headers or {}),
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def supabase_request(method: str, path: str, payload: Any | None = None, timeout: int = 30) -> Any:
    url, key = supabase_config()
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")

    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=body,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase request failed ({exc.code}): {detail}") from exc


def supabase_select(table: str, params: dict[str, str], timeout: int = 30) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode(params, safe="(),.*")
    data = supabase_request("GET", f"{table}?{query}", timeout=timeout)
    return data if isinstance(data, list) else []


def supabase_upsert(table: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    try:
        supabase_request("POST", table, rows)
    except RuntimeError as exc:
        message = str(exc).lower()
        optional_columns = {"fundamental_type", "eps_unavailable_reason", "classification_source", "average_equity", "price_at_refresh"}
        if any(column in message for column in optional_columns):
            stripped = [{key: value for key, value in row.items() if key not in optional_columns} for row in rows]
            supabase_request("POST", table, stripped)
            return
        raise


def normalize_symbol(symbol: str) -> str:
    return str(symbol or "").strip().upper().replace(".", "-")


def text_for(*values: Any) -> str:
    return " ".join(str(value or "") for value in values).strip().lower()


def eps_unavailable_reason(row: dict[str, Any]) -> str:
    symbol = normalize_symbol(str(row.get("symbol") or ""))
    text = text_for(row.get("name"), row.get("sector"), row.get("industry"))
    sector = text_for(row.get("sector"))
    industry = text_for(row.get("industry"))

    if (
        sector == "etf"
        or "exchange traded fund" in industry
        or re.search(r"\b(etf|etn|exchange traded product|closed-end fund|mutual fund)\b", text)
    ):
        return "exchange_traded_product"
    if re.search(r"\b(warrant|warrants)\b", text) or re.search(r"-(WS|WT|W)$", symbol):
        return "warrant"
    if re.search(r"\b(right|rights)\b", text) or symbol.endswith("-R"):
        return "right"
    if re.search(r"\b(unit|units)\b", text) or symbol.endswith("-U"):
        return "unit"
    if re.search(r"\b(preferred|preference|depositary share|depositary shares)\b", text):
        return "preferred_security"
    if re.search(r"\b(notes due|senior notes|subordinated notes|debenture|bond)\b", text):
        return "debt_security"
    if re.search(r"\b(spac|blank check|acquisition corp\.?|acquisition corporation)\b", text):
        return "spac_or_blank_check"
    return ""


def non_operating_classification(reason: str, row: dict[str, Any]) -> tuple[str, str]:
    if reason == "exchange_traded_product":
        return "ETF", "Exchange Traded Fund"
    if reason == "preferred_security":
        return "Financial Services", "Preferred Security"
    if reason == "debt_security":
        return "Financial Services", "Debt Security"
    if reason == "spac_or_blank_check":
        return "Financial Services", "Special Purpose Acquisition Company"
    return (
        str(row.get("sector") or "Financial Services"),
        str(row.get("industry") or "Special Purpose Security"),
    )


def sec_industry_description(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalized_sec_unit(unit: str) -> str:
    return re.sub(r"/+", "/", re.sub(r"\s+", "", unit.lower()).replace("-per-", "/"))


def is_annual_sec_form(form: Any) -> bool:
    value = str(form or "")
    return value.startswith("10-K") or value.startswith("20-F") or value.startswith("40-F")


def is_annual_sec_fact_row(row: dict[str, Any]) -> bool:
    fp = str(row.get("fp") or "")
    return is_annual_sec_form(row.get("form")) and (not fp or fp == "FY")


def numeric_value(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and number not in (float("inf"), float("-inf")) else None


def sec_fact_rows_by_units(facts: dict[str, Any] | None, concept: str, units: list[str]) -> list[dict[str, Any]]:
    accepted = {normalized_sec_unit(unit) for unit in units}
    concept_unit_maps = []
    for taxonomy in (facts or {}).get("facts", {}).values():
        if isinstance(taxonomy, dict):
            concept_units = taxonomy.get(concept, {}).get("units", {})
            if isinstance(concept_units, dict):
                concept_unit_maps.append(concept_units)

    matching_rows: list[dict[str, Any]] = []
    for unit_map in concept_unit_maps:
        for unit, rows in unit_map.items():
            if normalized_sec_unit(str(unit)) in accepted and isinstance(rows, list):
                matching_rows.extend(row for row in rows if isinstance(row, dict))

    fallback_rows: list[dict[str, Any]] = []
    if not matching_rows and "usd" in accepted:
        for unit_map in concept_unit_maps:
            for unit, rows in unit_map.items():
                normalized = normalized_sec_unit(str(unit))
                if normalized and "/" not in normalized and "share" not in normalized and isinstance(rows, list):
                    fallback_rows.extend(row for row in rows if isinstance(row, dict))

    return sorted(
        [
            row
            for row in [*matching_rows, *fallback_rows]
            if is_annual_sec_fact_row(row) and numeric_value(row.get("val")) is not None and row.get("fy")
        ],
        key=lambda row: str(row.get("filed") or row.get("end") or ""),
        reverse=True,
    )


def sec_fact_rows(facts: dict[str, Any] | None, concept: str) -> list[dict[str, Any]]:
    return sec_fact_rows_by_units(facts, concept, ["USD"])


def sec_periods(facts: dict[str, Any] | None) -> list[int]:
    concepts = sorted({concept for concepts in SEC_FACT_FIELDS.values() for concept in concepts})
    years: dict[int, str] = {}
    for concept in concepts:
        for row in sec_fact_rows(facts, concept):
            try:
                fy = int(row.get("fy"))
            except (TypeError, ValueError):
                continue
            years.setdefault(fy, str(row.get("end") or row.get("filed") or ""))
    return sorted(years.keys(), reverse=True)[:4]


def sec_value_by_units(facts: dict[str, Any] | None, concepts: list[str], fiscal_year: int | None, units: list[str]) -> float | None:
    if not fiscal_year:
        return None
    for concept in concepts:
        for row in sec_fact_rows_by_units(facts, concept, units):
            if row.get("fy") == fiscal_year:
                value = numeric_value(row.get("val"))
                if value is not None:
                    return value
    return None


def sec_value(facts: dict[str, Any] | None, concepts: list[str], fiscal_year: int | None) -> float | None:
    return sec_value_by_units(facts, concepts, fiscal_year, ["USD"])


def sec_growth_pct(current: float | None, previous: float | None) -> float | None:
    if current is None or previous in (None, 0):
        return None
    return (current / previous - 1) * 100


def ratio_pct(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator * 100


def sec_share_value(facts: dict[str, Any] | None, fiscal_year: int | None) -> float | None:
    value = sec_value_by_units(facts, SEC_SHARE_FIELDS, fiscal_year, ["shares"])
    return value if value and value > 0 else None


def sec_eps_value(facts: dict[str, Any] | None, fiscal_year: int | None, net_income: float | None) -> float | None:
    reported = sec_value_by_units(facts, SEC_EPS_FACT_FIELDS, fiscal_year, SEC_EPS_UNITS)
    if reported not in (None, 0):
        return reported
    shares = sec_share_value(facts, fiscal_year)
    if net_income is not None and shares:
        return net_income / shares
    return None


def sec_sector_from_sic(sic: int | None, industry: str) -> str:
    text = industry.lower()
    if sic is None:
        if any(word in text for word in ("bank", "insurance", "broker", "investment")):
            return "Financial Services"
        if any(word in text for word in ("pharmaceutical", "medical", "health")):
            return "Healthcare"
        if any(word in text for word in ("software", "semiconductor", "computer")):
            return "Technology"
        return ""
    if 100 <= sic <= 999:
        return "Energy" if "oil" in text or "gas" in text else "Basic Materials"
    if 1000 <= sic <= 1499:
        return "Energy" if "oil" in text or "gas" in text else "Basic Materials"
    if 1500 <= sic <= 1799:
        return "Industrials"
    if 2000 <= sic <= 2099:
        return "Consumer Defensive"
    if 2100 <= sic <= 2199:
        return "Consumer Defensive"
    if 2200 <= sic <= 2399:
        return "Consumer Cyclical"
    if 2400 <= sic <= 2799:
        return "Basic Materials"
    if 2800 <= sic <= 2899:
        return "Healthcare" if any(word in text for word in ("pharmaceutical", "biological", "drug")) else "Basic Materials"
    if 2900 <= sic <= 2999:
        return "Energy"
    if 3000 <= sic <= 3569:
        return "Industrials"
    if 3570 <= sic <= 3699:
        return "Technology"
    if 3700 <= sic <= 3799:
        return "Industrials"
    if 3800 <= sic <= 3899:
        return "Healthcare"
    if 3900 <= sic <= 3999:
        return "Consumer Cyclical"
    if 4000 <= sic <= 4799:
        return "Industrials"
    if 4800 <= sic <= 4899:
        return "Communication Services"
    if 4900 <= sic <= 4999:
        return "Utilities"
    if 5000 <= sic <= 5199:
        return "Industrials"
    if 5200 <= sic <= 5999:
        return "Consumer Cyclical"
    if 6000 <= sic <= 6499:
        return "Financial Services"
    if 6500 <= sic <= 6799:
        return "Real Estate"
    if 7000 <= sic <= 7999:
        return "Technology" if "business services" in text or "prepackaged software" in text else "Consumer Cyclical"
    if 8000 <= sic <= 8099:
        return "Healthcare"
    if 8100 <= sic <= 8999:
        return "Industrials"
    return ""


def load_sec_cik_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    try:
        payload = request_json(SEC_TICKERS_EXCHANGE_URL)
        fields = payload.get("fields", []) if isinstance(payload, dict) else []
        data = payload.get("data", []) if isinstance(payload, dict) else []
        ticker_index = fields.index("ticker")
        cik_index = fields.index("cik")
        for row in data:
            ticker = normalize_symbol(str(row[ticker_index]))
            cik = str(row[cik_index]).zfill(10)
            mapping[ticker] = cik
    except Exception as exc:
        print(f"{utc_now_iso()} SEC exchange ticker map failed: {exc}", flush=True)

    try:
        payload = request_json(SEC_TICKERS_URL)
        if isinstance(payload, dict):
            for item in payload.values():
                if not isinstance(item, dict):
                    continue
                ticker = normalize_symbol(str(item.get("ticker") or ""))
                cik = str(item.get("cik_str") or "").zfill(10)
                if ticker and cik and ticker not in mapping:
                    mapping[ticker] = cik
    except Exception as exc:
        print(f"{utc_now_iso()} SEC company ticker map failed: {exc}", flush=True)

    for ticker, cik in SEC_CIKS.items():
        mapping.setdefault(ticker, cik)
    return mapping


def fetch_sec_submission_profile(cik: str) -> tuple[str, str] | None:
    payload = request_json(f"https://data.sec.gov/submissions/CIK{cik}.json")
    if not isinstance(payload, dict):
        return None
    industry = sec_industry_description(payload.get("sicDescription"))
    try:
        sic = int(str(payload.get("sic") or "").strip())
    except ValueError:
        sic = None
    sector = sec_sector_from_sic(sic, industry)
    if not sector and not industry:
        return None
    return sector, industry or sector


def fetch_sec_company_facts(cik: str) -> dict[str, Any] | None:
    payload = request_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", timeout=30)
    return payload if isinstance(payload, dict) else None


def missing_classification_rows(limit: int) -> list[dict[str, Any]]:
    return supabase_select(
        FUNDAMENTALS_TABLE,
        {
            "select": "symbol,market,name,sector,industry,source,eps,refreshed_at",
            "market": "eq.us",
            "or": "(sector.is.null,sector.eq.,sector.eq.Unclassified,industry.is.null,industry.eq.,industry.eq.Unclassified)",
            "limit": str(limit),
        },
    )


def eps_candidate_rows(limit: int) -> list[dict[str, Any]]:
    return supabase_select(
        FUNDAMENTALS_TABLE,
        {
            "select": "symbol,market,name,sector,industry,source,eps,refreshed_at",
            "market": "eq.us",
            "or": "(eps.is.null,eps.eq.0)",
            "limit": str(limit),
        },
    )


def statement_candidate_rows(limit: int) -> list[dict[str, Any]]:
    rows = supabase_select(
        FUNDAMENTALS_TABLE,
        {
            "select": "symbol,market,name,sector,industry,source,fundamental_type,eps_unavailable_reason,revenue,previous_revenue,revenue_growth_pct,operating_income,previous_operating_income,operating_income_growth_pct,net_income,previous_net_income,earnings_growth_pct,refreshed_at",
            "market": "eq.us",
            "or": "(revenue.is.null,previous_revenue.is.null,revenue_growth_pct.is.null,operating_income_growth_pct.is.null,earnings_growth_pct.is.null)",
            "order": "refreshed_at.asc.nullsfirst",
            "limit": str(limit),
        },
    )
    return [
        row
        for row in rows
        if row.get("fundamental_type") != "non_operating_security"
        and not row.get("eps_unavailable_reason")
        and not eps_unavailable_reason(row)
    ]


def mark_non_applicable_eps(limit: int) -> int:
    rows = eps_candidate_rows(limit)
    updates: list[dict[str, Any]] = []
    now = utc_now_iso()
    for row in rows:
        reason = eps_unavailable_reason(row)
        if not reason:
            continue
        sector, industry = non_operating_classification(reason, row)
        updates.append(
            {
                "symbol": normalize_symbol(str(row.get("symbol") or "")),
                "market": "us",
                "sector": sector,
                "industry": industry,
                "fundamental_type": "non_operating_security",
                "eps_unavailable_reason": reason,
                "updated_at": now,
            }
        )
    for index in range(0, len(updates), 100):
        supabase_upsert(FUNDAMENTALS_TABLE, updates[index : index + 100])
    return len(updates)


def backfill_sec_classification(limit: int, sec_delay_seconds: float) -> int:
    rows = missing_classification_rows(limit)
    if not rows:
        return 0
    cik_map = load_sec_cik_map()
    updates: list[dict[str, Any]] = []
    now = utc_now_iso()
    for row in rows:
        symbol = normalize_symbol(str(row.get("symbol") or ""))
        if not symbol:
            continue
        reason = eps_unavailable_reason(row)
        if reason:
            sector, industry = non_operating_classification(reason, row)
            updates.append(
                {
                    "symbol": symbol,
                    "market": "us",
                    "sector": sector,
                    "industry": industry,
                    "fundamental_type": "non_operating_security",
                    "eps_unavailable_reason": reason,
                    "classification_source": "security_type",
                    "updated_at": now,
                }
            )
            continue
        cik = cik_map.get(symbol)
        if not cik:
            continue
        try:
            profile = fetch_sec_submission_profile(cik)
        except Exception as exc:
            print(f"{utc_now_iso()} SEC profile failed for {symbol}: {exc}", flush=True)
            time.sleep(sec_delay_seconds)
            continue
        time.sleep(sec_delay_seconds)
        if not profile:
            continue
        sector, industry = profile
        updates.append(
            {
                "symbol": symbol,
                "market": "us",
                "sector": sector,
                "industry": industry,
                "fundamental_type": "operating_company",
                "classification_source": "sec_sic",
                "updated_at": now,
            }
        )
    for index in range(0, len(updates), 100):
        supabase_upsert(FUNDAMENTALS_TABLE, updates[index : index + 100])
    return len(updates)


def compact_row(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if value is not None}


def sec_statement_update(symbol: str, facts: dict[str, Any] | None) -> dict[str, Any] | None:
    periods = sec_periods(facts)
    if not periods:
        return None
    fiscal_year = periods[0]
    previous_fiscal_year = periods[1] if len(periods) > 1 else None
    revenue = sec_value(facts, SEC_FACT_FIELDS["revenue"], fiscal_year)
    previous_revenue = sec_value(facts, SEC_FACT_FIELDS["revenue"], previous_fiscal_year)
    operating_income = sec_value(facts, SEC_FACT_FIELDS["operating_income"], fiscal_year)
    previous_operating_income = sec_value(facts, SEC_FACT_FIELDS["operating_income"], previous_fiscal_year)
    net_income = sec_value(facts, SEC_FACT_FIELDS["net_income"], fiscal_year)
    previous_net_income = sec_value(facts, SEC_FACT_FIELDS["net_income"], previous_fiscal_year)
    assets = sec_value(facts, SEC_FACT_FIELDS["total_assets"], fiscal_year)
    previous_assets = sec_value(facts, SEC_FACT_FIELDS["total_assets"], previous_fiscal_year)
    equity = sec_value(facts, SEC_FACT_FIELDS["total_equity"], fiscal_year)
    previous_equity = sec_value(facts, SEC_FACT_FIELDS["total_equity"], previous_fiscal_year)
    average_assets = (assets + previous_assets) / 2 if assets is not None and previous_assets is not None else assets
    average_equity = (equity + previous_equity) / 2 if equity is not None and previous_equity is not None else equity
    depreciation = sec_value(facts, SEC_FACT_FIELDS["depreciation"], fiscal_year)
    short_term_debt = sec_value(facts, SEC_FACT_FIELDS["short_term_debt"], fiscal_year)
    long_term_debt = sec_value(facts, SEC_FACT_FIELDS["long_term_debt"], fiscal_year)
    total_debt = None
    if short_term_debt is not None or long_term_debt is not None:
        total_debt = (short_term_debt or 0) + (long_term_debt or 0)
    shares = sec_share_value(facts, fiscal_year)
    eps = sec_eps_value(facts, fiscal_year, net_income)
    now = utc_now_iso()
    row = {
        "symbol": symbol,
        "market": "us",
        "fiscal_year": fiscal_year,
        "eps": eps,
        "roe_pct": ratio_pct(net_income, average_equity),
        "roa_pct": ratio_pct(net_income, average_assets),
        "net_margin_pct": ratio_pct(net_income, revenue),
        "operating_margin_pct": ratio_pct(operating_income, revenue),
        "revenue_growth_pct": sec_growth_pct(revenue, previous_revenue),
        "operating_income_growth_pct": sec_growth_pct(operating_income, previous_operating_income),
        "earnings_growth_pct": sec_growth_pct(net_income, previous_net_income),
        "revenue": revenue,
        "previous_revenue": previous_revenue,
        "operating_income": operating_income,
        "previous_operating_income": previous_operating_income,
        "net_income": net_income,
        "previous_net_income": previous_net_income,
        "total_assets": assets,
        "average_assets": average_assets,
        "total_equity": equity,
        "average_equity": average_equity,
        "shares_outstanding": shares,
        "book_value_per_share": equity / shares if equity is not None and shares else None,
        "ebitda": (operating_income or 0) + (depreciation or 0) if operating_income is not None or depreciation is not None else None,
        "total_debt": total_debt,
        "cash_and_short_investments": sec_value(facts, SEC_FACT_FIELDS["cash_short_investments"], fiscal_year),
        "fundamental_type": "operating_company",
        "source": "sec_company_facts",
        "refreshed_at": now,
        "updated_at": now,
    }
    update = compact_row(row)
    return update if len(update) > 5 else None


def backfill_sec_statement_values(limit: int, sec_delay_seconds: float) -> int:
    rows = statement_candidate_rows(limit)
    if not rows:
        return 0
    cik_map = load_sec_cik_map()
    updates: list[dict[str, Any]] = []
    for row in rows:
        symbol = normalize_symbol(str(row.get("symbol") or ""))
        cik = cik_map.get(symbol)
        if not symbol or not cik:
            continue
        try:
            update = sec_statement_update(symbol, fetch_sec_company_facts(cik))
        except Exception as exc:
            print(f"{utc_now_iso()} SEC company facts failed for {symbol}: {exc}", flush=True)
            time.sleep(sec_delay_seconds)
            continue
        time.sleep(sec_delay_seconds)
        if update:
            updates.append(update)
    for index in range(0, len(updates), 50):
        supabase_upsert(FUNDAMENTALS_TABLE, updates[index : index + 50])
    return len(updates)


def run_once(args: argparse.Namespace) -> None:
    marked = mark_non_applicable_eps(args.mark_limit)
    classified = backfill_sec_classification(args.classification_limit, args.sec_delay_seconds)
    statements = backfill_sec_statement_values(args.statement_limit, args.sec_delay_seconds)
    print(
        f"{utc_now_iso()} fundamental warm pass complete: marked {marked} EPS-not-applicable rows, "
        f"backfilled {classified} SEC classifications, backfilled {statements} SEC statement rows",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill US financial fundamentals metadata in Supabase.")
    parser.add_argument("--loop", action="store_true", help="Run continuously instead of one pass.")
    parser.add_argument("--sleep-seconds", type=float, default=float(os.environ.get("FUNDAMENTAL_WARM_SLEEP_SECONDS", "900")))
    parser.add_argument("--classification-limit", type=int, default=int(os.environ.get("FUNDAMENTAL_WARM_CLASSIFICATION_LIMIT", "800")))
    parser.add_argument("--mark-limit", type=int, default=int(os.environ.get("FUNDAMENTAL_WARM_MARK_LIMIT", "1200")))
    parser.add_argument("--statement-limit", type=int, default=int(os.environ.get("FUNDAMENTAL_WARM_STATEMENT_LIMIT", "180")))
    parser.add_argument("--sec-delay-seconds", type=float, default=float(os.environ.get("SEC_REQUEST_DELAY_SECONDS", "0.12")))
    args = parser.parse_args()

    while True:
        try:
            run_once(args)
        except Exception as exc:
            print(f"{utc_now_iso()} fundamental warm pass failed: {exc}", flush=True)
        if not args.loop:
            return
        time.sleep(max(10.0, args.sleep_seconds))


if __name__ == "__main__":
    main()
