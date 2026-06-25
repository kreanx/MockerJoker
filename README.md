<p align="center">
  <img width="600" alt="Mockerjoker" src="https://github.com/user-attachments/assets/b72cbb80-e20d-42d1-854c-a493c79de236" />
</p>

<h1 align="center">MockerJoker</h1>

<p align="center">
  <em>fake it till you make it</em> — лёгкое браузерное расширение для мокирования HTTP-запросов.<br>
  Тестируйте ошибки сервера, задержки, любой сценарий — без бэкенда, без прокси, без сервера.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-Extension-green?logo=googlechrome" alt="Chrome">
  <img src="https://img.shields.io/badge/Firefox-Add--on-orange?logo=firefox" alt="Firefox">
  <img src="https://img.shields.io/github/v/tag/kreanx/MockerJoker?label=version&color=blue" alt="Version">
  <img src="https://img.shields.io/badge/tests-39%20node%3Atest-success" alt="Tests">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="License">
</p>

<p align="center">
  <img width="280" alt="Popup" src="https://github.com/user-attachments/assets/79cdcf44-3853-4945-ad8a-269cbc128ccd" />
  <img width="280" alt="Popup Editor" src="https://github.com/user-attachments/assets/4810aeb8-46b8-449e-a27c-fe4cafa77bab" />
  <img width="560" alt="Panel" src="https://github.com/user-attachments/assets/664112a2-6c23-4e84-a05e-dd9482d89cf5" />
</p>

<p align="center"><em>Popup · Редактор правила · Полноэкранная панель</em></p>

---

## Оглавление

