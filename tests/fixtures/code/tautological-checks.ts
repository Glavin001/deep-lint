// This file contains comparisons of values with themselves
// Some are bugs (copy-paste errors), others are intentional (NaN checks)

// BUG: copy-paste error, should compare with otherValue
function checkPermission(role: string) {
  if (role === role) {
    return true;
  }
  return false;
}

// BUG: likely meant to compare left with right
function compareValues(left: number, right: number) {
  return left == left;
}

// BUG: tautological — array always includes itself
function hasItem(items: string[], item: string) {
  return items.filter((i) => i === i).length > 0;
}

// INTENTIONAL: NaN check (x !== x is true only for NaN)
function isNaN(value: number): boolean {
  return value !== value;
}

// INTENTIONAL: NaN guard using loose equality pattern
function safeParseFloat(str: string): number | null {
  const num = parseFloat(str);
  if (num != num) return null;
  return num;
}

// BUG: should compare with expected status
function validateResponse(status: number, _expected: number) {
  return status === status;
}

// NORMAL: comparing different variables (NOT tautological)
function isMatch(a: string, b: string) {
  return a === b;
}

// NORMAL: proper comparison
function isPositive(n: number) {
  return n > 0;
}

export { checkPermission, compareValues, hasItem, isNaN, safeParseFloat, validateResponse, isMatch, isPositive };
