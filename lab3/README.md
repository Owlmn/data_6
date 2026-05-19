# Data Analyst AI

Веб-приложение для анализа данных через LLM. Пользователь загружает CSV или Excel — Python-бэкенд запускает агента (Pydantic AI): генерирует Python-код, выполняет в песочнице, при ошибках автоисправляет и повторяет до 5 раз. Фронтенд отображает метрики, инсайты, корреляции и графики.

### https://llm-api-analyst.vercel.app/

P.S: ввиду ограничений хостиногов Vercel и Railway, а также лимитов токенов deepseek, поддерживаются файлы до 35 МБ, среднее время обработки запроса и получения результата: 20-50 сек, время зависит от объёма входных данных.

## Архитектура

```
Пользователь → загрузка CSV/Excel → парсинг на клиенте
            │
  Python Backend (Railway) /api/analyze
    ├─ Pydantic AI Agent → DeepSeek API → генерация кода
    ├─ Песочница pandas/numpy → выполнение
    └─ Ошибка? → автоисправление → повтор (до 5 итераций)
            │
  Результат → обзор, метрики, инсайты, корреляции, графики (Recharts)
```

Данные не проходят через Vercel — клиент отправляет их напрямую в Railway. Railway обрабатывает файлы до 35 МБ.

## Структура проекта

```
├── app/
│   ├── globals.css              # Tailwind
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Главная страница: чаты, превью, один fetch к бэкенду
│   └── api/analyze/
│       └── route.ts             # Тонкий прокси до Python-бэкенда
├── components/
│   ├── FileUpload.tsx           # Загрузка CSV/Excel, авто-разделитель, Text-to-Columns
│   └── AnalysisResults.tsx      # Отображение: обзор, метрики, инсайты, корреляции, графики
├── lib/
│   ├── dataParser.ts            # Типы (Analysis, DataSummary), summarizeData, хелперы localStorage
│   └── sanitize.ts              # Защита от prompt-injection (35 паттернов EN/RU)
├── server/
│   ├── main.py                  # FastAPI + Pydantic AI агент (LLM + песочница)
│   └── railway.toml             # Деплой-конфиг Railway
├── .env.example                 # Шаблон переменных окружения
├── requirements.txt             # Python-зависимости
└── package.json                 # Node-зависимости
```

## Технологии

| Компонент | Стек |
|---|---|
| Фронтенд | Next.js 16, React 18, Tailwind CSS |
| LLM-агент | Pydantic AI + DeepSeek (`deepseek-chat`) |
| Песочница Python | FastAPI + pandas + numpy (Railway) |
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
DEEPSEEK_MODEL=deepseek-chat
NEXT_PUBLIC_PYTHON_URL=http://localhost:8000
MAX_RETRIES=5
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
| `DEEPSEEK_MODEL` | Нет | `deepseek-chat` | Модель DeepSeek |
| `NEXT_PUBLIC_PYTHON_URL` | Да | `http://localhost:8000` | URL Railway-сервера |
| `MAX_RETRIES` | Нет | `5` | Макс. итераций агента |

## API

### `POST /api/analyze` (Python Backend)

Один эндпоинт — принимает датасет и сообщение, запускает агента, возвращает готовый анализ.

```json
{
  "column_summary": "date: string\nrevenue: number\norders: number",
  "message": "Покажи топ-5 по выручке",
  "dataset": "{\"fileName\":\"sales.csv\",\"rows\":[...]}"
}
```

Ответ: `{ "overview": "...", "keyMetrics": [...], "insights": [...], "correlations": [...], "charts": [...], "iterations": 2 }`

### `GET /api/health` (Railway)

Ответ: `{ "status": "ok", "model": "deepseek-chat", "max_retries": 5 }`

## Деплой

### Vercel (фронтенд)

1. Подключить репозиторий к Vercel
2. Framework: Next.js (автоопределение)
3. Переменные окружения: `NEXT_PUBLIC_PYTHON_URL`

### Railway (Python Backend)

1. Подключить репозиторий к Railway
2. Railway использует `server/railway.toml` для сборки и запуска
3. Переменные окружения: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `MAX_RETRIES`

## Защита от prompt-injection

Реализована в `lib/sanitize.ts`, вызывается в `page.tsx` перед отправкой запроса. Фильтрует 35 паттернов (EN + RU): подмена системных инструкций, jailbreak, переопределение роли модели. Обнаруженная атака заменяется на `[FILTERED]`, факт логируется в консоль браузера.

CORS бэкенда ограничен доменом фронтенда и `localhost:3000`.

## Ограничения

- Файлы до 35 МБ (проверка на клиенте)
- При превышении лимита токенов DeepSeek — сообщение об ошибке
- История чатов и кэш анализа сохраняются в localStorage (до 20 записей)
- После перезагрузки страницы датасеты нужно загрузить заново (данные в памяти, не в localStorage)
