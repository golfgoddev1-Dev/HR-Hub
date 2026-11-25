// Row checks for the employee import. The browser parses the workbook or CSV
// and sends { fileName, rows: [{ rowNumber, cells }] }; this module checks the
// rows against the six-column template and the 500-row cap.

import { HEADERS, REASONS, asText } from "./validate.js";

export const MAX_DATA_ROWS = 500;
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const FILE_ERRORS = {
  empty: "ไฟล์ว่าง",
  tooBig: "ไฟล์ใหญ่เกิน 2 MB",
  extension: "รับเฉพาะไฟล์ .xlsx หรือ .csv",
  xlsm: "ไม่รับไฟล์ .xlsm",
  header: "หัวคอลัมน์ไม่ตรงกับเทมเพลต 6 คอลัมน์ตามลำดับ",
  headerExtra: "มีคอลัมน์เกิน 6 คอลัมน์",
  noData: "ไม่พบแถวข้อมูล",
  tooManyRows: `${REASONS.tooManyRows} (สูงสุด ${MAX_DATA_ROWS} แถวต่อครั้ง)`,
};

function headerMatches(cells) {
  if (cells.slice(HEADERS.length).some((cell) => asText(cell) !== "")) return false;
  return HEADERS.every((header, index) => asText(cells[index]) === header);
}

/**
 * Checks non-blank rows sent by the browser, header first. Returns
 * { ok: true, rows: [{ rowNumber, cells }] } for data rows, or { ok: false, error }.
 */
export function tableFromRows(entries) {
  if (entries.length === 0) return { ok: false, error: FILE_ERRORS.empty };

  const [header, ...data] = entries;
  if (header.cells.slice(HEADERS.length).some((cell) => asText(cell) !== "")) {
    return { ok: false, error: FILE_ERRORS.headerExtra };
  }
  if (!headerMatches(header.cells)) return { ok: false, error: FILE_ERRORS.header };

  const rows = [];
  for (const entry of data) {
    if (entry.cells.slice(HEADERS.length).some((cell) => asText(cell) !== "")) {
      return { ok: false, error: FILE_ERRORS.headerExtra };
    }
    rows.push({ rowNumber: entry.rowNumber, cells: entry.cells });
  }

  if (rows.length === 0) return { ok: false, error: FILE_ERRORS.noData };
  if (rows.length > MAX_DATA_ROWS) return { ok: false, error: FILE_ERRORS.tooManyRows };
  return { ok: true, rows };
}
