# Пакетный импорт карт

Пакетный импорт и каталог карт. Инструкция для сервера: [map-deployment.md](map-deployment.md). Активный фронт: TBreplaysF-design-integrated/TBreplaysF/TBreplaysF/TBReplays.Web.

## Доставка на сервер

Код доставляется через Git. Maps_game доставляется отдельно (SFTP/rsync/архивом) в постоянный каталог вне checkout, например /srv/tbreplays/maps-game. Сохранить исходную структуру: 07_fort_ft/07_fort_ft.sc2.dvpl, matching SCG, landscape, objects, а также 00_shared_content и 00_global_content. Вложенные игровые ресурсы не нужно перепаковывать в отдельные ZIP.

Настройки ASP.NET Core:

```text
MapImport__SourceDirectory=/srv/tbreplays/maps-game
MapImport__DataDirectory=/srv/tbreplays/map-data
MapImport__MaxParallelMaps=1
MapImport__RetainedRevisions=1
MapImport__MinimumFreeSpaceGiB=2
MapImport__LocalizationPath=/srv/tbreplays/client-data/Strings/ru.yaml.dvpl
```

SourceDirectory по умолчанию Maps_game относительно ContentRoot бека. LocalizationPath необязателен: локально выбирается ru.yaml.dvpl из ClientGameData. Без локализации displayName совпадает с именем сцены. Для русских названий и полных replay aliases передать локализацию вместе с картами. MapImport.DataDirectory задаёт независимый от checkout каталог результатов карт. В игнорируемом локальном appsettings.Local.json он установлен в D:\TBReplaysData\Maps. В production по умолчанию Data относительно ContentRoot; обязательно настроить постоянный writable volume через MapImport__DataDirectory. Остальная Data (Online, replay и стратегии) этим параметром не переносится. Каталог результатов должен быть постоянным writable volume и сохраняться между деплоями. Не заменять содержимое Maps_game во время выполняющегося импорта.

## API

Все запросы требуют действующую сессию. POST также требует штатный X-CSRF-TOKEN.

1. Администратор вызывает POST /api/maps/import-all. Ответ 202 содержит jobId и Location. Импорт выполняется в фоне; HTTP-соединение не держится до завершения. Повторный одновременный запуск даёт 409.
2. GET /api/maps/import-jobs/{jobId} возвращает queued/running/completed/completed-with-errors/failed/cancelled, total и индивидуальные результаты imported/unchanged/failed с диагностикой.
3. POST /api/maps/import-all?force=true принудительно переимпортирует весь каталог. Обычный запуск пропускает неизменённые карты по SHA-256 исходников, общих ресурсов, локализации и версии pipeline.
4. GET /api/maps возвращает name, displayName, replayMapNames, revision, sourceHash, pipelineVersion, importedAtUtc и warnings. Фронт загружает этот каталог после авторизации; локальный список WorkspaceModels.ts удалён. Кнопка «Обновить список карт» перечитывает каталог после импорта.
5. Артефакты доступны по /api/maps/07_fort_ft/manifest, /calibration, /object-mesh/manifest, /terrain/texture/manifest, /surface и URL из соответствующих manifests. Старые HTTP endpoints /import и /import-local удалены.

name — стабильное имя игровой сцены, например 07_fort_ft. Русское название «Форт» используется для отображения, а не для файловых путей. Случайного суффикса в выборе карты больше нет. Старые ссылки вида 07_fort_ft-1234abcd перенаправляются внутри сервиса чтения на опубликованную каноническую карту.

## Данные и ошибки

Результаты записываются в Data/Processed/{name}/revisions/{revision}; каталог — Data/map_catalog.json; состояния заданий — Data/ImportJobs. Новая карта попадает в каталог только после успешной генерации всех обязательных артефактов. Ошибка одной карты не останавливает остальные и не заменяет её предыдущую опубликованную версию. Отмена удаляет только staging текущего импорта. После успешной публикации сохраняется RetainedRevisions ревизий (по умолчанию одна). Предыдущая активная ревизия сохраняется до успешного завершения новой. Неудачный импорт её не удаляет. Очистка затрагивает только каталоги новых ревизий с ожидаемыми именами и manifest; старые legacy-каталоги с UUID автоматически не удаляются. На целевом диске проверяется резерв MinimumFreeSpaceGiB перед запуском, перед каждой изменившейся картой и записью текстур. Ошибка записи отчёта логируется и не останавливает HTTP-сервер.

Предыдущие ручные калибровки сохраняются в previous_calibrations.json новой ревизии. Они не применяются автоматически: высота вычисляется из Landscape.bbox (raw/65535 * диапазон + minZ), горизонтальные координаты — из bbox и шага исходной heightmap. Это исключает повторное применение старых компенсаций.

DVPL проверяет CRC32. SCG поддерживает UInt16/UInt32 indices, проверяет диапазоны и triangle-list. Экспорт выбирает один LOD и активные состояния, наследует материалы, экспортирует исходные UV и нормали. Отсутствующие/NaN-нормали восстанавливаются по геометрии с предупреждением. DDS используется напрямую, PVR v3 RGBA8888/RGBA4444/RGB565 конвертируется в DDS. Текстура поверхности выбирается по Landscape.colorTexture, а не по похожему имени файла.

## Ограничения визуализации

Профиль surface_manifest сейчас legacy-color: точная исходная colorTexture и описание остальных texture slots/properties. Фронт воспроизводит legacy tile-mask shader, включая height blending, масштаб слоёв и UV (X, 1 − Y). PBR, специальные материалы воды/снега и полный игровой свет пока не воспроизводятся. Анимированные SkinnedMesh пропускаются с предупреждением; sky и служебные MapBorder исключены из геометрии объектов. Это не обещание полного визуального совпадения с игрой. Неподдерживаемая обязательная геометрия или transform Landscape приводит к failed, а не к молчаливому искажению.

## Проверка

TBReplays.MapTests импортирует настоящие 36 игровых сцен в изолированную директорию на D:, например D:\CodexArtifacts\TBRepl\map-import-validation. Проверяет высоты по исходным bbox, целостность OBJ2/v3, конечность vertex attributes, bounds индексов, активное состояние амбара Форта, правильную PVR colorTexture Юкона, aliases реплеев, совместимость старых URL и пропуск неизменённых файлов. Отдельно проверяет concurrent SCG reads, отказ на повреждённом DVPL с сохранением предыдущей ревизии, фоновое задание и отказ второго запуска. TBReplays.OnlineTests проверяет существующие HTTP/WebSocket/roles/persistence сценарии.

Изолированный импорт не переключает текущий каталог рабочего бека. Для его обновления после запуска новой сборки вызвать POST /api/maps/import-all?force=true.

## Git

Maps_game, MapsFiles, MapsFiles в корне, Data/Imported, Data/Processed, Data/ImportJobs, map_catalog.json, bin и obj добавлены в .gitignore. Часть старых Data и build outputs уже отслеживается репозиторием: .gitignore не убирает их из индекса. При будущем коммите выбирать только исходники/документацию; не использовать git add -A. В коммит включаются только исходники, настройки без машинных путей и документация. Предшествующие удаления архивов и старой копии фронта не относятся к этой реализации.

Все 36 карт переимпортированы с pipelineVersion=5. Локальные пути на D задаются только в appsettings.Local.json и Directory.Build.local.props; перенос готовых данных на сервер описан в map-deployment.md.
