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
        optional_columns = {"fundamental_type", "eps_unavailable_reason", "classification_source"}
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

    if mapping:
        return mapping

    payload = request_json(SEC_TICKERS_URL)
    if isinstance(payload, dict):
        for item in payload.values():
            if not isinstance(item, dict):
                continue
            ticker = normalize_symbol(str(item.get("ticker") or ""))
            cik = str(item.get("cik_str") or "").zfill(10)
            if ticker and cik:
                mapping[ticker] = cik
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


def run_once(args: argparse.Namespace) -> None:
    marked = mark_non_applicable_eps(args.mark_limit)
    classified = backfill_sec_classification(args.classification_limit, args.sec_delay_seconds)
    print(
        f"{utc_now_iso()} fundamental warm pass complete: marked {marked} EPS-not-applicable rows, "
        f"backfilled {classified} SEC classifications",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill US financial fundamentals metadata in Supabase.")
    parser.add_argument("--loop", action="store_true", help="Run continuously instead of one pass.")
    parser.add_argument("--sleep-seconds", type=float, default=float(os.environ.get("FUNDAMENTAL_WARM_SLEEP_SECONDS", "900")))
    parser.add_argument("--classification-limit", type=int, default=int(os.environ.get("FUNDAMENTAL_WARM_CLASSIFICATION_LIMIT", "800")))
    parser.add_argument("--mark-limit", type=int, default=int(os.environ.get("FUNDAMENTAL_WARM_MARK_LIMIT", "1200")))
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
