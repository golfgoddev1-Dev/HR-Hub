import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";

import { decodeUtf8, parseCsv } from "../src/import/csv.js";
import {
  FILE_ERRORS,
  MAX_FILE_BYTES,
  MAX_DATA_ROWS,
  detectKind,
  readTable,
} from "../src/import/file.js";
import {
  SAMPLE_NATIONAL_ID,
  TEMPLATE_HEADERS,
  buildTemplateXlsx,
  parseXlsx,
} from "../src/import/xlsx.js";
import { isValidNationalId } from "../src/import/validate.js";

const HEADER_LINE = TEMPLATE_HEADERS.join(",");

function withCheckDigit(first12) {
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(first12[index]) * (13 - index);
  }
  return `${first12}${(11 - (sum % 11)) % 10}`;
}

const ID_A = withCheckDigit("110170020011");
const ID_B = withCheckDigit("110170020012");

function encode(text) {
  return new TextEncoder().encode(text);
}

function csvFile(rows) {
  return encode([HEADER_LINE, ...rows].join("\n"));
}

test("csv parser handles quotes, commas and CRLF", () => {
  const rows = parseCsv('a,"b,c","d""e"\r\nf,,h\n');
  assert.deepEqual(rows, [
    ["a", "b,c", 'd"e'],
    ["f", "", "h"],
  ]);
});

test("decodeUtf8 rejects binary and strips a BOM", () => {
  assert.equal(decodeUtf8(encode("สวัสดี")), "สวัสดี");
  assert.equal(decodeUtf8(encode("\uFEFFหัวตาราง")), "หัวตาราง");
  assert.equal(decodeUtf8(new Uint8Array([0xff, 0xfe, 0x00])), null);
  assert.equal(decodeUtf8(encode("a\u0000b")), null);
});

test("kind is detected from content, not from the name", () => {
  assert.equal(detectKind(encode("a,b\n1,2")), "csv");
  assert.equal(detectKind(buildTemplateXlsx()), "xlsx");
  assert.equal(detectKind(new Uint8Array([0x00, 0xff, 0x01])), null);
});

test("template contains the six headers and one fake sample row", () => {
  const bytes = buildTemplateXlsx();
  const rows = parseXlsx(bytes);
  assert.deepEqual(rows[0], TEMPLATE_HEADERS);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], "EMP-00000");
  assert.match(rows[1][2], /ตัวอย่าง/);
  assert.equal(isValidNationalId(SAMPLE_NATIONAL_ID), true);
  assert.equal(isValidNationalId(rows[1][5]), true);
});

test("csv and xlsx round-trip with the same rows", () => {
  const rowsCsv = readTable({
    fileName: "employees.csv",
    bytes: csvFile([
      `ABC-00220,นาย,สมชาย,ทดสอบ,ฝ่ายบุคคล,${ID_A}`,
      "",
      `ABC-00221,นาง,สมหญิง,ทดสอบ,ฝ่ายขาย,${ID_B}`,
    ]),
  });
  assert.equal(rowsCsv.ok, true);
  assert.equal(rowsCsv.rows.length, 2);
  assert.equal(rowsCsv.rows[0].rowNumber, 2);
  assert.equal(rowsCsv.rows[1].rowNumber, 4); // blank row 3 skipped

  const rowsXlsx = readTable({ fileName: "employees.xlsx", bytes: buildTemplateXlsx() });
  assert.equal(rowsXlsx.ok, true);
  assert.equal(rowsXlsx.rows.length, 1);
  assert.equal(rowsXlsx.rows[0].cells[0], "EMP-00000");
});

test("whole-file rejections", () => {
  const cases = [
    [{ fileName: "employees.csv", bytes: encode("") }, FILE_ERRORS.empty],
    [{ fileName: "employees.xlsx", bytes: encode(`${HEADER_LINE}\nA,B`) }, FILE_ERRORS.kindMismatch],
    [{ fileName: "employees.xlsm", bytes: buildTemplateXlsx() }, FILE_ERRORS.xlsm],
    [{ fileName: "employees.txt", bytes: csvFile([]) }, FILE_ERRORS.extension],
    [
      { fileName: "employees.csv", bytes: csvFile([`ABC-00220,นาย,ก,ข,ฝ่ายบุคคล,${ID_A}`]).slice(0, 0) },
      FILE_ERRORS.empty,
    ],
    [
      {
        fileName: "employees.csv",
        bytes: encode(
          ["รหัสพนักงาน,ชื่อ,คำนำหน้าชื่อ,สกุล,แผนก,เลขที่บัตรประชาชน", `ABC-00220,สมชาย,นาย,ทดสอบ,ฝ่ายบุคคล,${ID_A}`].join("\n")
        ),
      },
      FILE_ERRORS.header,
    ],
    [
      { fileName: "employees.csv", bytes: encode(`${HEADER_LINE},extra\nABC-00220,นาย,ก,ข,ฝ่ายบุคคล,${ID_A},x`) },
      FILE_ERRORS.headerExtra,
    ],
    [{ fileName: "employees.csv", bytes: encode(HEADER_LINE) }, FILE_ERRORS.noData],
    [
      {
        fileName: "employees.csv",
        bytes: new Uint8Array(MAX_FILE_BYTES + 1).fill(0x41),
      },
      FILE_ERRORS.tooBig,
    ],
  ];

  for (const [input, expected] of cases) {
    const result = readTable(input);
    assert.equal(result.ok, false, input.fileName);
    assert.equal(result.error, expected, input.fileName);
  }
});

test("a workbook with macros is refused", () => {
  const bytes = zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8("<workbook/>"),
    "xl/vbaProject.bin": new Uint8Array([0x01, 0x02]),
    "xl/worksheets/sheet1.xml": strToU8("<worksheet/>"),
  });
  const result = readTable({ fileName: "employees.xlsx", bytes });
  assert.equal(result.ok, false);
  assert.equal(result.error, FILE_ERRORS.macro);
});

test("an external link part is refused", () => {
  const bytes = zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(
      '<workbook xmlns:r="r"><sheets><sheet r:id="rId1"/></sheets></workbook>'
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="https://example.com/x.xml" TargetMode="External"/></Relationships>'
    ),
    "xl/worksheets/sheet1.xml": strToU8("<worksheet/>"),
  });
  const result = readTable({ fileName: "employees.xlsx", bytes });
  assert.equal(result.ok, false);
  assert.equal(result.error, FILE_ERRORS.macro);
});

test("more than 500 data rows is a whole-file rejection", () => {
  const rows = [];
  for (let index = 1; index <= MAX_DATA_ROWS + 1; index += 1) {
    rows.push(`ABC-${String(index).padStart(5, "0")},นาย,ก,ข,ฝ่ายบุคคล,${ID_A}`);
  }
  const result = readTable({ fileName: "employees.csv", bytes: csvFile(rows) });
  assert.equal(result.ok, false);
  assert.equal(result.error, FILE_ERRORS.tooManyRows);
});

test("exactly 500 data rows is accepted", () => {
  const rows = [];
  for (let index = 1; index <= MAX_DATA_ROWS; index += 1) {
    rows.push(`ABC-${String(index).padStart(5, "0")},นาย,ก,ข,ฝ่ายบุคคล,${ID_A}`);
  }
  const result = readTable({ fileName: "employees.csv", bytes: csvFile(rows) });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, MAX_DATA_ROWS);
});
