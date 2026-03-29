// This file demonstrates dynamic code execution patterns
// Some are dangerous (user input), others are safe (static/trusted)

// DANGEROUS: eval of user-controlled input
function executeUserCode(userInput) {
  return eval(userInput);
}

// DANGEROUS: eval of data from network request
async function processRemoteScript(url) {
  const response = await fetch(url);
  const script = await response.text();
  return eval(script);
}

// DANGEROUS: eval of URL query parameter
function handleQueryParam(query) {
  const params = new URLSearchParams(query);
  const expr = params.get("expr");
  if (expr) return eval(expr);
  return null;
}

// SAFE: eval of a constant string (build-time code generation)
function createAccessor(fieldName) {
  const sanitized = fieldName.replace(/[^a-zA-Z0-9_]/g, "");
  const code = `(function(obj) { return obj.${sanitized}; })`;
  return eval(code);
}

// SAFE: eval used in test/development tooling
function devConsole(expression) {
  if (process.env.NODE_ENV !== "production") {
    return eval(expression);
  }
  return undefined;
}

// SAFE: JSON.parse (not eval, but structurally similar)
function parseConfig(jsonString) {
  return JSON.parse(jsonString);
}

// DANGEROUS: indirect eval via Function constructor
function dynamicFunction(body) {
  return new Function("x", body);
}

// SAFE: eval of hardcoded math expression
function calculateTax(amount) {
  const formula = "amount * 0.15";
  return eval(formula);
}

module.exports = { executeUserCode, processRemoteScript, handleQueryParam, createAccessor, devConsole, parseConfig, dynamicFunction, calculateTax };
