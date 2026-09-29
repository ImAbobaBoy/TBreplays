# TBReplays: онлайн-скетч, backend v1

Патч накладывается **поверх backend v2 для реплеев**. В путях уже есть префикс `TBReplays/`.
Фронтенд этим патчем не изменяется. Его текущие запросы без входа будут получать HTTP 401.

## Что реализовано

- ASP.NET Core Identity: логин/пароль, стандартное хеширование паролей, cookie-сессия на 8 часов.
- При первой инициализации пустого хранилища создаётся `admin` с паролем `admin` и ролью `admin`.
- Самостоятельная регистрация даёт только роль `observer`. Вход после регистрации выполняется отдельно.
- Роли: `admin`, `editor`, `observer`. Администратор меняет роли и устанавливает новый пароль пользователю.
- Смена роли, смена/сброс пароля и выход отзывают **все** сессии соответствующего пользователя и закрывают его активные SignalR-соединения. Требуется повторный вход.
- Последнего администратора нельзя понизить. Новые пароли — от 8 до 128 символов; исключение только для начального `admin`.
- Логины: 3–32 символа, латинские буквы, цифры, `_`, `-`. Регистр не различается.
- После 5 неверных паролей вход блокируется на 15 минут. Администратор может снять блокировку сбросом пароля.
- Одна общая доска: карта и линии. Рисовать, исправлять/удалять любые линии, очищать и менять карту могут admin/editor. Observer только смотрит.
- Реплей, его время, пауза, скорость, камера и выделение **не передаются** через SignalR. Пользователь проигрывает свой реплей самостоятельно.
- Состояние пользователей и доски сохраняется атомарно на диск. Для этой версии нужен один процесс backend; второй процесс с той же папкой данных не запустится.
- Существующие чтения карт/реплеев требуют входа. Импорт карт, локальный импорт с диска сервера, перезагрузка XML и сохранение калибровки доступны только admin.
- Старые записи `/api/strategy-slides` требуют admin/editor. Они остаются отдельным legacy-хранилищем; для общего онлайн-скетча фронт должен использовать `/api/sketch` и `/hubs/sketch`.

## Запуск

Из родительской папки репозитория:

```sh
git apply --check --ignore-space-change TBReplays_backend_online_v1.patch
git apply --ignore-space-change TBReplays_backend_online_v1.patch
dotnet build TBReplays/TBReplays/TBReplays.csproj
dotnet run --project TBReplays/TBReplays/TBReplays.csproj
```

Сторонних NuGet-пакетов для Identity/SignalR не добавлено: используются компоненты ASP.NET Core.

Перед размещением на публичном адресе войдите как admin и замените известный начальный пароль через `/api/auth/change-password`.
Для публикации разместите frontend и `/api`, `/hubs` на одном HTTPS-домене (например, за reverse proxy).
Прокси должен пропускать WebSocket upgrade и передавать `X-Forwarded-Proto`/`X-Forwarded-For`.
Доверенные адреса прокси задаются в `Online:KnownProxies`; не доверяйте произвольным адресам.
В Production cookie имеет Secure; простой HTTP для браузерного входа предназначен только для Development.

Настройки `appsettings.Production.json` (замените домен и IP своими):

```json
{
  "AllowedHosts": "sketch.example.com",
  "Online": {
    "AllowedOrigins": ["https://sketch.example.com"],
    "KnownProxies": ["127.0.0.1"],
    "DataPath": "/var/lib/tbreplays/online"
  }
}
```

По умолчанию данные лежат в `TBReplays/Data/Online`: `users.json`, `sketch.json`, `keys/`.
Папка должна быть доступна на запись только сервису и не должна раздаваться как статические файлы.
Сохраните эту папку между деплоями, включая ключи cookie/Identity. Резервную копию делайте при остановленном процессе.
Повреждённое JSON-хранилище вызывает ошибку запуска; оно не заменяется пустым автоматически.
При перезапуске пароль admin не возвращается к `admin`.

## HTTP и CSRF

Все API, кроме `/api/auth/csrf`, `/api/auth/register`, `/api/auth/login`, требуют входа.
Ответы API не перенаправляют на HTML-страницу: 401 — нужен вход, 403 — недостаточно прав.
Используйте `credentials: 'include'`. Для POST/PUT/DELETE передавайте `X-CSRF-TOKEN`.
Токен получается через `GET /api/auth/csrf`; после входа/выхода получите новый токен, поскольку он связан с текущей сессией.
Отсутствующий/устаревший токен: 400 с `error: "csrf"`. Вход тоже защищён CSRF.
Ошибки модели/Identity возвращаются с 400; конфликт версии или попытка понизить последнего admin — 409.
Регистрация и вход ограничены 20 запросами в минуту с одного IP (429). За прокси настройте доверенные адреса.

| Метод | URL | Тело / ответ |
|---|---|---|
| GET | `/api/auth/csrf` | `{ token }` |
| POST | `/api/auth/register` | `{ login, password }` → `{ id, login, role: "observer" }` |
| POST | `/api/auth/login` | `{ login, password }` → `{ id, login, role }`, cookie |
| GET | `/api/auth/me` | `{ id, login, role }` |
| POST | `/api/auth/logout` | без тела → 204; выход со всех устройств |
| POST | `/api/auth/change-password` | `{ currentPassword, newPassword }` → 204 |
| GET | `/api/users` | admin; список `{ id, login, role }` |
| PUT | `/api/users/{id}/role` | admin; `{ role: "editor" }` → пользователь |
| POST | `/api/users/{id}/reset-password` | admin; `{ password: "новый пароль" }` → 204 |
| GET | `/api/sketch` | полное состояние доски |
| GET | `/api/sketch/users` | пользователи с активными SignalR-соединениями |
| POST | `/api/sketch/commands` | команда; результат как у SignalR `Apply` |

