import csv
import json
import os
import random
from pathlib import Path


from dotenv import load_dotenv
from openai import OpenAI


DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1"
DEFAULT_MODEL = "mimo-v2.5-pro"
DEFAULT_INPUT_CSV = "Articles.csv"
DEFAULT_OUTPUT_TXT = "news.txt"
DEFAULT_MAX_ITEMS = 3
DEFAULT_SUMMARY_LANGUAGE = "English"
CSV_ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")


def load_config():
    load_dotenv()

    return {
        "api_key": require_env("MIMO_API_KEY"),
        "base_url": os.getenv("MIMO_BASE_URL", DEFAULT_BASE_URL),
        "model": os.getenv("MIMO_MODEL", DEFAULT_MODEL),
        "input_csv": os.getenv("INPUT_CSV", DEFAULT_INPUT_CSV),
        "output_txt": os.getenv("OUTPUT_TXT", DEFAULT_OUTPUT_TXT),
        "max_items": int(os.getenv("MAX_ITEMS", str(DEFAULT_MAX_ITEMS))),
        "request_timeout": float(os.getenv("REQUEST_TIMEOUT", "120")),
        "summary_language": os.getenv("SUMMARY_LANGUAGE", DEFAULT_SUMMARY_LANGUAGE),
        "article_column": os.getenv("ARTICLE_COLUMN", "Article"),
        "date_column": os.getenv("DATE_COLUMN", "Date"),
        "title_column": os.getenv("TITLE_COLUMN", "Heading"),
    }


def require_env(name):
    value = os.getenv(name)
    if not value:
        raise ValueError(f"Environment variable '{name}' is required.")
    return value


def create_client(config):
    print("[DEBUG] Creating OpenAI client...")
    return OpenAI(
        api_key=config["api_key"],
        base_url=config["base_url"],
        timeout=config["request_timeout"],
    )


def read_news_rows(config):
    csv_path = Path(config["input_csv"])
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    rows = read_csv_with_fallback(csv_path)
    
    items = []
    for row in rows:
        article = clean_text(row.get(config["article_column"]))
        title = clean_text(row.get(config["title_column"]))
        published_at = clean_text(row.get(config["date_column"]))

        if not article:
            continue

        items.append(
            {
                "title": title or None,
                "published_at": published_at or None,
                "article": article,
            }
        )

    max_items = config["max_items"]
    if max_items > 0 and len(items) > max_items:
        items = random.sample(items, max_items)

    if not items:
        raise ValueError("No usable article rows were found in the CSV file.")

    return items


def read_csv_with_fallback(csv_path):
    last_error = None

    for encoding in CSV_ENCODINGS:
        try:
            with csv_path.open("r", encoding=encoding, newline="") as file:
                reader = csv.DictReader(file)
                rows = list(reader)
            
            return rows
        except UnicodeDecodeError as exc:
            last_error = exc

    raise ValueError(f"Could not decode CSV file with supported encodings: {CSV_ENCODINGS}") from last_error


def clean_text(value):
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


def build_summary_messages(text, summary_language, stage):
    return [
        {
            "role": "system",
            "content": (
                f"Write a concise news summary in {summary_language}. "
                'Return ONLY valid JSON with this format: {"sum": "your summary text here"}'
            ),
        },
        {
            "role": "user",
            "content": (
                f"Stage: {stage}\n"
                "Summarize the following news article in 2-4 sentences:\n"
                f"{text}"
            ),
        },
    ]


def estimate_completion_tokens(text):
    estimated = len(text) // 4 + 180
    return max(250, min(1500, estimated))

def summarize_text(client, config, text, stage):
    print(f"[DEBUG] Summarizing {stage}... (text length: {len(text)})")
    completion = client.chat.completions.create(
        model=config["model"],
        messages=build_summary_messages(text, config["summary_language"], stage),
        max_completion_tokens=estimate_completion_tokens(text),
        temperature=0,
        top_p=0.95,
        stream=False,
        stop=None,
        frequency_penalty=0,
        presence_penalty=0,
    )

    response_text = completion.choices[0].message.content.strip()
    if not response_text:
        raise ValueError(f"MiMo returned an empty summary for {stage}.")
    
    try:
        parsed = json.loads(response_text)
        if isinstance(parsed, dict) and "sum" in parsed:
            summary = parsed["sum"].strip()
            return summary
        else:
            print(f"[DEBUG] JSON parsed but 'sum' key not found")
    except json.JSONDecodeError as e:
        print(f"[DEBUG] Failed to parse JSON: {e}")
    
    return response_text


def summarize_news_item(client, config, item):
    summary = summarize_text(client, config, item["article"] or "", "article")
    return {
        "title": item["title"],
        "published_at": item["published_at"],
        "summary": summary,
    }


def write_txt_results(path, results):
    print(f"[DEBUG] Writing results to TXT: {path}")
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with output_path.open("w", encoding="utf-8") as file:
        for index, item in enumerate(results, start=1):
            file.write(f"{'='*80}\n\n")
            
            if item["title"]:
                file.write(f"Title: {item['title']}\n")
            
            if item["published_at"]:
                file.write(f"Published: {item['published_at']}\n")
            
            file.write(f"\nSummary:\n{item['summary']}\n")
    
    print(f"[DEBUG] TXT file saved successfully")


def main():
    try:
        config = load_config()
        client = create_client(config)
        items = read_news_rows(config)

        results = []
        for index, item in enumerate(items, start=1):
            summarized = summarize_news_item(client, config, item)
            results.append(summarized)
            print(f"Processed {index}/{len(items)}")

        write_txt_results(config["output_txt"], results)
        print(f"[DEBUG] TXT saved to: {config['output_txt']}")
        
        print(f"[DEBUG] Successfully processed {len(results)} articles")
        return 0
    except Exception as exc:
        print(f"Error: {exc}")
        return 1


if __name__ == "__main__":
    main()
