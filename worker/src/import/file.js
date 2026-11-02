// File-level checks for the employee import: size, real content type,
// whole-file rejection, header order and the 500-row cap.

import { decodeUtf8, parseCsv } from "./csv.js";
import { HEADERS, REASONS, asText, isBlankRow } from "./validate.js";
import { XlsxError, parseXlsx } from "./xlsx.js";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_DATA_ROWS = 500;
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const FILE_ERRORS = {
  empty: "ไฟล์ว่าง",
  tooBig: "ไฟล์ใหญ่เกิน 2 MB",
  extension: "รับเฉพาะไฟล์ .xlsx หรือ .csv",
  xlsm: "ไม่รับไฟล์ .xlsm",
  macro: "ไม่รับไฟล์ที่มี macro, object ฝัง หรือ external link",
  notZip: "ไฟล์ .xlsx ต้องเป็นไฟล์ Excel ที่ถูกต้อง",
  notText: "ไฟล์ .csv ต้องเป็นข้อความ UTF-8",
  kindMismatch: "เนื้อไฟล์ไม่ตรงกับนามสกุล",
  header: "หัวคอลัมน์ไม่ตรงกับเทมเพลต 6 คอลัมน์ตามลำดับ",
  headerExtra: "มีคอลัมน์เกิน 6 คอลัมน์",
  noData: "ไม่พบแถวข้อมูล",
  tooManyRows: `${REASONS.tooManyRows} (สูงสุด ${MAX_DATA_ROWS} แถวต่อครั้ง)`,
};

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function hasZipSignature(bytes) {
  if (!bytes || bytes.length < 4) return false;
  return ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** Reads the real content kind from the bytes, never from the file name. */
export function detectKind(bytes) {
  if (hasZipSignature(bytes)) return "xlsx";
  if (decodeUtf8(bytes) !== null) return "csv";
  return null;
}

function extensionOf(fileName) {
  const match = /\.([a-z0-9]+)$/i.exec(String(fileName ?? "").trim());
  return match ? match[1].toLowerCase() : "";
}

function fail(error) {
  return { ok: false, error };
}

function headerMatches(row) {
  if (!row) return false;
  const trimmed = HEADERS.map((_, index) => asText(row[index]));
  if (row.slice(HEADERS.length).some((cell) => asText(cell) !== "")) return false;
  return trimmed.every((value, index) => value === HEADERS[index]);
}

/**
 * Turns raw upload bytes into data rows: [{ rowNumber, cells }] where
 * rowNumber is the spreadsheet row number (header is row 1).
 * Whole-file problems come back as { ok: false, error }.
 */
export function readTable({ bytes, fileName }) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (data.length === 0) return fail(FILE_ERRORS.empty);
  if (data.length > MAX_FILE_BYTES) return fail(FILE_ERRORS.tooBig);

  const extension = extensionOf(fileName);
  if (extension === "xlsm") return fail(FILE_ERRORS.xlsm);
  if (extension !== "xlsx" && extension !== "csv") return fail(FILE_ERRORS.extension);

  const kind = detectKind(data);
  if (kind === null) {
    return fail(extension === "xlsx" ? FILE_ERRORS.notZip : FILE_ERRORS.notText);
  }
  if (kind !== extension) return fail(FILE_ERRORS.kindMismatch);

  let rawRows;
  if (kind === "xlsx") {
    try {
      rawRows = parseXlsx(data);
    } catch (error) {
      if (error instanceof XlsxError) {
        if (error.code === "macro_or_object" || error.code === "external") {
          return fail(FILE_ERRORS.macro);
        }
        return fail(FILE_ERRORS.notZip);
      }
      return fail(FILE_ERRORS.notZip);
    }
  } else {
    rawRows = parseCsv(decodeUtf8(data));
  }

  const firstContentIndex = rawRows.findIndex((row) => !isBlankRow(row));
  if (firstContentIndex === -1) return fail(FILE_ERRORS.empty);

  const header = rawRows[firstContentIndex];
  if (header.slice(HEADERS.length).some((cell) => asText(cell) !== "")) {
    return fail(FILE_ERRORS.headerExtra);
  }
  if (!headerMatches(header)) return fail(FILE_ERRORS.header);

  const rows = [];
  for (let index = firstContentIndex + 1; index < rawRows.length; index += 1) {
    const cells = rawRows[index];
    if (isBlankRow(cells)) continue;
    if (cells.slice(HEADERS.length).some((cell) => asText(cell) !== "")) {
      return fail(FILE_ERRORS.headerExtra);
    }
    rows.push({ rowNumber: index + 1, cells });
  }

  if (rows.length === 0) return fail(FILE_ERRORS.noData);
  if (rows.length > MAX_DATA_ROWS) return fail(FILE_ERRORS.tooManyRows);

  return { ok: true, rows };
}
