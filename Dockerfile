FROM python:3.12-slim

WORKDIR /site
COPY . .

ENV PYTHONUNBUFFERED=1

CMD ["sh", "-c", "echo \"Listening on 0.0.0.0:${PORT:-8000}\"; exec python -u -m http.server ${PORT:-8000} --bind 0.0.0.0"]
