// =============================================================================
// WHAT THIS FILE IS
//   Small helpers for creating a CSV file and downloading it in the browser.
// WHY IT EXISTS
//   Used by "Export users" and "Download failed/skipped rows". Values are
//   quoted correctly so names with commas or quotes don't break the file.
//   Formula-looking values (=, +, -, @) are prefixed with ' so Excel won't run
//   them as formulas (CSV injection).
// USED BY
//   pages/UserManagement/*
// =============================================================================

function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
}

export function downloadCsv(filename: string, csv: string): void {
  // The BOM makes Excel open UTF-8 correctly (Hindi names, ₹ etc.).
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
