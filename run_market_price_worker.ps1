$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
python .\market_price_worker.py @args
