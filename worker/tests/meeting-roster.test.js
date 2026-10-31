import test from "node:test";
import assert from "node:assert/strict";

import {
  escapeIlike,
  isValidSearchQuery,
  normalizeSearchQuery,
  sortThai,
} from "../src/meeting-roster.js";

// --- normalizeSearchQuery -----------------------------------------------------

test("normalizeSearchQuery trims and collapses whitespace runs", () => {
  assert.equal(normalizeSearchQuery("  สมชาย  ใจดี  "), "สมชาย ใจดี");
  assert.equal(normalizeSearchQuery("a\t\tb\nc"), "a b c");
  assert.equal(normalizeSearchQuery("abc"), "abc");
});

test("normalizeSearchQuery rejects non-strings as empty", () => {
  for (const value of [undefined, null, 1, {}, []]) {
    assert.equal(normalizeSearchQuery(value), "");
  }
});

test("isValidSearchQuery requires two characters after normalization", () => {
  assert.equal(isValidSearchQuery("  a  "), false);
  assert.equal(isValidSearchQuery("a"), false);
  assert.equal(isValidSearchQuery("") , false);
  assert.equal(isValidSearchQuery("ส"), false);
  assert.equal(isValidSearchQuery("สม"), true);
  assert.equal(isValidSearchQuery(" a b "), true);
});

// --- escapeIlike ---------------------------------------------------------------

test("escapeIlike escapes backslash, percent and underscore", () => {
  assert.equal(escapeIlike("a%b_c\\d"), "a\\%b\\_c\\\\d");
  assert.equal(escapeIlike("%_%"), "\\%\\_\\%");
  assert.equal(escapeIlike("\\\\"), "\\\\\\\\");
});

test("escapeIlike leaves other characters alone", () => {
  assert.equal(escapeIlike("สมชาย (ก), B1"), "สมชาย (ก), B1");
  assert.equal(escapeIlike(""), "");
});

// --- sortThai ------------------------------------------------------------------

test("sortThai orders names by Thai collation on fullName", () => {
  const input = [
    { fullName: "สมชาย ใจดี" },
    { fullName: "ขจร เดือนดี" },
    { fullName: "อำพล แก้วมงคล" },
    { fullName: "กมล วงขาว" },
  ];
  const sorted = sortThai(input);
  assert.deepEqual(
    sorted.map((row) => row.fullName),
    ["กมล วงขาว", "ขจร เดือนดี", "สมชาย ใจดี", "อำพล แก้วมงคล"]
  );
});

test("sortThai does not mutate the input list", () => {
  const input = [
    { fullName: "สมชาย ใจดี" },
    { fullName: "ขจร เดือนดี" },
  ];
  const copy = [...input];
  sortThai(input);
  assert.deepEqual(input, copy);
});
