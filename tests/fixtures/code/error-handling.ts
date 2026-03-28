// VIOLATION: Empty catch block — error swallowed silently
export function swallowedError() {
  try {
    JSON.parse("invalid");
  } catch (err) { }
}

// VIOLATION: Catch with only a comment — error still swallowed
export function commentOnly() {
  try {
    JSON.parse("invalid");
  } catch (err) {
    // TODO: handle this later
  }
}

// CLEAN: Catch that logs the error
export function loggedError() {
  try {
    JSON.parse("invalid");
  } catch (err) {
    console.error("Parse failed:", err);
  }
}

// CLEAN: Catch that rethrows
export function rethrownError() {
  try {
    JSON.parse("invalid");
  } catch (err) {
    throw new Error("JSON parse failed", { cause: err });
  }
}

// CLEAN: Catch that returns an error value
export function handledError(): { ok: boolean; error?: string } {
  try {
    JSON.parse("invalid");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// VIOLATION: Catch that only assigns to unused variable
export function assignOnly() {
  try {
    JSON.parse("invalid");
  } catch (err) {
    const ignored = err;
  }
}

// CLEAN: Catch with meaningful error handling logic
export function complexHandler() {
  try {
    JSON.parse("invalid");
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.warn("Invalid JSON input");
    } else {
      throw err;
    }
  }
}