Пароль администратора, сбрасывающего чужой пароль, повторно не запрашивается: требуется действующая admin-сессия и CSRF-токен.
Токен восстановления создаётся/используется только сервером и клиенту не возвращается.

## SignalR: `/hubs/sketch`

Для frontend нужен `@microsoft/signalr`. Cookie используется автоматически при `withCredentials: true`.
Обработчики событий зарегистрируйте **до** `connection.start()`.
Вызовы: `GetState()`, `GetUsers()`, `Apply(command)`.
События: `SketchSnapshot(state)` при подключении, `SketchChanged(change)` для всех, включая автора; `UsersChanged(users)` при подключении/отключении.

Пример формы состояния:

```json
{
  "revision": 2,
  "mapId": "map-key",
  "mapRevision": 1,
  "strokes": [{
    "stroke": {
      "id": "line-uuid", "color": "#22c55e", "width": 2,
      "style": "solid", "arrowMode": "end",
      "points": [{ "x": 0, "y": 0, "z": 0 }, { "x": 10, "y": 0, "z": 10 }]
    },
    "revision": 2,
    "authorId": "user-id"
  }]
}
```

`stroke` совместим с текущим `DrawingStrokeModel`; в движок передаётся `state.strokes.map(x => x.stroke)`.
Начальная доска: `mapId: null`, `revision: 0`, `mapRevision: 0`, пустой список линий.
Сначала редактор должен выполнить `setMap`.

Команда:

```json
{
  "operationId": "6b583f3f-cd73-4b0d-8147-6e0bd9e0f53d",
  "kind": "upsert",
  "expectedRevision": 0,
  "mapRevision": 1,
  "stroke": {
    "id": "line-uuid", "color": "#22c55e", "width": 2,
    "style": "solid", "arrowMode": "none",
    "points": [{ "x": 0, "y": 0, "z": 0 }, { "x": 10, "y": 0, "z": 10 }]
  }
}
```

| kind | Полезная нагрузка | expectedRevision |
|---|---|---|
| `upsert` | `stroke` | 0 для новой линии, `StoredStroke.revision` для изменения |
| `remove` | `strokeId` | текущая версия удаляемой линии |
| `clear` | без stroke/strokeId/mapId | текущая версия всей доски |
| `setMap` | `mapId` | текущая версия всей доски; линии очищаются |

Каждая команда содержит новый UUID `operationId` и текущий `mapRevision`.
Для повторной отправки **той же** команды сохраните её `operationId`. Сервер хранит последние 256 подтверждённых операций, включая перезапуск.
Использование чужого/повторного ID с другим содержимым возвращает `operationIdConflict`.
После удаления линии её ID нельзя использовать заново до очистки/смены карты: создайте новый UUID линии.
Очистка и смена карты увеличивают `mapRevision`, поэтому запоздавшая линия не восстановит старый рисунок.
После выхода за окно 256 операций клиент сначала получает актуальный snapshot, а не повторяет старую очередь вслепую.

Результат: `{ applied, error, change }`.
`change`: `{ revision, mapRevision, operationId, kind, userId, stroke, strokeId, mapId }`.
При `applied: false` доска не меняется и событие не рассылается.
Основные ошибки: `unauthorized`, `forbidden`, `revisionConflict`, `mapConflict`, `operationIdConflict`, `notFound`, `mapRequired`, `invalidCommand`, `invalidStroke`, `invalidPoints`.
HTTP возвращает 401/403/409/404/400 соответственно; SignalR возвращает код в `error`.

Клиентская последовательность:

1. Вход → свежий CSRF → SignalR → `GetState()`.
2. Событие с `revision <= localRevision` игнорировать: это уже применённая операция/дубликат.
3. Событие с `revision == localRevision + 1` применить и обновить версии.
4. При пропуске версии, конфликте, reconnect получить `GetState()`. Во время получения буферизовать новые события и затем применить те, которые новее snapshot.
5. Не заменять локальное состояние более старым snapshot. Ответ `Apply` и событие автора имеют одну версию: применить один раз.
6. Периодически сверять `GetState()` (например, раз в 30 секунд), чтобы восстановиться даже после единичной неудачной рассылки.
7. После отзыва сессии остановить бесконечный reconnect, проверить `/api/auth/me`, показать вход. После смены роли требуется повторный вход.

Можно отправлять завершённые линии либо обновления рисуемой линии. Каждое обновление одной линии отправляйте после подтверждения предыдущего; она имеет собственную версию.
Локальный undo редактора должен превращаться в обычную серверную `remove`/`upsert` с актуальной версией. Полный старый snapshot отправлять нельзя.
В этой версии нет трансляции курсоров, отдельных комнат, совместного выбора реплея, управления чужой камерой, live-синхронизации ручных танков или распределённого backend.

Лимиты: 512 KiB на команду, до 4096 точек в линии, до 1000 линий / 100000 точек на доске, до 10000 удалённых ID до следующей очистки. Ширина `(0,100]`, координаты конечные в диапазоне ±100000, цвета `#RRGGBB`.

## Проверка

```sh
dotnet run --project TBReplays/TBReplays.OnlineTests/TBReplays.OnlineTests.csproj
```

Тест запускает отдельный временный сервер и временное хранилище, не меняет рабочие аккаунты.
Проверяются HTTP и два настоящих WebSocket-клиента: права, CSRF, события, конфликты, дубликаты,
сброс/смена пароля, отзыв сессий и сохранение состояния после перезапуска.

Основа реализации: [Identity storage providers](https://learn.microsoft.com/aspnet/core/security/authentication/identity-custom-storage-providers), [SignalR security](https://learn.microsoft.com/aspnet/core/signalr/security).
