# Data Analyst AI

Веб-приложение для анализа данных через LLM. Пользователь загружает CSV или Excel — DeepSeek генерирует Python-код, Railway выполняет его на полных данных, фронтенд показывает метрики, инсайты, корреляции и графики.

### https://llm-api-analyst.vercel.app/

P.S: ввиду ограничений ограничений хостиногов Vercel и Railway, а также лимитов токенов deepseek, поддерживаются файлы до 35 МБ, среднее время обработки запроса и получения результата: 20-50 сек, время зависит от объёма входных данных.

## Архитектура

```
Пользователь → загрузка CSV/Excel → парсинг на клиенте
            |
  Vercel /api/analyze → DeepSeek API (генерация Python-кода)
            │
  Railway /api/execute → pandas/numpy (исполнение на полных данных)
            │
  Результат -> обзор, метрики, инсайты, корреляции, графики (Recharts)
```

Данные не проходят через Vercel — клиент отправляет их напрямую в Railway. Railway обрабатывает файлы до 35 МБ.

## Структура проекта

```
├── app/
│   ├── globals.css              # Tailwind
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Главная страница: чаты, превью, пайплайн анализа
│   └── api/analyze/
│       └── route.ts             # Генерация Python-кода через DeepSeek, извлечение JSON
├── components/
│   ├── FileUpload.tsx           # Загрузка CSV/Excel, авто-разделитель, Text-to-Columns
│   └── AnalysisResults.tsx      # Отображение: обзор, метрики, инсайты, корреляции, графики
├── lib/
│   ├── dataParser.ts            # Типы (Analysis, DataSummary, ColumnInfo), summarizeData
│   └── sanitize.ts              # Защита от prompt-injection (35 паттернов EN/RU)
├── server/
│   ├── main.py                  # FastAPI: /api/execute, /api/health
│   └── railway.toml             # Деплой-конфиг Railway
├── .env.example                 # Шаблон переменных окружения
├── vercel.json                  # Деплой-конфиг Vercel
├── requirements.txt             # Python-зависимости
└── package.json                 # Node-зависимости
```

## Технологии

| Компонент | Стек |
|---|---|
| Фронтенд | Next.js 16, React 18, Tailwind CSS |
| Оркестрация LLM | Next.js API Routes (Vercel) |
| Исполнение Python | FastAPI + pandas + numpy (Railway) |
| LLM | DeepSeek |
| Графики | Recharts |
| CSV | Papa Parse |
| Excel | SheetJS (xlsx) |

## Быстрый старт

### 1. API ключ

Зарегистрироваться на [platform.deepseek.com](https://platform.deepseek.com), создать API ключ.

### 2. Переменные окружения

Создать `.env` в корне:

```bash
DEEPSEEK_API_KEY=ваш_ключ
DEEPSEEK_MODEL=deepseek-v4-flash
NEXT_PUBLIC_PYTHON_URL=http://localhost:8000
```

### 3. Запуск

```bash
npm install
pip install -r requirements.txt

# Терминал 1 — Python-сервер
python -m uvicorn server.main:app --reload --port 8000

# Терминал 2 — Next.js
npm run dev
```

Открыть http://localhost:3000.

## Переменные окружения

| Переменная | Обязательна | По умолчанию | Описание |
|---|---|---|---|
| `DEEPSEEK_API_KEY` | Да | — | API ключ DeepSeek |
| `DEEPSEEK_MODEL` | Нет | `deepseek-v4-flash` | Модель DeepSeek |
| `NEXT_PUBLIC_PYTHON_URL` | Да | `http://localhost:8000` | URL Railway-сервера |

## API

### `POST /api/analyze` (Vercel)

Генерация кода:

```json
{
  "columnSummary": "date: string\nrevenue: number\norders: number",
  "message": "Покажи топ-5 по выручке",
  "fileName": "sales.csv"
}
```

Ответ: `{ "pythonCode": "import json\nimport pandas as pd\n..." }`

Извлечение JSON (если вывод Python не распарсился):

```json
{ "pythonOutput": "сырой вывод от Railway..." }
```

Ответ: `{ "analysis": { "overview": "...", "keyMetrics": [...], "insights": [...], "charts": [...] } }`

### `POST /api/execute` (Railway)

```json
{
  "code": "import json\nimport pandas as pd\n...",
  "dataset": "{\"fileName\":\"sales.csv\",\"rows\":[...]}"
}
```

Ответ: `{ "result": "{\"overview\":\"...\",\"keyMetrics\":[...]}" }`

### `GET /api/health` (Railway)

Ответ: `{ "status": "ok" }`

## Деплой

### Vercel (фронтенд + оркестрация)

1. Подключить репозиторий к Vercel
2. Framework: Next.js (автоопределение)
3. Переменные окружения: `DEEPSEEK_API_KEY`, `NEXT_PUBLIC_PYTHON_URL`

### Railway (исполнение Python)

1. Подключить репозиторий к Railway
2. Railway использует `server/railway.toml` для сборки и запуска
3. Переменные окружения не требуются

## Защита от prompt-injection

Реализована в `lib/sanitize.ts`, вызывается серверно в `/api/analyze`. Фильтрует 35 паттернов (EN + RU): подмена системных инструкций, jailbreak, переопределение роли модели. Пользовательский ввод с детектированной атакой заменяется на `[FILTERED]`, факт атаки логируется в консоль.

CORS бэкенда ограничен доменом фронтенда и `localhost:3000`.

## Ограничения

- Файлы до 35 МБ (проверка на клиенте)
- При превышении лимита токенов DeepSeek — сообщение об ошибке
- История чатов и кэш анализа сохраняются в localStorage (до 10 записей)
