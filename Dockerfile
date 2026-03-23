FROM python:3.12-slim

WORKDIR /site
COPY . .

CMD sh -c "python -m http.server ${PORT:-8000} --bind 0.0.0.0"