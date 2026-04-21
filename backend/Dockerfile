FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY pyproject.toml README.md alembic.ini /app/
COPY alembic /app/alembic
COPY app /app/app
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e .[dev]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
