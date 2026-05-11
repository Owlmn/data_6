"use client";

import { useRef, useCallback, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

interface FileUploadProps {
  onFileLoaded: (data: Record<string, unknown>[], name: string) => void;
  isLoading: boolean;
}

export default function FileUpload({ onFileLoaded, isLoading }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > 35 * 1024 * 1024) {
        alert("Файл слишком большой. Максимальный размер: 35 МБ.");
        return;
      }

      const ext = file.name.split(".").pop()?.toLowerCase();

      if (ext === "csv") {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: true,
          complete(results) {
            if (results.data && results.data.length > 0) {
              onFileLoaded(results.data as Record<string, unknown>[], file.name);
              setUploadedFileName(file.name);
            }
          },
          error(err) {
            alert("Ошибка парсинга CSV: " + err.message);
          },
        });
        return;
      }

      if (ext === "xlsx" || ext === "xls") {
        try {
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
          if (data.length === 0) {
            alert("Excel файл пуст или не содержит данных");
            return;
          }
          onFileLoaded(data, file.name);
          setUploadedFileName(file.name);
        } catch (err) {
          alert("Ошибка парсинга Excel: " + (err instanceof Error ? err.message : "неизвестная ошибка"));
        }
        return;
      }

      alert("Поддерживаются только CSV и Excel (.xlsx, .xls) файлы");
    },
    [onFileLoaded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="mx-auto max-w-2xl"
    >
      <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 sm:p-8 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/30">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleChange}
          className="hidden"
        />
        <div className="mb-4 text-4xl">📊</div>
        <h3 className="mb-2 text-lg font-semibold text-slate-800">
          {uploadedFileName ? `Загружен: ${uploadedFileName}` : "Загрузите CSV или Excel файл"}
        </h3>
        <p className="mb-4 text-sm text-slate-500">
          Перетащите файл сюда или нажмите кнопку
        </p>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={isLoading}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Анализ..." : uploadedFileName ? "Заменить файл" : "Выбрать файл"}
        </button>
      </div>
    </div>
  );
}
