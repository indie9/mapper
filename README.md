# Role-Menu Mapper

Статический инструмент для настройки пунктов меню: **`meta.roles`** и **`meta.accessInfoKeys`** (флаги доступа из `accessInfoKeys.json`).

## Запуск

1. В корне репозитория: `data.js` (встроенные `roles.json`, `routes.json`, каталог `accessInfoKeys`), `navbar-i18n.js`.
2. Откройте `index.html` в браузере (или через статический сервер).
3. Выберите узел в дереве и отметьте роли и флаги.
4. **Экспорт результата** сохраняет `routes.mapped.json` с обновлёнными `meta.roles` и `meta.accessInfoKeys`.

## Дополнительный импорт

- **Импорт результата** — дерево маршрутов с теми же ролями и флагами (по позиции узла в дереве).
- **Импорт roles.json / routes.json / accessInfoKeys.json** — опционально, подмена исходников без пересборки `data.js`.

## Правила по умолчанию

- Если у маршрута **`meta.roles`** нет или пусто — считается, что **не выбрана ни одна роль**.
- Если **`meta.accessInfoKeys`** нет или пусто — считается, что **не выбран ни один флаг**.
- У **родительских** узлов (есть `children`) роли и флаги **не редактируются вручную**: показывается объединение по потомкам, в экспорт уходит то же объединение.

## Обновление встроенных данных

Пересобрать `data.js` из актуальных файлов в корне репозитория:

```bash
node -e "const fs=require('fs'); const roles=JSON.parse(fs.readFileSync('roles.json','utf8')); const routes=JSON.parse(fs.readFileSync('routes.json','utf8')); const raw=JSON.parse(fs.readFileSync('accessInfoKeys.json','utf8')); const accessInfoKeys=(Array.isArray(raw)?raw:(raw.accessInfo||[])).filter(k=>typeof k==='string'); fs.writeFileSync('data.js','window.__ROLE_MENU_MAPPER_DATA = '+JSON.stringify({roles,routes,accessInfoKeys},null,2)+';\\n');"
```

Локализации заголовков меню: обновить `navbar-i18n.js` при изменении `navbar.properties` (если используете).

## Деплой

Статический набор файлов: `index.html`, `styles.css`, `app.js`, `data.js`, `navbar-i18n.js` — отдать через любой static hosting (GitHub Pages, Nginx, IIS, S3).
