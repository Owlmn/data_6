import json
import math
import os
import re
from typing import Any

import pandas as pd
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    data: list[dict[str, Any]] = Field(default_factory=list)
    fileName: str


def safe_float(value: Any) -> float | None:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(num) or math.isinf(num):
        return None
    return num


def summarize_dataframe(df: pd.DataFrame, file_name: str) -> dict[str, Any]:
    columns = []
    numeric_stats: dict[str, dict[str, float]] = {}

    for col in df.columns:
        series = df[col]
        non_null = series.dropna()
        is_numeric = pd.api.types.is_numeric_dtype(series)
        col_type = "numeric" if is_numeric else "categorical"

        columns.append(
            {
                "name": str(col),
                "type": col_type,
                "sample": [str(v) for v in non_null.head(10).tolist()],
                "uniqueCount": int(non_null.nunique()),
                "nullCount": int(series.isna().sum()),
            }
        )

        if is_numeric and len(non_null) > 0:
            numeric_stats[str(col)] = {
                "min": float(non_null.min()),
                "max": float(non_null.max()),
                "mean": float(non_null.mean()),
                "median": float(non_null.median()),
                "std": float(non_null.std(ddof=0)),
                "sum": float(non_null.sum()),
                "count": float(non_null.count()),
            }

    return {
        "rows": int(len(df)),
        "columns": columns,
        "numericStats": numeric_stats,
        "fileName": file_name,
    }


def correlations_from_dataframe(df: pd.DataFrame) -> list[dict[str, Any]]:
    numeric_df = df.select_dtypes(include=["number"])
    if numeric_df.shape[1] < 2:
        return []

    corr = numeric_df.corr(numeric_only=True)
    cols = list(corr.columns)
    result = []
    for i in range(len(cols)):
        for j in range(i + 1, len(cols)):
            c1 = cols[i]
            c2 = cols[j]
            value = safe_float(corr.loc[c1, c2])
            if value is None:
                continue
            result.append({"col1": str(c1), "col2": str(c2), "correlation": value})
    result.sort(key=lambda x: abs(x["correlation"]), reverse=True)
    return result[:10]


def charts_from_dataframe(df: pd.DataFrame) -> list[dict[str, Any]]:
    charts: list[dict[str, Any]] = []
    numeric_cols = list(df.select_dtypes(include=["number"]).columns)
    if not numeric_cols:
        return charts

    first = str(numeric_cols[0])
    top = df[first].dropna().value_counts().head(10)
    charts.append(
        {
            "type": "bar",
            "title": f"Top values for {first}",
            "xKey": "label",
            "yKey": "value",
            "description": "Most frequent values",
            "data": [{"label": str(k), "value": int(v)} for k, v in top.items()],
        }
    )

    if len(numeric_cols) >= 2:
        x_col = str(numeric_cols[0])
        y_col = str(numeric_cols[1])
        points = df[[x_col, y_col]].dropna().head(250)
        charts.append(
            {
                "type": "scatter",
                "title": f"{x_col} vs {y_col}",
                "xKey": x_col,
                "yKey": y_col,
                "description": "Relationship between two numeric columns",
                "data": points.to_dict(orient="records"),
            }
        )

    return charts


def build_prompt(
    summary: dict[str, Any], correlations: list[dict[str, Any]], charts: list[dict[str, Any]]
) -> str:
    corr_desc = "\n".join(
        f'- {c["col1"]} ~ {c["col2"]}: {c["correlation"]:.3f}' for c in correlations[:10]
    )
    chart_desc = "\n".join(
        f'- {c["title"]} [{c["type"]}] x={c.get("xKey","label")} y={c.get("yKey","value")}'
        for c in charts[:5]
    )
    return "\n".join(
        [
            "You are a professional data analyst.",
            "You receive verified output from a Python analysis tool.",
            "Generate only valid JSON with these fields:",
            '{"overview":"","keyMetrics":[],"insights":[],"correlations":[],"charts":[],"recommendations":[],"pythonCode":""}',
            "Do not add markdown or explanations outside JSON.",
            "",
            f'Filename: {summary["fileName"]}',
            f'Rows: {summary["rows"]}',
            f'Columns: {json.dumps(summary["columns"], ensure_ascii=False)}',
            f'Numeric stats: {json.dumps(summary["numericStats"], ensure_ascii=False)}',
            f'Tool correlations:\n{corr_desc or "none"}',
            f'Tool charts:\n{chart_desc or "none"}',
            "Use correlation and charts from tool output, do not invent unsupported values.",
        ]
    )


def parse_first_json_object(text: str) -> str | None:
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape = False
    for idx in range(start, len(text)):
        char = text[idx]
        if escape:
            escape = False
            continue
        if char == "\\":
            escape = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : idx + 1]
    return None


def robust_json_parse(text: str) -> dict[str, Any]:
    cleaned = re.sub(r"```json|```", "", text, flags=re.IGNORECASE).strip()
    obj = parse_first_json_object(cleaned)
    if not obj:
        raise ValueError("No JSON object found")
    try:
        return json.loads(obj)
    except json.JSONDecodeError:
        return json.loads(re.sub(r",\s*([}\]])", r"\1", obj))


def call_groq(prompt: str) -> dict[str, Any]:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")

    model = os.getenv("GROQ_MODEL", "allam-2-7b")
    payload = {
        "model": model,
        "max_tokens": 2048,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a data analysis assistant. Analyze tool output only. "
                    "Return valid JSON only."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }
    response = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=60,
    )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Groq API error: {response.text[:300]}")

    content = response.json()["choices"][0]["message"]["content"]
    return robust_json_parse(content)


app = FastAPI(title="LLM Analyst Backend")

allowed_origins = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> dict[str, Any]:
    if not req.data:
        raise HTTPException(status_code=400, detail="Dataset is empty")

    df = pd.DataFrame(req.data)
    summary = summarize_dataframe(df, req.fileName)
    correlations = correlations_from_dataframe(df)
    charts = charts_from_dataframe(df)

    analysis = call_groq(build_prompt(summary, correlations, charts))

    # Ensure tool-based values are available in the final payload
    analysis.setdefault("correlations", correlations)
    if not analysis.get("charts"):
        analysis["charts"] = charts

    return {"analysis": analysis, "warnings": []}
