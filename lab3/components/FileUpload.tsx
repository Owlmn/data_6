"use client";

import { useRef, useState, useCallback } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

interface FileUploadProps {
  onFileLoaded: (data: Record<string, unknown>[], fileName: string) => void;
  isLoading: boolean;
}

export default function FileUpload({ onFileLoaded, isLoading }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const detectDelimiter = (text: string) => {
    const sample = text.split("\n").slice(0, 5).join("\n");
    const delimiters = [
      { char: ";", count: (sample.match(/;/g) || []).length },
      { char: ",", count: (sample.match(/,/g) || []).length },
      { char: "\t", count: (sample.match(/\t/g) || []).length },
      { char: "|", count: (sample.match(/\|/g) || []).length },
    ];
    delimiters.sort((a, b) => b.count - a.count);
    return delimiters[0].count > 0 ? delimiters[0].char : ",";
  };

  const splitSingleColumn = (
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] | null => {
    if (rows.length < 1) return null;
    const colName = Object.keys(rows[0])[0];
    if (!colName) return null;
    const values = rows.map((r) => String(r[colName] ?? ""));

    const candidates = [";", "\t", "|", ","];
    let bestDelim = "";
    let bestFields = 0;

    for (const delim of candidates) {
      const splitValues = values.map((v) => v.split(delim));
      const fieldCounts = splitValues.filter((f) => f.length > 1).map((f) => f.length);
      if (fieldCounts.length < rows.length * 0.5) continue;
      const freq: Record<number, number> = {};
      for (const n of fieldCounts) freq[n] = (freq[n] || 0) + 1;
      const mode = +Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
      if (mode > bestFields) { bestFields = mode; bestDelim = delim; }
    }

    if (bestFields < 2) return null;

    const colNameFields = colName
      .split(bestDelim)
      .map((f) => f.trim().replace(/^["']|["']$/g, ""))
      .filter((f) => f.length > 0);
    const headersFromColName = colNameFields.length === bestFields;

    const splitRows = values.map((v) => {
      const fields = v.split(bestDelim);
      while (fields.length < bestFields) fields.push("");
      return fields.slice(0, bestFields).map((f) => f.trim().replace(/^["']|["']$/g, ""));
    });

    const headers = headersFromColName
      ? colNameFields
      : splitRows[0].map((h, i) => h || `Col_${i + 1}`);
    const dataStart = headersFromColName ? 0 : 1;

    const result: Record<string, unknown>[] = [];
    for (let i = dataStart; i < splitRows.length; i++) {
      const row: Record<string, unknown> = {};
      for (let j = 0; j < headers.length; j++) {
        const val = splitRows[i][j] || "";
        const num = Number(val);
        row[headers[j]] = !isNaN(num) && val !== "" ? num : val;
      }
      result.push(row);
    }
    return result.length > 0 ? result : null;
  };

  const parseCSV = async (file: File): Promise<Record<string, unknown>[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const delimiter = detectDelimiter(text);
        Papa.parse<Record<string, unknown>>(text, {
          header: true,
          skipEmptyLines: true,
          delimiter,
          complete: (results) => {
            let data = results.data;
            if (data.length > 0 && Object.keys(data[0] || {}).length === 1) {
              const split = splitSingleColumn(data);
              if (split) data = split;
            }
            resolve(data);
          },
          error: (error: Error) => reject(error),
        });
      };
      reader.onerror = () => reject(new Error("Ошибка чтения CSV"));
      reader.readAsText(file);
    });
  };

  const parseExcel = async (file: File): Promise<Record<string, unknown>[]> => {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    let jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

    if (jsonData.length > 0 && Object.keys(jsonData[0]).length === 1) {
      const split = splitSingleColumn(jsonData);
      if (split) jsonData = split;
    }
    return jsonData;
  };

  const handleFile = useCallback(
    async (file: File) => {
      try {
        if (file.size > 35 * 1024 * 1024) {
          alert("Максимальный размер файла — 35MB");
          return;
        }
        const extension = file.name.split(".").pop()?.toLowerCase();
        let parsedData: Record<string, unknown>[] = [];

        if (extension === "csv") {
          parsedData = await parseCSV(file);
        } else if (extension === "xlsx" || extension === "xls") {
          parsedData = await parseExcel(file);
        } else {
          alert("Поддерживаются только CSV и Excel файлы");
          return;
        }

        if (!parsedData.length) {
          alert("Файл пуст или не удалось прочитать данные");
          return;
        }

        setUploadedFileName(file.name);
        setInfo(`${Object.keys(parsedData[0]).length} колонок • ${parsedData.length} строк`);
        onFileLoaded(parsedData, file.name);
      } catch (err) {
        console.error(err);
        alert(err instanceof Error ? err.message : "Ошибка загрузки файла");
      }
    },
    [onFileLoaded],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div
      className="mx-auto max-w-2xl"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center transition hover:border-blue-400 hover:bg-blue-50">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={handleChange}
        />
        <h2 className="mb-2 text-lg font-semibold text-slate-800">
          {uploadedFileName ? `Загружен: ${uploadedFileName}` : "Загрузите CSV или Excel"}
        </h2>
        {info && <p className="mb-3 text-sm text-green-600">{info}</p>}
        <p className="mb-5 text-sm text-slate-500">
          Перетащите файл сюда или выберите вручную
        </p>
        <button
          disabled={isLoading}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? "Загрузка..." : uploadedFileName ? "Заменить файл" : "Выбрать файл"}
        </button>
      </div>
    </div>
  );
}