- [Почему MockerJoker?](#почему-mockerjoker)
- [Быстрый старт](#быстрый-старт)
- [Возможности](#возможности)
- [DevTools панель](#devtools-панель)
- [Переменные между запросами](#переменные-varsavers)
- [Типы действий](#типы-действий)
- [Ограничения](#ограничения)

---

## Почему MockerJoker?

| | MockerJoker | Requestly | Tweak |
|---|---|---|---|
| Мок ответа | ✅ | ✅ | ✅ |
| Модификация тела (dot notation) | ✅ `items[0].name = "x"` | ❌ | ✅ (GUI) |
| **Переменные между правилами** | ✅ `$token` передаётся | ❌ | ❌ |
| **Условный мок (по body)** | ✅ `balance < 100` | ❌ | ❌ |
| GraphQL (operationName) | ✅ | ✅ | ❌ |
| **DevTools панель** | ✅ interception log | ✅ | ❌ |
| Экспорт/импорт правил | ✅ | ✅ | ❌ |
| Без аккаунта, без облака | ✅ | ❌ | ✅ |
| **Размер** | ~55 KB | ~5 MB | ~2 MB |

**Принцип:** лёгкость. Никаких бандлеров, фреймворков, серверов, аккаунтов. Чистый vanilla JS. Расширение работает офлайн, данные хранятся локально.

---

## Быстрый старт

1. Установите расширение (Chrome/Firefox)
2. Откройте popup → пресет **500 Internal Error**
3. Введите URL-паттерн `*/api/*` → **Сохранить**
4. Готово — все запросы к `*/api/*` вернут 500

<details>
<summary><b>Примеры использования</b></summary>

**Симуляция ошибки**
> Пресет `500 Internal Error` → URL `*/api/payments/*`

**Убрать авторизацию**
> `modifyRequest` → URL `*/api/*` → Remove Header: `Authorization`

**Токен из логина → следующий запрос**
> 1. varSaver: URL `*/auth/login`, source `body`, path `token`, name `$authToken`
> 2. `modifyRequest` → Set Header: `Authorization` = `Bearer $authToken`

**Изменить поле в ответе**
> `modifyResponse` → URL `*/api/user` → Transform: `role` → `"admin"`

**Mock GraphQL по имени операции**
> `mockResponse` → GraphQL tab → operationName `GetUserProfile` → тело `{"data": {"name": "Test"}}`

**Условный мок — только если balance < 100**
> varSaver извлекает `$balance` → `mockResponse` с varCondition `$balance < 100`

</details>

---

## Возможности

### Действия с запросами

- **mockResponse** — полностью заменить ответ (статус, заголовки, тело, задержка)
- **modifyRequest** — метод, заголовки, query-параметры, трансформация тела, GraphQL query override
- **modifyResponse** — заголовки ответа, трансформация тела (`field.path = "value"`)
- **bodyConditions** — правило сработает только если условия на тело выполняются (equals/notEquals/contains/exists)
- **GraphQL** — мэтчинг по `operationName`, REST/GraphQL табы

### Переменные (varSavers)

Извлечение значений из запросов и ответов → использование `$varName` везде:
- В теле mock-ответа, в трансформациях, в заголовках, в query-параметрах, в условиях

### Интерфейс

- Dark/Light тема (Catppuccin Mocha/Latte)
- JSON editor с подсветкой синтаксиса, поиском (O(n)), нумерацией строк
- 8 пресетов для типичных сценариев
- Счётчик перехваченных запросов (badge на иконке)
- Автодополнение URL и `$varName`
- Экспорт/импорт правил

---

## DevTools панель

Своя вкладка в Chrome DevTools — видны **все** перехваченные запросы (не только замоканные):

- **Таблица**: время, метод (цветной), URL (хост скрыт для same-origin), статус, размер, действие, правило
- **Сортировка** по любому столбцу (клик на заголовок)
- **Фильтры**: All / Mock / 2xx / 4xx / 5xx
- **Resize колонок** — тяни границу заголовка
- **Detail panel**: Общее / Заголовки / Запрос (payload) + **Ответ всегда виден справа**
- **Подсветка синтаксиса JSON** в теле ответа
- **Diff** — изменённые поля подсвечены при modifyResponse
- **ПКМ → Замокать** — создать правило из запроса
- **Copy as cURL** — кнопка копирования
- **Тема синхронизируется** с popup/panel

---

## Переменные (varSavers)

Независимые извлекатели значений из HTTP-запросов и ответов:

| Параметр | Значение |
|---|---|
| URL-паттерн | На какие запросы реагировать |
| Источник | `body` (dot notation), `header`, `status` |
| Откуда | Из ответа (по умолчанию) или из запроса |
| Имя | `$varName` — доступно везде |

Использование `$varName`: в теле mock-ответа, в трансформациях, в заголовках, в query-параметрах, в условиях.

---

## Типы действий

| Тип | Описание |
|---|---|
| `mockResponse` | Полная подмена ответа: статус, заголовки, тело, задержка |
| `modifyRequest` | Метод, заголовки, query, трансформация тела, GraphQL override |
| `modifyResponse` | Заголовки ответа, трансформация тела ответа |

Правила применяются последовательно: Phase 1 (modifyRequest) → Phase 2 (mockResponse unconditional) → Phase 3 (real request + conditional mock + modifyResponse).


---

## Ограничения

- Перехватываются только `fetch()` и `XMLHttpRequest`
- Не перехватывает навигацию, `<script src>`, `<img>`, `<link>`
- Трансформации работают только с JSON-телами
- Переменные (`tabVars`) хранятся в runtime memory — не переживают перезапуск браузера

<details>
<summary><b>Troubleshooting</b></summary>

| Симптом | Решение |
|---|---|
| Правило не сработало | Обновите страницу (F5). Content script инжектится при загрузке |
| Cookie/Origin/Host не удаляется | Forbidden headers — браузер блокирует |
| Запрос не перехватывается | Только `fetch()` и `XMLHttpRequest` поддерживаются |
| Правило с body condition не срабатывает | Проверьте путь, оператор и что тело — валидный JSON |
| Переменная не подставляется | Для параллельных запросов может потребоваться F5 |
| Все правила не работают | Проверьте мастер-переключатель в header |

</details>

---

## License

MIT
