FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

# Dependencies first — this layer is cached until requirements.txt changes.
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# App + migration assets (startup applies Alembic against the managed DB).
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

# Run as non-root (Cloud Run best practice); own /app so a default SQLite file is
# writable when no DATABASE_URL is set (prod overrides it to Cloud SQL Postgres).
RUN useradd -m -u 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8080
# Cloud Run injects $PORT; bind to it. One async worker — scale via instances.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
