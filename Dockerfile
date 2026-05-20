FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements-worker.txt .
RUN python -m pip install --upgrade pip && python -m pip install -r requirements-worker.txt

COPY market_price_worker.py .
COPY fundamental_warm_worker.py .

CMD ["python", "market_price_worker.py"]
