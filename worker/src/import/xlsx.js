// Minimal XLSX reader and template writer.
//
// Reading is defensive: the archive must be a real ZIP, macro sheets,
// embedded objects, ActiveX parts and external links are refused, and only
// inline/shared string cells and numbers are read.
// Writing is used for the download template (headers + one sample row).

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const FORBIDDEN_ENTRY_PATTERNS = [
  /^xl\/vbaProject\.bin$/i,
  /^xl\/macrosheets\//i,
  /^xl\/embeddings\//i,
  /^xl\/externalLinks\//i,
  /^xl\/oleObjects\//i,
  /^xl\/activeX\//i,
  /^xl\/ctrlProps\//i,
];

const EXTERNAL_RELATIONSHIP = /TargetMode\s*=\s*"External"/i;
const EXTERNAL_TYPES = /relationships\/(externalLink|oleObject|package)/i;

export class XlsxError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnIndex(reference) {
  const letters = /^([A-Z]+)/i.exec(String(reference ?? ""));
  if (!letters) return -1;
  let index = 0;
  for (const char of letters[1].toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

function textOfInnerXml(xml) {
  let out = "";
  const pattern = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g;
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    out += decodeXmlEntities(match[1] ?? "");
  }
  return out;
}

function readSharedStrings(entries) {
  const raw = entries["xl/sharedStrings.xml"];
  if (!raw) return [];
  const xml = strFromU8(raw);
  const strings = [];
  const blocks = xml.match(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g) ?? [];
  for (const block of blocks) strings.push(textOfInnerXml(block));
  return strings;
}

function readFirstSheetPath(entries) {
  const workbook = entries["xl/workbook.xml"];
  if (!workbook) return null;
  const workbookXml = strFromU8(workbook);

  const relsRaw = entries["xl/_rels/workbook.xml.rels"];
  const rels = new Map();
  if (relsRaw) {
    const relsXml = strFromU8(relsRaw);
    const relationship = /<Relationship\b([^>]*)\/?>/g;
    let match;
    while ((match = relationship.exec(relsXml)) !== null) {
      const attrs = match[1];
      const id = /Id\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
      const target = /Target\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
      const type = /Type\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? "";
      if (!id || !target) continue;
      if (EXTERNAL_RELATIONSHIP.test(attrs) || EXTERNAL_TYPES.test(type)) {
        throw new XlsxError("external", "external relationship");
      }
      rels.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
    }
  }

  const sheet = /<sheet\b([^>]*)\/?>/.exec(workbookXml);
  if (!sheet) return null;
  const relId = /r:id\s*=\s*"([^"]*)"/.exec(sheet[1])?.[1];
  const target = relId ? rels.get(relId) : null;
  if (target) return `xl/${target.replace(/^\.\//, "")}`;

  // Fallback for workbooks without relationships: the conventional path.
  return "xl/worksheets/sheet1.xml";
}

/**
 * Reads the first worksheet as an array of string rows.
 * Throws XlsxError for unusable or unsafe workbooks.
 */
export function parseXlsx(bytes) {
  let entries;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new XlsxError("not_zip", "not a zip archive");
  }

  const names = Object.keys(entries);
  for (const name of names) {
    if (FORBIDDEN_ENTRY_PATTERNS.some((pattern) => pattern.test(name))) {
      throw new XlsxError("macro_or_object", name);
    }
  }

  const contentTypes = entries["[Content_Types].xml"];
  if (contentTypes && /macroEnabled|vbaProject/i.test(strFromU8(contentTypes))) {
    throw new XlsxError("macro_or_object", "macro content type");
  }

  const sheetPath = readFirstSheetPath(entries);
  if (!sheetPath || !entries[sheetPath]) {
    throw new XlsxError("no_sheet", "missing worksheet");
  }

  const sheetXml = strFromU8(entries[sheetPath]);
  if (/<externalReferences>/i.test(sheetXml)) {
    throw new XlsxError("external", "external reference");
  }

  const shared = readSharedStrings(entries);
  const rows = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(sheetXml)) !== null) {
    const cells = [];
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    let fallbackIndex = 0;

    while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
      const attrs = cellMatch[1] ?? "";
      const inner = cellMatch[2] ?? "";
      const reference = /r\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
      const type = /t\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
      const index = reference ? columnIndex(reference) : fallbackIndex;
      fallbackIndex = index + 1;
      if (index < 0) continue;

      let value = "";
      if (type === "inlineStr") {
        value = textOfInnerXml(inner);
      } else if (type === "s") {
        const sharedIndex = Number(/<v[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? NaN);
        value = Number.isInteger(sharedIndex) ? shared[sharedIndex] ?? "" : "";
      } else if (type === "str") {
        value = decodeXmlEntities(/<v[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
      } else if (type === "b") {
        value = /<v[^>]*>\s*1\s*<\/v>/.test(inner) ? "TRUE" : "FALSE";
      } else {
        value = decodeXmlEntities(/<v[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
      }

      cells[index] = value;
    }

    for (let index = 0; index < cells.length; index += 1) {
      if (cells[index] === undefined) cells[index] = "";
    }
    rows.push(cells);
  }

  return rows;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="นำเข้าพนักงาน" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;

// A fake national ID that passes the check digit. Not a real person.
export const SAMPLE_NATIONAL_ID = "1101700200116";

export const TEMPLATE_HEADERS = [
  "รหัสพนักงาน",
  "คำนำหน้าชื่อ",
  "ชื่อ",
  "สกุล",
  "แผนก",
  "เลขที่บัตรประชาชน",
];

const SAMPLE_ROW = ["EMP-00000", "นาย", "ตัวอย่าง", "ข้อมูลปลอม", "แผนกตัวอย่าง", SAMPLE_NATIONAL_ID];

function cellXml(value, column, rowNumber) {
  const letter = column;
  return `<c r="${letter}${rowNumber}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(
    value
  )}</t></is></c>`;
}

/** Builds the 6-column import template with one clearly-fake example row. */
export function buildTemplateXlsx() {
  const allRows = [TEMPLATE_HEADERS, SAMPLE_ROW];
  const columns = ["A", "B", "C", "D", "E", "F"];

  const rowsXml = allRows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row.map((value, index) => cellXml(value, columns[index], rowNumber)).join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="2" width="16" customWidth="1"/><col min="3" max="3" width="18" customWidth="1"/><col min="4" max="4" width="18" customWidth="1"/><col min="5" max="5" width="22" customWidth="1"/><col min="6" max="6" width="22" customWidth="1"/></cols><sheetData>${rowsXml}</sheetData></worksheet>`;

  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(ROOT_RELS),
      "xl/workbook.xml": strToU8(WORKBOOK),
      "xl/_rels/workbook.xml.rels": strToU8(WORKBOOK_RELS),
      "xl/styles.xml": strToU8(STYLES),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    },
    { level: 6 }
  );
}
