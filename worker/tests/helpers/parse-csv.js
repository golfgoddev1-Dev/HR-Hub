// Test-only CSV parser: the browser parses real files; tests use this to build
// the rows it would send.

/**
 * RFC 4180 style parser: quoted fields, escaped double quotes, CRLF or LF,
 * trailing empty line ignored. Returns an array of string arrays.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let index = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      pushField();
      index += 1;
      continue;
    }
    if (char === "\r") {
      if (text[index + 1] === "\n") index += 1;
      pushRow();
      index += 1;
      continue;
    }
    if (char === "\n") {
      pushRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field.length > 0 || row.length > 0) pushRow();

  // Drop trailing completely-empty rows produced by a final line break.
  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell.trim() === "")) {
    rows.pop();
  }
  return rows;
}
