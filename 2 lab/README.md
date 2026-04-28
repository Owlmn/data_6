## Описание проекта

Данный проект реализует автоматизированный пайплайн саммаризации (краткого пересказа) новостных статей с помощью LLM (Large Language Model).

Скрипт:

1. Читает новости из CSV-файла (для примера берутся 3 случайных статьи, чтобы избежать высокой траты токенов LLM)
2. Извлекает заголовок, дату публикации и текст статьи  
3. Очищает и подготавливает текст  
4. При необходимости разбивает длинные статьи на части (chunks)  
5. Формирует запрос к LLM через API Xiaomi MiMo v2.5 pro
6. Получает краткое содержание статьи  
7. Сохраняет результат в TXT-файл  

---

## Требования задания:
### Необходимо:
- Читать входные данные из CSV или API  
- Формировать запрос к LLM  
- Получать структурированный JSON-ответ  
- Сохранять результат в TXT  

---

## Реализовано:
### Саммаризация:
**CSV → LLM → TXT**

- Новости читаются из CSV  
- LLM генерирует краткое содержание каждой новости  
- Результат сохраняется в TXT  

---

## Пример входного CSV:
```csv
Article,Date,Heading,NewsType
"HOVE: Pakistan in their second warm-up match were put into bat after Sussex captain Ben Brown won the toss and elected to field first here on Friday.Pakistan made two changes from their team played against Somerset in their first warm-up. The match had ended in a draw after Pakistan's Younis Khan and Azhar Ali and Somerset captain Marcus Trescothik hit centuries.Pakistan brought pacers Wahab Riaz and Imran Khan, and spinner Zulfiqar Babar in place of fast bowlers Mohammad Amir and Rahat Ali, and spinner Yasir Shah, who are being rested.Teams:Pakistan XI: Mohammad Hafeez, Shan Masood, Azhar Ali, Younis Khan, Misbah-ul-Haq (captain), Asad Shafiq, Sarfraz Ahmed (wk), Wahab Riaz, Sohail Khan, Zulfiqar Babar, Imran Khan.Sussex: LWP Wells, PD Salt, Craig Cachopa, HZ Finch, MW Machan, BC Brown (captain &amp; wk), WAT Beer, A Shahzad, DR Briggs, JC Archer, A Sakande",7/8/2016,Pakistan bat against Sussex in warm up ,sports
```
## Пример выходного TXT:

```txt
Title: Pakistan bat against Sussex in warm up
Published: 7/8/2016
Summary:
Pakistan elected to bat first after Sussex won the toss in their second warm-up match. The team made three changes from their previous draw against Somerset, resting key bowlers Mohammad Amir, Rahat Ali, and Yasir Shah. The first warm-up had ended in a draw with centuries from Pakistan's Younis Khan and Azhar Ali.
```

---

# Инструкция по запуску

## Требования
- Python 3.8+
- Доступ к API Xiaomi MiMo v2.5 pro (OpenAI-compatible)
- API ключ для сервиса

## Установка зависимостей

```bash
pip install python-dotenv openai
```

или используя requirements.txt:

```bash
pip install -r requirements.txt
```

## Конфигурация

1. Создайте файл `.env` в корневой директории проекта (пример файла `.env.example`).

### Описание параметров:
| Параметр | По умолчанию | Описание |
|----------|--------------|---------|
| `MIMO_API_KEY` | - | **Обязателен.** API ключ для доступа к сервису |
| `MIMO_BASE_URL` | https://api.xiaomimimo.com/v1 | URL базы API |
| `MIMO_MODEL` | mimo-v2.5-pro | Модель LLM |
| `INPUT_CSV` | Articles.csv | Путь к входному CSV файлу |
| `OUTPUT_TXT` | news.txt | Путь к выходному TXT файлу |
| `MAX_ITEMS` | 5 | Максимальное количество статей для обработки |
| `REQUEST_TIMEOUT` | 120 | Таймаут запроса к API в секундах |
| `ARTICLE_CHUNK_CHARS` | 3500 | Максимальное количество символов в одной части статьи |
| `SUMMARY_LANGUAGE` | English | Язык |

## Запуск

```bash
python news_summarizer.py
```

Скрипт прочитает статьи из файла `Articles.csv` и сохранит саммаризированные результаты в `output_example.txt`


