import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";

import {
  FILE_ERRORS,
  MAX_DATA_ROWS,
  tableFromRows,
} from "../src/import/file.js";
import { SAMPLE_NATIONAL_ID, TEMPLATE_HEADERS, buildTemplateXlsx, parseXlsx, XlsxError } from "../src/import/xlsx.js";

function withCheckDigit(first12) {
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(first12[index]) * (13 - index);
  }
  return `${first12}${(11 - (sum % 11)) % 10}`;
}

const ID_A = withCheckDigit("110170020011");

function entriesOf(lines, header = TEMPLATE_HEADERS) {
  return [header, ...lines].map((cells, index) => ({ rowNumber: index + 1, cells }));
}

test("whole-table rejections", () => {
  const cases = [
    [[], FILE_ERRORS.empty],
    [
      [
        { rowNumber: 1, cells: [...TEMPLATE_HEADERS, "extra"] },
        { rowNumber: 2, cells: ["ABC-00220", "นาย", "ก", "ข", "ฝ่ายบุคคล", ID_A] },
      ],
      FILE_ERRORS.headerExtra,
    ],
    [
      [
        { rowNumber: 1, cells: TEMPLATE_HEADERS },
        { rowNumber: 2, cells: ["ABC-00220", "นาย", "ก", "ข", "ฝ่ายบุคคล", ID_A, "x"] },
      ],
      FILE_ERRORS.headerExtra,
    ],
    [entriesOf([]), FILE_ERRORS.noData],
    [
      entriesOf(
        [["ABC-00220", "สมชาย", "นาย", "ทดสอบ", "ฝ่ายบุคคล", ID_A]],
        ["รหัสพนักงาน", "ชื่อ", "คำนำหน้าชื่อ", "สกุล", "แผนก", "เลขที่บัตรประชาชน"]
      ),
      FILE_ERRORS.header,
    ],
  ];

  for (const [entries, expected] of cases) {
    const result = tableFromRows(entries);
    assert.equal(result.ok, false);
    assert.equal(result.error, expected);
  }
});

test("row numbers survive a blank row in the sheet", () => {
  const result = tableFromRows([
    { rowNumber: 1, cells: TEMPLATE_HEADERS },
    { rowNumber: 4, cells: ["ABC-00220", "นาย", "ก", "ข", "ฝ่ายบุคคล", ID_A] },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].rowNumber, 4);
});

test("more than 500 data rows is a whole-table rejection", () => {
  const lines = [];
  for (let index = 1; index <= MAX_DATA_ROWS + 1; index += 1) {
    lines.push(["ABC-" + String(index).padStart(5, "0"), "นาย", "ก", "ข", "ฝ่ายบุคคล", ID_A]);
  }
  const result = tableFromRows(entriesOf(lines));
  assert.equal(result.ok, false);
  assert.equal(result.error, FILE_ERRORS.tooManyRows);
});

test("exactly 500 data rows is accepted", () => {
  const lines = [];
  for (let index = 1; index <= MAX_DATA_ROWS; index += 1) {
    lines.push(["ABC-" + String(index).padStart(5, "0"), "นาย", "ก", "ข", "ฝ่ายบุคคล", ID_A]);
  }
  const result = tableFromRows(entriesOf(lines));
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, MAX_DATA_ROWS);
});

test("the template parses on the server with its sample row", () => {
  const rows = parseXlsx(buildTemplateXlsx());
  assert.deepEqual(rows[0], TEMPLATE_HEADERS);
  assert.equal(rows[1][5], SAMPLE_NATIONAL_ID);
});

test("a workbook with macros is refused", () => {
  const bytes = zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8("<workbook/>"),
    "xl/vbaProject.bin": new Uint8Array([0x01, 0x02]),
    "xl/worksheets/sheet1.xml": strToU8("<worksheet/>"),
  });
  assert.throws(() => parseXlsx(bytes), (error) => error instanceof XlsxError && error.code === "macro_or_object");
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
  assert.throws(() => parseXlsx(bytes), (error) => error instanceof XlsxError && error.code === "external");
});

test("parseXlsx refuses an archive that inflates past the size cap", async () => {
  const bomb = zipSync({ "xl/worksheets/sheet1.xml": new Uint8Array(9 * 1024 * 1024) });
  assert.ok(bomb.length < 100 * 1024, "the fixture must stay tiny when compressed");
  assert.throws(() => parseXlsx(bomb), (error) => error instanceof XlsxError && error.code === "too_large");
});
