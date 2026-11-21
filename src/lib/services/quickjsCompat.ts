type TokenType = "ident" | "punct" | "string" | "template" | "regex" | "number";

type Token = {
  type: TokenType;
  value: string;
  start: number;
  end: number;
};

const REGEX_PREV_KEYWORDS = new Set([
  "return",
  "throw",
  "case",
  "delete",
  "void",
  "typeof",
  "yield",
  "await",
  "in",
  "of",
  "instanceof",
  "new",
  "do",
  "else",
]);

const REGEX_PREV_PUNCT = new Set([
  "(",
  "[",
  "{",
  ",",
  ";",
  ":",
  "?",
  "=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
  "~",
  "&",
  "|",
  "^",
  "<",
  ">",
  "=>",
]);

const STATEMENT_LIST_PREV = new Set(["{", ";", "}"]);

function isIdentStart(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 36 ||
    code >= 128
  );
}

function isIdentPart(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return isIdentStart(ch) || (code >= 48 && code <= 57);
}

function canStartRegex(prev: Token | undefined): boolean {
  if (!prev) return true;
  if (prev.type === "ident") return REGEX_PREV_KEYWORDS.has(prev.value);
  if (prev.type === "punct") {
    return REGEX_PREV_PUNCT.has(prev.value) || prev.value.endsWith("=");
  }
  return false;
}

function scanString(code: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return code.length;
}

function scanRegex(code: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") {
      inClass = true;
    } else if (ch === "]") {
      inClass = false;
    } else if (ch === "/" && !inClass) {
      i += 1;
      while (i < code.length && isIdentPart(code[i])) i += 1;
      return i;
    } else if (ch === "\n" || ch === "\r") {
      return i;
    }
    i += 1;
  }
  return code.length;
}

function scanTemplate(code: string, start: number): number {
  let i = start + 1;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return i + 1;
    if (ch === "$" && code[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < code.length && depth > 0) {
        const inner = code[i];
        if (inner === "'" || inner === '"') {
          i = scanString(code, i, inner);
        } else if (inner === "`") {
          i = scanTemplate(code, i);
        } else if (inner === "/" && code[i + 1] === "/") {
          const nl = code.indexOf("\n", i + 2);
          i = nl === -1 ? code.length : nl + 1;
        } else if (inner === "/" && code[i + 1] === "*") {
          const end = code.indexOf("*/", i + 2);
          i = end === -1 ? code.length : end + 2;
        } else {
          if (inner === "{") depth += 1;
          else if (inner === "}") depth -= 1;
          i += 1;
        }
      }
      continue;
    }
    i += 1;
  }
  return code.length;
}

