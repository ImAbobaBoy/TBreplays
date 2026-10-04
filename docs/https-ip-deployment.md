# HTTPS по IP и обновление сервера

Адрес сайта: `https://185.175.156.239/`. Домен не требуется. Используются доверенный сертификат Let's Encrypt для IP, Certbot 5.4+ и Caddy. Сертификат действует шесть дней; systemd-таймер проверяет продление дважды в сутки, deploy-hook обновляет файлы сертификата и перезагружает Caddy.

Источник: https://letsencrypt.org/2026/03/11/shorter-certs-certbot/ . Caddy: https://caddyserver.com/docs/caddyfile/directives/tls .

Скрипт подключает официальный стабильный APT-репозиторий Caddy вместе с его ключом подписи пакетов: https://caddyserver.com/docs/install#debian-ubuntu-raspbian . Это позволяет установить Caddy даже без компонента universe в репозиториях Ubuntu. Если прежняя версия остановилась с `Unable to locate package caddy`, достаточно выполнить `git pull --ff-only` и повторить запуск скрипта.

Перед запуском открыть входящие TCP 80 и 443 в панели провайдера / действующем firewall. Порт 80 нужен для ACME-проверок при каждом продлении. Бек слушает только 127.0.0.1:5000; Caddy обслуживает собранный фронт и проксирует `/api` и `/hubs` (включая WebSocket). Vite и tmux для сайта после установки не нужны. Производственное окружение сохраняет Secure-cookie; HTTPS определяется через доверенный локальный прокси.

Команды на Ubuntu-сервере от root:

```bash
cd /root/TBreplays
git pull --ff-only
bash deploy/deploy-ip-https.sh 185.175.156.239
```

Скрипт требует существующий `TBReplays/TBReplays/MapData/map_catalog.json` и существующий `users.json` в текущем `Online:DataPath`, чтобы не создать пустую учётную базу. Значение пути читается из серверных appsettings; при запуске со старым переопределением через переменную окружения указать его явно:

```bash
TBREPLAYS_ONLINE_DATA=/полный/путь/к/Online bash deploy/deploy-ip-https.sh 185.175.156.239
```

Скрипт устанавливает Caddy и Certbot, запрашивает сертификат с принятием условий Let's Encrypt без email, собирает проект, останавливает старые процессы этого проекта из каталогов бека/фронта и запускает systemd-сервис. Карты и реплеи остаются на месте. Перед переключением сохраняются учётные данные и текущий Caddyfile в защищённом `/var/backups/tbreplays/<дата>/`. Исходная рабочая директория бека сохраняется, поэтому прежние `Data/ParsedReplays`, `ClientGameData` и относительные настройки остаются доступными. Сборки лежат в `/opt/tbreplays/releases/<дата>` и `/srv/tbreplays/web`; новая сборка не перезаписывает DLL работающего бека.

Проверка:

```bash
systemctl status tbreplays caddy tbreplays-certbot.timer --no-pager
curl -I https://185.175.156.239/
curl -i https://185.175.156.239/api/auth/csrf
/opt/tbreplays-certbot/bin/certbot renew --dry-run
journalctl -u tbreplays -u caddy -n 80 --no-pager
```

Не использовать `curl -k`: нормальное соединение должно проходить проверку доверия сертификата. После обновления проверить вход, загрузку карты, WebSocket-синхронизацию двух пользователей, выстрелы в повторно загруженном реплее 26.10, таблички/PNG и ластик. На дату подготовки настройки подключение к серверу из среды агента завершалось таймаутом SSH; успешная установка и выдача сертификата ещё не подтверждены.
