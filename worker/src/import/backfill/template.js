// Download template for the historical attendance import: headers A-L exactly
// as the reader expects, plus one clearly fake example row.

import { buildSheetXlsx } from "../xlsx.js";
import { BACKFILL_HEADERS } from "./validate.js";

const SAMPLE_ROW = [
  "ประชุมหัวหน้างาน",
  "01/10/2026",
  "09:00",
  "ห้องประชุมตัวอย่าง",
  "นาย ตัวอย่าง ข้อมูลปลอม",
  "เข้าร่วมประชุม",
  "",
  "",
  "",
  "",
  "",
  "",
];

export function buildBackfillTemplateXlsx() {
  return buildSheetXlsx({
    sheetName: "นำเข้าข้อมูลย้อนหลัง",
    headers: BACKFILL_HEADERS,
    rows: [SAMPLE_ROW],
    widths: [26, 14, 8, 24, 30, 16, 10, 22, 22, 16, 14, 32],
  });
}

export default buildBackfillTemplateXlsx;