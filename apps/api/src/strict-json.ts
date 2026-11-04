// JSON.parse silently accepts what ADR-008 forbids for clinical input: exponent
// notation (1e-400 becomes 0) and duplicate keys (last wins). JSON.parse has
// already lost both by the time it returns, so a scan of the text runs first.

const badBody = () =>
  Object.assign(new Error("Invalid JSON body."), {
    code: "FST_ERR_CTP_INVALID_JSON_BODY",
    statusCode: 400,
  });

const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor"]);

// Throws a fixed error (never the parser's text, which can quote the body).
export function strictJsonParse(text: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw badBody();
  }
  // The text is valid JSON from here on, so the scan can stay simple.
  const stack: (Set<string> | null)[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      let k = j + 1;
      while (k < text.length && " \t\r\n".includes(text[k] as string)) k++;
      const keys = stack[stack.length - 1];
      if (keys && text[k] === ":") {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (keys.has(key) || FORBIDDEN_KEYS.has(key)) throw badBody();
        keys.add(key);
      }
      i = j + 1;
    } else if (c === "{") {
      stack.push(new Set());
      i++;
    } else if (c === "[") {
      stack.push(null);
      i++;
    } else if (c === "}" || c === "]") {
      stack.pop();
      i++;
    } else if (c === "-" || (c >= "0" && c <= "9")) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(text) as RegExpExecArray;
      if (/[eE]/.test(m[0])) throw badBody();
      i += m[0].length;
    } else {
      i++;
    }
  }
  return value;
}
