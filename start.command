#!/bin/bash
# «Осенний двор» на Mac: двойной щелчок по этому файлу.
# Поднимает локальный сервер (Safari не загружает игру напрямую из файла) и открывает игру.
# Адрес всегда один и тот же — http://localhost:8080 — потому что сохранение браузер хранит
# отдельно для каждого адреса: на другом порту игра началась бы заново.
# Чтобы остановить сервер, закройте окно Терминала.

PORT=8080
GAME_PATH="${GAME_PATH:-/}"          # start-fragment.command открывает /?fragment
URL="http://localhost:$PORT$GAME_PATH"
cd "$(dirname "$0")" || exit 1

pause_exit() { echo; read -r -p "Нажмите Enter, чтобы закрыть окно." _; exit 1; }

if ! command -v python3 >/dev/null 2>&1; then
  echo "Не найден python3 — он нужен для локального сервера."
  echo "Выполните в Терминале: xcode-select --install  (установятся инструменты разработчика), затем запустите снова."
  pause_exit
fi

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  # порт занят: если это уже запущенная игра — просто открываем её
  if curl -fs "http://127.0.0.1:$PORT/index.html" 2>/dev/null | grep -q "<title>Осенний двор</title>"; then
    echo "Игра уже запущена: открываю $URL"
    open -a Safari "$URL"
    exit 0
  fi
  echo "Порт $PORT занят другой программой:"
  lsof -nP -iTCP:$PORT -sTCP:LISTEN | sed -n '1,3p'
  echo
  echo "Порт не меняется автоматически: сохранение привязано к адресу http://localhost:$PORT."
  echo "Закройте эту программу (или завершите её в Мониторинге системы) и запустите start.command снова."
  pause_exit
fi

echo "Осенний двор: $URL"
echo "Фрагмент для проверки листьев: http://localhost:$PORT/?fragment"
echo "Закройте это окно, чтобы остановить сервер."
(sleep 1; open -a Safari "$URL") &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
