export interface ColumnInfo {
  name: string;
  type: "numeric" | "text" | "date" | "boolean" | "unknown";
  nullCount: number;
  uniqueCount: number;
  sampleValues: string[];
}

export interface Analysis {
  overview: string;
  keyMetrics: { label: string; value: string; description: string }[];
  insights: { title: string; description: string; importance: "high" | "medium" | "low" }[];
  correlations?: {
    col1: string;
    col2: string;
    strength: string;
    direction: string;
    description: string;
  }[];
  charts?: Record<string, unknown>[];
  recommendations?: string[];
}

export interface DataSummary {
  fileName: string;
  rows: number;
  columns: ColumnInfo[];
  previewRows: Record<string, unknown>[];
  fullData: Record<string, unknown>[];
  analysis: Analysis | null;
  analysisMessage: string;
  timestamp: number;
}

export function summarizeData(
  data: Record<string, unknown>[],
  fileName: string
): DataSummary {
  const columns = Object.keys(data[0] || {});

  const columnInfos: ColumnInfo[] = columns.map((col) => {
    const values = data.map((row) => row[col]);
    const nonNull = values.filter(
      (v) => v !== null && v !== undefined && v !== ""
    );
    const unique = new Set(nonNull.map(String));

    let type: ColumnInfo["type"] = "unknown";
    if (nonNull.length > 0) {
      const numericCount = nonNull.filter(
        (v) => !isNaN(Number(v)) && String(v).trim() !== ""
      ).length;
      const booleanCount = nonNull.filter(
        (v) => ["true", "false", "0", "1", "yes", "no"].includes(
          String(v).toLowerCase()
        )
      ).length;
      const dateCount = nonNull.filter((v) => {
        const s = String(v);
        return !isNaN(Date.parse(s)) && s.length > 4;
      }).length;

      const ratio = numericCount / nonNull.length;
      const boolRatio = booleanCount / nonNull.length;
      const dateRatio = dateCount / nonNull.length;

      if (ratio > 0.8) type = "numeric";
      else if (boolRatio > 0.8) type = "boolean";
      else if (dateRatio > 0.6) type = "date";
      else type = "text";
    }

    return {
      name: col,
      type,
      nullCount: values.length - nonNull.length,
      uniqueCount: unique.size,
      sampleValues: Array.from(unique).slice(0, 3).map(String),
    };
  });

  const previewRows = data.slice(0, 5);

  return {
    fileName,
    rows: data.length,
    columns: columnInfos,
    previewRows,
    fullData: data,
    analysis: null,
    analysisMessage: "",
    timestamp: Date.now(),
  };
}
