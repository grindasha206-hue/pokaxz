#!/bin/bash
# Запуск «Осеннего двора» на Mac: двойной щелчок по этому файлу.
# Поднимает локальный сервер (Safari не загружает игру напрямую из файла)
# и открывает фрагмент с листьями. Закройте окно Терминала, чтобы остановить.
cd "$(dirname "$0")" || exit 1
PORT=8080
while lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done
echo "Осенний двор: http://localhost:$PORT/?fragment  (двор: http://localhost:$PORT/)"
(sleep 1; open -a Safari "http://localhost:$PORT/?fragment") &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
