# Карты на сервере

Диск D не требуется. Общие настройки используют относительные пути; локальные Windows-пути находятся только в игнорируемых appsettings.Local.json и Directory.Build.local.props. appsettings.Local.json не попадает в dotnet publish. Переменные окружения и аргументы запуска имеют приоритет над локальным файлом.

## Самый быстрый вариант: доставить готовые карты

Все 36 карт уже переимпортированы, pipelineVersion=5. Не нужно снова импортировать их на сервере: скопировать отдельно содержимое локальной папки D:\TBReplaysData\Maps в MapData рядом с опубликованным TBReplays.dll. Сохранить структуру:

```text
backend/
  TBReplays.dll
  appsettings.json
  MapData/
    map_catalog.json
    Processed/
      07_fort_ft/
        revisions/
          <revision>/
            manifest.json
            objects_mesh.bin
            objects_mesh_manifest.json
            surface_manifest.json
            textures/
            ...
```

Настройка окружения процесса бека:

```text
ASPNETCORE_ENVIRONMENT=Production
MapImport__DataDirectory=MapData
```

Либо добавить MapImport.DataDirectory = "MapData" в серверный appsettings.Production.json. Относительный путь считается от ContentRoot бека: обычно это рабочий каталог запуска. Запускать процесс из backend, например `cd /srv/tbreplays/backend` и `dotnet TBReplays.dll`. Корень Git-репозитория и каталог опубликованного бека могут быть разными: если карты лежат в корне репозитория выше backend, указать правильный путь, например ../../MapData или абсолютный /srv/tbreplays/MapData. Бек должен иметь право записи в каталог результатов. Не удалять MapData при следующих деплоях.

Исходники игры не нужны для просмотра уже импортированных карт. Переносить каталог и ревизии вместе при остановленном беке либо до переключения на новый DataDirectory. Не смешивать старый map_catalog.json с новыми Processed.

## Если нужен повторный импорт на сервере

Положить исходную папку игровых карт в Maps_game рядом с TBReplays.dll. Перенести все подпапки, включая 00_shared_content и 00_global_content. Maps_game содержит непосредственно 07_fort_ft/07_fort_ft.sc2.dvpl и остальные карты, а не ещё одну вложенную Maps_game. Для русских названий перенести Strings/ru.yaml.dvpl в GameStrings/ru.yaml.dvpl.

```text
MapImport__SourceDirectory=Maps_game
MapImport__DataDirectory=MapData
MapImport__LocalizationPath=GameStrings/ru.yaml.dvpl
MapImport__MaxParallelMaps=1
MapImport__RetainedRevisions=1
MapImport__MinimumFreeSpaceGiB=2
```

SourceDirectory и DataDirectory должны быть разными и не вложенными друг в друга. Оставить свободное место сверх размера исходников и готовых карт: резерв 2 GiB — только нижняя граница, не оценка общего расхода.

После авторизации администратором вызвать POST /api/maps/import-all с X-CSRF-TOKEN; ответ 202 содержит jobId. Проверять GET /api/maps/import-jobs/{jobId}. Обычный запуск пропустит актуальные карты. force=true использовать для намеренного полного переимпорта. После completed обновить каталог карт на фронте.

## Доставка кода

Бек: TBReplays/TBReplays/TBReplays.csproj. Фронт: TBreplaysF-design-integrated/TBreplaysF/TBreplaysF/TBReplays.Web. Выполнить dotnet publish и npm run build; развернуть полученный бек и dist своего обычного фронта. Игровые исходники, результаты импорта и локальные настройки доставляются отдельно от Git и publish.

Исправлены конвертация цветов PVR, DDS DX10, сборка слоёв поверхности и ориентация UV. Это не полный рендер игры: специальные материалы воды/снега, растительность и верхние части купола ПЭПТ ещё имеют визуальные отличия.
