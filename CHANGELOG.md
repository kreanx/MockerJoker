# MockerJoker Changelog

## v5.0.0 (2026-05-08)

### Добавлено
- **Цепочки шагов (Stateful Steps)** - последовательные ответы при повторных запросах
  - Массив шагов с индивидуальными статусом, телом, задержкой
  - Режимы: "Повторять сначала" / "Оставить последний"
  - Badge `Chain 3` для правил со steps
- **Изменение метода запроса** - переопределение HTTP-метода (POST -> GET и т.д.)
- **Подмена URL-параметров** - удаление и установка query params в исходящем запросе
- **GraphQL Support** - мэтчинг по `operationName` + conditions на `variables`
- **Новые пресеты**: GraphQL Mock, Polling (3 шага)
- **CHANGELOG.md** - история версий

### Изменено
- injected.js: добавлены callCount tracking, step selection, URL modifications, GraphQL parsing
- common.js: openEditor/saveEditor поддерживают steps, method, queryParams, graphqlOperation
- UI: GraphQL Operation поле, method dropdown, query params fields, steps editor

---

## v4.0.0 (2026-05-07)

### Добавлено
- **modifyBody** - новый тип действия для трансформации JSON-тела запроса по dot notation
- **bodyConditions** - условия на тело: `equals`, `notEquals`, `contains`, `exists`
- Семантика bodyConditions зависит от типа: mockResponse/modifyResponse -> response body, modifyBody/modifyRequest -> request body
- **8 пресетов**: 500, 403, 401, 204, частичные данные, убрать Auth, убрать CORS, заменить значение
- **JSON редактор**: подсветка синтаксиса, поиск, fullscreen dark theme, validation, autoformat
- **Hit counter** - счётчик перехватов рядом с каждым правилом
- **URL autocomplete** - автоподстановка URL из реальных запросов
- **Help overlay** - справка внутри popup
- **Export/Import** правил в JSON
- `setByPath` с auto-create промежуточных объектов + `[*]` wildcard

### Изменено
- XHR handler переписан на `findAllRules` + 3 фазы (аналогично fetch)
- Fetch handler переписан на пофазную обработку: Phase 1 (modifyBody/modifyRequest) -> Phase 2 (mockResponse unconditional) -> Phase 3 (real request + conditional mock + modifyResponse)
- 4 типа действий: mockResponse, modifyRequest, modifyResponse, modifyBody
- removeCookies пресет удалён (Cookie - forbidden header)
- Tooltip `?` иконки с `position: fixed`

### Исправлено
- `[*]` wildcard не парсился в splitPath regex
- `?` в URL не экранировался в globToRegex
- Root arrays + `[*]` wildcard в body path navigation

---

## v3.0.2 (2026-05-07)

### Добавлено
- Search highlight в JSON редакторе
- resolve relative URLs

### Изменено
- Prettify console output: body as object, обновлён badge стиль `[MockerJoker]`

---

## v2.2.0 (2026-05-07)

### Добавлено
- JSON editor с syntax highlighting, fullscreen mode, validation
- Автоформатирование при вставке JSON из буфера
- Search в JSON редакторе

### Исправлено
- Firefox: добавлены `data_collection_permissions` в manifest
- Missing closing brace в deleteRuleById

### Изменено
- alert/confirm заменены на inline UI
- Убрана tester-specific терминология

---

## v2.1 (2026-05-07)

### Добавлено
- Rebrand на MockerJoker
- Custom autocomplete dropdown вместо datalist

### Исправлено
- Extension context invalidated - reconnect к background
- Filter seen requests по active tab
- Long URLs overflow - expand on hover
- overflow:hidden убран из rule-info

---

## v2.0 (2026-05-07)

### Добавлено
- URL autocomplete из реальных запросов
- Hit counter - счётчик перехватов
- Firefox support (MV2 manifest, build-firefox.sh)
- Build scripts: build-zip.sh, build-firefox.sh

---

## v1.0 (2026-05-07)

### Добавлено
- Initial release - Request Mocker extension
- mockResponse - полная подмена ответа (статус, тело, заголовки, задержка)
- modifyRequest - модификация заголовков исходящего запроса
- modifyResponse - модификация заголовков входящего ответа
- URL-паттерны с `*` маской
- Content script подход (fetch/XHR override)
- Chrome + Firefox поддержка
- Popup + Panel интерфейс
- chrome.storage.local для хранения правил
