"use client";

import {
  BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
  PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from "recharts";
import type { Analysis } from "@/lib/dataParser";

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

function ChartRenderer({ chart }: { chart: Record<string, unknown> }) {
  const type = chart.type as string;
  const title = chart.title as string;
  const data = chart.data as Record<string, unknown>[] | undefined;
  const xKey = chart.xKey as string | undefined;
  const yKey = chart.yKey as string | undefined;
  const desc = chart.description as string | undefined;

  if (!data || !xKey) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-500">График «{title}» — недостаточно данных</p>
      </div>
    );
  }

  const renderChart = () => {
    switch (type) {
      case "bar":
        return (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey={yKey || "value"} fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        );
      case "line":
        return (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey={yKey || "value"} stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        );
      case "scatter":
        return (
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
              <YAxis dataKey={yKey || "value"} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Scatter data={data} fill="#3b82f6" />
            </ScatterChart>
          </ResponsiveContainer>
        );
      case "pie":
        return (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={data} dataKey={yKey || "value"} nameKey={xKey} cx="50%" cy="50%" outerRadius={70}>
                {data.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        );
      default:
        return (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey={yKey || "value"} fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h4 className="mb-1 text-sm font-semibold text-slate-800">{title}</h4>
      {desc && <p className="mb-3 text-xs text-slate-500">{desc}</p>}
      {renderChart()}
    </div>
  );
}

const importanceColors: Record<string, string> = {
  high: "border-rose-200 bg-rose-50",
  medium: "border-amber-200 bg-amber-50",
  low: "border-slate-200 bg-slate-50",
};

const importanceBadge: Record<string, string> = {
  high: "bg-rose-100 text-rose-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};

export default function AnalysisResults({ analysis }: { analysis: Analysis }) {
  const isError = analysis.isError;

  return (
    <div className="space-y-6">
      <section className={`rounded-lg border p-3 sm:p-5 ${isError ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
        <h2 className={`mb-2 text-lg font-semibold ${isError ? "text-red-800" : "text-slate-900"}`}>
          {isError ? "Ошибка выполнения" : "Обзор"}
        </h2>
        <pre className={`text-sm leading-relaxed whitespace-pre-wrap ${isError ? "text-red-700" : "text-slate-700"}`}>
          {analysis.overview}
        </pre>
      </section>

      {analysis.keyMetrics && analysis.keyMetrics.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Ключевые метрики</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {analysis.keyMetrics.map((m, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{m.label}</p>
                <p className="mt-1 text-xl sm:text-2xl font-bold text-slate-900">{m.value}</p>
                <p className="mt-1 text-xs text-slate-500">{m.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {analysis.insights && analysis.insights.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Инсайты</h2>
          <div className="space-y-3">
            {analysis.insights.map((ins, i) => (
              <div key={i} className={`rounded-lg border p-4 ${importanceColors[ins.importance]}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">{ins.title}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${importanceBadge[ins.importance]}`}>
                    {ins.importance === "high" ? "Важно" : ins.importance === "medium" ? "Средне" : "Низко"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{ins.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {analysis.correlations && analysis.correlations.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Корреляции</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="pb-2 pr-4 font-semibold text-slate-700">Колонка 1</th>
                  <th className="pb-2 pr-4 font-semibold text-slate-700">Колонка 2</th>
                  <th className="pb-2 pr-4 font-semibold text-slate-700">Сила</th>
                  <th className="pb-2 pr-4 font-semibold text-slate-700">Направление</th>
                  <th className="pb-2 font-semibold text-slate-700">Описание</th>
                </tr>
              </thead>
              <tbody>
                {analysis.correlations.map((c, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 pr-4 font-medium text-slate-800">{c.col1}</td>
                    <td className="py-2 pr-4 font-medium text-slate-800">{c.col2}</td>
                    <td className="py-2 pr-4 text-slate-600">{c.strength}</td>
                    <td className="py-2 pr-4 text-slate-600">{c.direction}</td>
                    <td className="py-2 text-slate-600">{c.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {analysis.charts && analysis.charts.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Графики</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {analysis.charts.map((chart, i) => (
              <ChartRenderer key={i} chart={chart} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
