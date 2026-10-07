/** Saves text as a file via a temporary link. CSVs get a BOM so Excel reads them as UTF-8. */
export function downloadText(filename: string, text: string, type: string) {
  const body = type === 'text/csv' ? '﻿' + text : text;
  const url = URL.createObjectURL(new Blob([body], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const today = () => new Date().toISOString().slice(0, 10);