function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    const ch = code[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v") {
      i += 1;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      const nl = code.indexOf("\n", i + 2);
      i = nl === -1 ? code.length : nl + 1;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = scanString(code, i, ch);
      tokens.push({ type: "string", value: code.slice(i, end), start: i, end });
      i = end;
      continue;
    }
    if (ch === "`") {
      const end = scanTemplate(code, i);
      tokens.push({ type: "template", value: code.slice(i, end), start: i, end });
      i = end;
      continue;
    }
    if (ch === "/" && canStartRegex(tokens[tokens.length - 1])) {
      const end = scanRegex(code, i);
      tokens.push({ type: "regex", value: code.slice(i, end), start: i, end });
      i = end;
      continue;
    }
    if (isIdentStart(ch)) {
      let end = i + 1;
      while (end < code.length && isIdentPart(code[end])) end += 1;
      tokens.push({ type: "ident", value: code.slice(i, end), start: i, end });
      i = end;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      let end = i + 1;
      while (end < code.length && (isIdentPart(code[end]) || code[end] === ".")) end += 1;
      tokens.push({ type: "number", value: code.slice(i, end), start: i, end });
      i = end;
      continue;
    }
    const two = code.slice(i, i + 2);
    if (two === "=>" || two === "==" || two === "!=" || two === "<=" || two === ">=") {
      tokens.push({ type: "punct", value: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    tokens.push({ type: "punct", value: ch, start: i, end: i + 1 });
    i += 1;
  }

  return tokens;
}

function findMatchingClose(tokens: Token[], openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    if (tokens[i].type === "punct") {
      if (tokens[i].value === open) depth += 1;
      else if (tokens[i].value === close) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

function findOfTokenIndex(tokens: Token[], openParenIndex: number, closeParenIndex: number): number {
  let depth = 0;
  let ofIndex = -1;
  let seenBindingToken = false;

  for (let i = openParenIndex + 1; i < closeParenIndex; i += 1) {
    const token = tokens[i];
    if (token.type === "punct") {
      if (token.value === "(" || token.value === "[" || token.value === "{") {
        depth += 1;
        if (depth === 1) seenBindingToken = true;
      } else if (token.value === ")" || token.value === "]" || token.value === "}") {
        depth -= 1;
      } else if (depth === 0 && token.value === ";") {
        return -1;
      }
      continue;
    }

    if (depth !== 0) continue;

    if (
      token.type === "ident" &&
      token.value === "of" &&
      seenBindingToken &&
      tokens[i - 1]?.value !== "."
    ) {
      ofIndex = i;
      break;
    }

    if (token.type === "ident" && (token.value === "const" || token.value === "let" || token.value === "var")) {
      continue;
    }

    seenBindingToken = true;
  }

  return ofIndex;
}

function containsYield(tokens: Token[], startIndex: number, endIndex: number): boolean {
  let nestedFnDepth = 0;
  for (let i = startIndex; i < endIndex; i += 1) {
    const token = tokens[i];
    if (token.type === "ident" && token.value === "function" && tokens[i - 1]?.value !== ".") {
      const bodyStart = tokens.findIndex((t, idx) => idx > i && idx < endIndex && t.type === "punct" && t.value === "{");
      if (bodyStart !== -1) {
        const bodyEnd = findMatchingClose(tokens, bodyStart, "{", "}");
        if (bodyEnd !== -1 && bodyEnd < endIndex) {
          i = bodyEnd;
          continue;
        }
      }
      nestedFnDepth += 1;
      continue;
    }
    if (nestedFnDepth === 0 && token.type === "ident" && token.value === "yield" && tokens[i - 1]?.value !== ".") {
      return true;
    }
  }
  return false;
}

function findStatementEnd(tokens: Token[], startIndex: number): number {
  const first = tokens[startIndex];
  if (!first) return -1;

  if (first.type === "punct" && first.value === "{") {
    const close = findMatchingClose(tokens, startIndex, "{", "}");
    return close === -1 ? -1 : tokens[close].end;
  }

  let depth = 0;
  for (let i = startIndex; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "punct") {
      if (token.value === "(" || token.value === "[" || token.value === "{") {
        depth += 1;
      } else if (token.value === ")" || token.value === "]" || token.value === "}") {
        if (depth === 0 && token.value === "}") {
          return tokens[i - 1]?.end ?? first.start;
        }
        depth -= 1;
      } else if (depth === 0 && token.value === ";") {
        return token.end;
      }
    }
  }

  return tokens[tokens.length - 1]?.end ?? -1;
}

/**
 * Work around a QuickJS/QuickJS-NG bytecode compiler bug (`stack underflow`)
 * triggered when a `for (... of <iterable>)` loop inside a generator function
 * contains a `yield` expression in `<iterable>` (commonly emitted by esbuild
 * when downleveling `for (const x of await expr)`).
 */
export function hoistYieldInForOf(code: string): string {
  if (!code.includes("yield") || !code.includes("for")) {
    return code;
  }

  const tokens = tokenize(code);
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  let counter = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== "ident" || token.value !== "for") continue;
    if (tokens[i - 1]?.type === "punct" && tokens[i - 1].value === ".") continue;

    const openParenIndex = i + 1;
    if (tokens[openParenIndex]?.type !== "punct" || tokens[openParenIndex].value !== "(") continue;

    const closeParenIndex = findMatchingClose(tokens, openParenIndex, "(", ")");
    if (closeParenIndex === -1) continue;

    const ofIndex = findOfTokenIndex(tokens, openParenIndex, closeParenIndex);
    if (ofIndex === -1) continue;

    if (!containsYield(tokens, ofIndex + 1, closeParenIndex)) continue;

    let stmtStartIndex = i;
    let labelPrefix = "";
    if (
      i >= 2 &&
      tokens[i - 1]?.type === "punct" &&
      tokens[i - 1].value === ":" &&
      tokens[i - 2]?.type === "ident" &&
      tokens[i - 2].value !== "default"
    ) {
      stmtStartIndex = i - 2;
      labelPrefix = code.slice(tokens[i - 2].start, token.start);
    }

    const prevToken = tokens[stmtStartIndex - 1];
    const inStatementList =
      !prevToken ||
      (prevToken.type === "punct" && STATEMENT_LIST_PREV.has(prevToken.value)) ||
      (prevToken.type === "punct" && prevToken.value === ":");

    const tempVar = `__vegaForOf_${counter++}`;
    const head = code.slice(tokens[openParenIndex].end, tokens[ofIndex].start);
    const iterable = code.slice(tokens[ofIndex].end, tokens[closeParenIndex].start);

    if (inStatementList) {
      edits.push({
        start: tokens[stmtStartIndex].start,
        end: tokens[closeParenIndex].end,
        replacement: `const ${tempVar}=(${iterable});${labelPrefix}for(${head} of ${tempVar})`,
      });
    } else {
      const bodyEnd = findStatementEnd(tokens, closeParenIndex + 1);
      if (bodyEnd === -1) continue;
      const body = code.slice(tokens[closeParenIndex].end, bodyEnd);
      edits.push({
        start: tokens[stmtStartIndex].start,
        end: bodyEnd,
        replacement: `{const ${tempVar}=(${iterable});${labelPrefix}for(${head} of ${tempVar})${body}}`,
      });
    }
  }

  if (edits.length === 0) return code;

  let output = code;
  for (let i = edits.length - 1; i >= 0; i -= 1) {
    const edit = edits[i];
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  return output;
}
