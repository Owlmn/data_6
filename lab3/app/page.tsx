"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import FileUpload from "@/components/FileUpload";
import AnalysisResults from "@/components/AnalysisResults";
import { summarizeData, toPersisted, type DataSummary, type PersistedSummary, type Analysis } from "@/lib/dataParser";
import { sanitizeUserInput } from "@/lib/sanitize";

interface CacheEntry {
  fileHash: string;
  message: string;
  analysis: Analysis;
  timestamp: number;
}

function makeFileHash(s: DataSummary | PersistedSummary): string {
  const cols = s.columns.map((c) => `${c.name}:${c.type}`).join(",");
  return `${s.fileName}_${s.rows}_${cols}`;
}

export default function Home() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<DataSummary[]>([]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [userMessage, setUserMessage] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string>("");

  const requestIdRef = useRef(0);
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const dataMapRef = useRef<Map<string, Record<string, unknown>[]>>(new Map());

  const pythonUrl = process.env.NEXT_PUBLIC_PYTHON_URL || "http://localhost:8000";

  useEffect(() => {
    try {
      const cached = localStorage.getItem("analysis_cache");
      if (cached) {
        JSON.parse(cached).forEach((e: CacheEntry) => {
          cacheRef.current.set(e.fileHash + "_" + e.message, e);
        });
      }
      const saved = localStorage.getItem("datasets_history");
      if (saved) {
        const h = JSON.parse(saved) as PersistedSummary[];
        const restored: DataSummary[] = h.map((p) => ({ ...p, fullData: undefined }));
        setHistory(restored);
        if (restored.length > 0) {
          setActiveIdx(0);
          if (restored[0].analysis) setAnalysis(restored[0].analysis);
        }
      }
    } catch {}
  }, []);

  const persistHistory = useCallback((items: DataSummary[]) => {
    try {
      const stripped = items.map(toPersisted);
      localStorage.setItem("datasets_history", JSON.stringify(stripped));
    } catch {}
  }, []);

  const runAnalysis = useCallback(
    async (idx: number, message: string) => {
      const summary = history[idx];
      if (!summary) return;

      const fileHash = makeFileHash(summary);
      const data = dataMapRef.current.get(fileHash);
      if (!data) {
        setError("Данные не найдены в памяти. Перезагрузите файл.");
        return;
      }

      const currentId = ++requestIdRef.current;
      setAnalysis(null);
      setError(null);
      setAgentStatus("Отправляю запрос агенту...");
      setIsLoading(true);

      const cacheKey = fileHash + "_" + message;

      const cached = cacheRef.current.get(cacheKey);
      if (cached) {
        setAnalysis(cached.analysis);
        setHistory((prev) => {
          const u = [...prev];
          if (u[idx]) u[idx] = { ...u[idx], analysis: cached.analysis, analysisMessage: message };
          persistHistory(u);
          return u;
        });
        setIsLoading(false);
        setAgentStatus("");
        return;
      }

      try {
        const columnSummary = summary.columns
          .map((c) => `${c.name}: ${c.type === "numeric" ? "number" : "string"}`)
          .join("\n");

        setAgentStatus("LLM-агент генерирует и выполняет код...");

        const res = await fetch(`${pythonUrl}/api/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            column_summary: columnSummary,
            message,
            dataset: JSON.stringify({ fileName: summary.fileName, rows: data }),
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(
            (errBody as Record<string, string>).detail ||
            (errBody as Record<string, string>).error ||
            `Agent error ${res.status}`
          );
        }

        const result = await res.json() as Analysis & { iterations?: number };

        if (result.iterations) {
          setAgentStatus(`Анализ завершён за ${result.iterations} итераций`);
        } else {
          setAgentStatus("");
        }

        const analysisResult: Analysis = {
          overview: result.overview || "Пустой результат",
          keyMetrics: result.keyMetrics || [],
          insights: result.insights || [],
          correlations: result.correlations || [],
          charts: result.charts || [],
          isError: result.isError || false,
        };

        if (currentId !== requestIdRef.current) return;

        setAnalysis(analysisResult);

        setHistory((prev) => {
          const u = [...prev];
          if (u[idx]) u[idx] = { ...u[idx], analysis: analysisResult, analysisMessage: message };
          persistHistory(u);
          return u;
        });

        const entry: CacheEntry = { fileHash, message, analysis: analysisResult, timestamp: Date.now() };
        cacheRef.current.set(cacheKey, entry);
        try {
          const entries = Array.from(cacheRef.current.values())
            .sort((x, y) => y.timestamp - x.timestamp)
            .slice(0, 20);
          localStorage.setItem("analysis_cache", JSON.stringify(entries));
        } catch {}

      } catch (e) {
        if (currentId !== requestIdRef.current) return;
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        setAnalysis({
          overview: msg,
          keyMetrics: [],
          insights: [],
          charts: [],
          isError: true,
        });
      } finally {
        if (currentId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [persistHistory, history, pythonUrl],
  );

  const handleFileLoaded = useCallback(
    (data: Record<string, unknown>[], name: string) => {
      const summary = summarizeData(data, name);
      dataMapRef.current.set(makeFileHash(summary), data);
      setHistory((prev) => {
        const nh = [...prev, summary];
        setActiveIdx(nh.length - 1);
        setUserMessage("");
        setAnalysis(null);
        setError(null);
        setAgentStatus("");
        persistHistory(nh);
        return nh;
      });
    },
    [persistHistory],
  );

  const handleSelect = useCallback(
    (idx: number) => {
      setActiveIdx(idx);
      if (history[idx]) {
        setAnalysis(history[idx].analysis ?? null);
        setUserMessage(history[idx].analysisMessage ?? "");
        setError(null);
        setAgentStatus("");
      }
    },
    [history],
  );

  const handleDelete = useCallback(
    (idx: number, e: React.MouseEvent) => {
      e.stopPropagation();
      setHistory((prev) => {
        const nh = prev.filter((_, i) => i !== idx);
        const removed = prev[idx];
        if (removed) dataMapRef.current.delete(makeFileHash(removed));
        persistHistory(nh);
        if (nh.length === 0) {
          setActiveIdx(null);
          setAnalysis(null);
          setUserMessage("");
          setError(null);
          setAgentStatus("");
        } else if (activeIdx !== null) {
          if (activeIdx >= nh.length) {
            const newIdx = nh.length - 1;
            setActiveIdx(newIdx);
            setAnalysis(nh[newIdx].analysis ?? null);
            setUserMessage(nh[newIdx].analysisMessage ?? "");
          } else if (activeIdx === idx) {
            const newIdx = Math.min(idx, nh.length - 1);
            setActiveIdx(newIdx);
            setAnalysis(nh[newIdx].analysis ?? null);
            setUserMessage(nh[newIdx].analysisMessage ?? "");
          }
        }
        return nh;
      });
    },
    [activeIdx, persistHistory],
  );

  const handleAnalyze = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (activeIdx === null || !history[activeIdx]) return;
      const sanitized = sanitizeUserInput(userMessage);
      if (sanitized.flagged) {
        console.warn("[Sanitize] Prompt injection detected in user message");
      }
      runAnalysis(activeIdx, sanitized.sanitized);
    },
    [activeIdx, history, userMessage, runAnalysis],
  );

  const active = activeIdx !== null ? history[activeIdx] : null;

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur px-4 py-3 sm:px-6 md:pl-64">
        <div className="flex items-center justify-between max-w-5xl mx-auto w-full gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="md:hidden shrink-0 rounded p-1 hover:bg-slate-100"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Меню"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d={sidebarOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl truncate">Data Analyst AI</h1>
              <p className="text-xs text-slate-500 sm:text-sm truncate">
                Загрузите файл (.csv, .xlsx) — AI проведёт анализ, посчитает метрики и покажет графики
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 relative">
        {sidebarOpen && (
          <div className="md:hidden fixed inset-0 z-10 bg-black/30" onClick={() => setSidebarOpen(false)} />
        )}

        <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-slate-50 flex flex-col border-r border-slate-200 transform transition-transform md:relative md:z-0 md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h2 className="text-base font-bold text-slate-700">Чаты</h2>
            <button className="md:hidden rounded p-1 hover:bg-slate-200" onClick={() => setSidebarOpen(false)}>
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto">
            {history.length === 0 && (
              <div className="px-4 py-6 text-slate-400 text-sm">Нет загруженных датасетов</div>
            )}
            <ul>
              {history.map((item, idx) => (
                <li key={idx} className="group relative">
                  <button
                    className={`w-full text-left px-4 py-3 pr-10 border-b border-slate-100 hover:bg-blue-100/40 transition-colors ${activeIdx === idx ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-700"}`}
                    onClick={() => { handleSelect(idx); setSidebarOpen(false); }}
                  >
                    <div className="truncate">{item.fileName}</div>
                    <div className="text-xs text-slate-500 flex gap-2 mt-1">
                      <span>Строк: {item.rows}</span>
                      <span>Колонок: {item.columns.length}</span>
                      {item.analysis && <span className="text-green-600">Анализ</span>}
                    </div>
                  </button>
                  <button
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition-all"
                    onClick={(e) => handleDelete(idx, e)}
                    title="Удалить чат"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main className="flex-1 px-3 py-4 sm:px-6 sm:py-6 min-w-0">
          <FileUpload onFileLoaded={handleFileLoaded} isLoading={isLoading} />

          {active && !isLoading && (
            <form onSubmit={handleAnalyze} className="mx-auto mt-6 max-w-3xl flex flex-col gap-3">
              <label className="text-sm text-slate-700 font-medium">
                {analysis ? "Задайте уточняющий вопрос к этому датасету" : "Инструкция для анализа (необязательно)"}
              </label>
              <textarea
                className="w-full rounded border border-slate-300 p-2 text-sm min-h-[60px]"
                placeholder={analysis
                  ? "Например: покажи топ-5 по выручке, построй гистограмму по месяцам..."
                  : "Напишите, на что обратить внимание при анализе..."}
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                disabled={isLoading}
              />
              <button
                type="submit"
                className="self-end rounded bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={isLoading}
              >
                {analysis ? "Задать вопрос" : "Отправить на анализ"}
              </button>
            </form>
          )}

          {isLoading && (
            <div className="mt-6 text-center">
              <div className="inline-flex flex-col items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
                  <span className="text-sm font-medium text-slate-700">
                    {agentStatus || "Deepseek анализирует данные..."}
                  </span>
                </div>
                <span className="text-xs text-slate-400">
                  Агент автоматически исправляет ошибки и повторяет запросы
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="mx-auto mt-6 max-w-2xl rounded-lg border border-rose-200 bg-rose-50 p-4 text-slate-800">
              <p className="font-semibold">Ошибка анализа</p>
              <p className="mt-2 text-sm text-slate-600">{error}</p>
            </div>
          )}

          {active && !isLoading && (
            <div className="mx-auto mt-6 max-w-3xl">
              <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-slate-500">Файл</p>
                    <h3 className="text-base font-semibold text-slate-900 sm:text-lg truncate">{active.fileName}</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center sm:gap-4">
                    <div>
                      <p className="text-xl font-semibold sm:text-2xl">{active.rows.toLocaleString()}</p>
                      <p className="text-xs text-slate-500">строк</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold sm:text-2xl">{active.columns.length}</p>
                      <p className="text-xs text-slate-500">колонок</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold sm:text-2xl">{active.columns.filter((c) => c.type === "numeric").length}</p>
                      <p className="text-xs text-slate-500">числовых</p>
                    </div>
                  </div>
                </div>
                <div className="mt-6">
                  <p className="mb-2 text-sm text-slate-500">Первые 5 строк датасета:</p>
                  <div className="overflow-x-auto rounded border border-slate-100">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr>
                          {active.columns.map((col) => (
                            <th key={col.name} className="px-2 py-1 font-semibold text-slate-700 border-b border-slate-100 bg-slate-50">
                              {col.name} <span className="text-slate-400">({col.type})</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {active.previewRows.map((row, i) => (
                          <tr key={i}>
                            {active.columns.map((col) => (
                              <td key={col.name} className="px-2 py-1 border-b border-slate-50 text-slate-800">
                                {String(row[col.name] ?? "")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {analysis && <AnalysisResults analysis={analysis} />}
        </main>
      </div>
    </div>
  );
}
