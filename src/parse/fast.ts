import type { ImportRef, NameAt, Opening, ParsedFile, RecipeNode, StateNode } from "./types.js";

/**
 * Scan ordinary TSX without loading Babel.
 * Returns null when the file uses syntax this scanner will not guess at.
 * The caller then parses that file with Babel, so a miss here is slower, not wrong.
 */

class Bail extends Error {}

/** Tried to read JSX where the source is a comparison or a type argument. */
class NotJsx extends Error {}

interface Mark {
  i: number;
  line: number;
  prev: string;
  newline: boolean;
  brace: number;
  paren: number;
  bracket: number;
  openings: number;
  angle: number;
  collectors: Array<{ state: number; recipe: number }>;
}

interface Built {
  state: StateNode;
  recipe: RecipeNode;
}

interface Collector {
  /** Null while reading an attribute: those elements are recipe children only. */
  state: StateNode[] | null;
  recipe: RecipeNode[];
}

type Expr =
  | { kind: "string"; value: string }
  | { kind: "template"; quasis: string[] }
  | { kind: "bool"; value: boolean }
  | { kind: "num"; value: string }
  | { kind: "call"; args: Expr[] }
  | { kind: "paren"; expr: Expr }
  | { kind: "array"; elements: Expr[] }
  | { kind: "bin"; parts: Expr[] }
  | { kind: "other" };

const JSX_PREV = new Set([
  "start",
  "(",
  "[",
  ",",
  "=",
  "?",
  ":",
  ";",
  "{",
  "}",
  "=>",
  "&&",
  "||",
  "??",
  "return",
  "throw",
  "else",
  "case",
  "yield",
  "jsx",
]);

const CONTINUING_PREV = new Set([
  "(",
  "[",
  ",",
  ".",
  "?",
  ":",
  "=",
  "=>",
  "&&",
  "||",
  "??",
  "return",
  "throw",
  "else",
  "yield",
  "case",
  "other",
]);

const STATEMENT_WORDS = new Set([
  "import",
  "export",
  "function",
  "const",
  "let",
  "var",
  "async",
  "class",
]);

export function parseFast(source: string): ParsedFile | null {
  try {
    return new FastParser(source).parse();
  } catch (error) {
    if (error instanceof Bail || error instanceof NotJsx) return null;
    return null;
  }
}

class FastParser {
  private i = 0;
  private line = 1;
  private prev = "start";
  private newline = false;
  /** True when whitespace separated the previous token from the one we are reading. */
  private gap = false;
  private brace = 0;
  private paren = 0;
  private bracket = 0;
  /** Open `<...>` type arguments. A comma inside them is not the next `const` declarator. */
  private angle = 0;
  private readonly imports: ImportRef[] = [];
  private readonly defined = new Map<string, number>();
  private readonly exported = new Map<string, number>();
  private readonly pendingReexports: Array<{ local: string; exported: string }> = [];
  private readonly openings: Opening[] = [];
  private readonly stateRoots: StateNode[] = [];
  private readonly recipeRoots: RecipeNode[] = [];
  private readonly collectors: Collector[] = [];

  constructor(private readonly source: string) {}

  parse(): ParsedFile {
    if (this.source.charCodeAt(0) === 0xfeff) this.i = 1;
    while (!this.eof()) {
      const before = this.i;
      this.step();
      if (this.i === before) throw new Bail();
    }
    for (const spec of this.pendingReexports) {
      const line = this.defined.get(spec.local);
      if (line === undefined) continue;
      this.exported.set(spec.exported, line);
      if (spec.exported !== spec.local) this.defined.set(spec.exported, line);
    }
    const defined: NameAt[] = [];
    const exported: NameAt[] = [];
    for (const [name, line] of this.defined) defined.push({ name, line });
    for (const [name, line] of this.exported) exported.push({ name, line });
    return {
      imports: this.imports,
      defined,
      exported,
      openings: this.openings,
      stateTree: this.stateRoots,
      recipeTree: this.recipeRoots,
    };
  }

  private step(): void {
    this.skipSpace();
    if (this.eof()) return;
    // Decorators are left to Babel. Guessing past `@` can report a hit Babel would refuse to parse.
    if (this.peek() === "@") throw new Bail();
    if (this.canStartStatement() && this.tryDeclaration()) return;
    if (this.tryJsx()) return;
    this.takeToken();
  }

  private canStartStatement(): boolean {
    if (this.brace !== 0 || this.paren !== 0 || this.bracket !== 0) return false;
    if (this.prev === "start" || this.prev === ";" || this.prev === "}") return true;
    if (!this.newline) return false;
    return !CONTINUING_PREV.has(this.prev);
  }

  private jsxOk(): boolean {
    return JSX_PREV.has(this.prev);
  }

  private tryDeclaration(): boolean {
    const word = this.peekWord();
    if (!word || !STATEMENT_WORDS.has(word)) return false;
    if (word === "import") {
      if (this.peekWordAfter(word) === "(") return false;
      this.parseImport();
      return true;
    }
    if (word === "export") {
      this.parseExport();
      return true;
    }
    if (word === "function") {
      this.parseFunction(false);
      return true;
    }
    if (word === "async" && this.peekWordAfter(word) === "function") {
      this.consumeWord("async");
      this.parseFunction(false);
      return true;
    }
    if (word === "const" || word === "let" || word === "var") {
      this.consumeWord(word);
      this.parseVar(false);
      return true;
    }
    return false;
  }

  private parseImport(): void {
    this.consumeWord("import");
    this.skipSpace();
    if (this.peek() === "(") throw new Bail();
    if (this.peek() === "'" || this.peek() === "\"") {
      this.takeString();
      this.consumeClause();
      return;
    }
    let typeOnly = false;
    if (this.peekWord() === "type") {
      const after = this.peekWordAfter("type");
      if (after !== "from") {
        typeOnly = true;
        this.consumeWord("type");
        this.skipSpace();
      }
    }
    if (this.peek() === "*") {
      this.takeToken();
      this.expectWord("as");
      this.readIdent();
      this.expectWord("from");
      this.takeModuleSpecifier();
      this.consumeClause();
      return;
    }
    if (this.peek() !== "{") {
      this.readIdent();
      this.skipSpace();
      if (this.peek() === ",") {
        this.i += 1;
        this.prev = ",";
        this.skipSpace();
      } else {
        this.expectWord("from");
        this.takeModuleSpecifier();
        this.consumeClause();
        return;
      }
    }
    if (this.peek() === "*") {
      this.takeToken();
      this.expectWord("as");
      this.readIdent();
      this.expectWord("from");
      this.takeModuleSpecifier();
      this.consumeClause();
      return;
    }
    this.expect("{");
    const specs: Array<{ local: string; imported: string }> = [];
    while (!this.eof() && this.peek() !== "}") {
      this.skipSpace();
      if (this.peek() === "}") break;
      let specType = typeOnly;
      if (this.peekWord() === "type") {
        specType = true;
        this.consumeWord("type");
        this.skipSpace();
      }
      const imported = this.readIdent();
      this.skipSpace();
      let local = imported;
      if (this.peekWord() === "as") {
        this.consumeWord("as");
        local = this.readIdent();
      }
      if (!specType && !typeOnly) specs.push({ local, imported });
      this.skipSpace();
      if (this.peek() === ",") {
        this.i += 1;
        this.prev = ",";
      }
    }
    this.expect("}");
    this.expectWord("from");
    const specifier = this.takeModuleSpecifier();
    for (const spec of specs) this.imports.push({ local: spec.local, imported: spec.imported, specifier });
    this.consumeClause();
  }

  private parseExport(): void {
    this.consumeWord("export");
    this.skipSpace();
    const word = this.peekWord();
    if (word === "type" || word === "interface") {
      this.consumeWord(word);
      return;
    }
    if (word === "async" && this.peekWordAfter("async") === "function") {
      this.consumeWord("async");
      this.parseFunction(true);
      return;
    }
    if (word === "function") {
      this.parseFunction(true);
      return;
    }
    if (word === "const" || word === "let" || word === "var") {
      this.consumeWord(word);
      this.parseVar(true);
      return;
    }
    if (word === "default") {
      this.consumeWord("default");
      this.skipSpace();
      if (this.peekWord() === "async" && this.peekWordAfter("async") === "function") {
        this.consumeWord("async");
        this.parseFunction(true);
        return;
      }
      if (this.peekWord() === "function") {
        this.parseFunction(true);
        return;
      }
      // `export default <Button />` is an expression. JSX is legal here.
      this.prev = "return";
      return;
    }
    if (this.peek() === "*") return;
    if (this.peek() === "{") {
      this.expect("{");
      const added = this.pendingReexports.length;
      while (!this.eof() && this.peek() !== "}") {
        this.skipSpace();
        if (this.peek() === "}") break;
        if (this.peekWord() === "type") {
          this.consumeWord("type");
          this.skipSpace();
        }
        const local = this.readIdent();
        this.skipSpace();
        let exported = local;
        if (this.peekWord() === "as") {
          this.consumeWord("as");
          exported = this.readIdent();
        }
        this.pendingReexports.push({ local, exported });
        this.skipSpace();
        if (this.peek() === ",") {
          this.i += 1;
          this.prev = ",";
        }
      }
      this.expect("}");
      this.skipSpace();
      if (this.peekWord() === "from") {
        this.pendingReexports.length = added;
        this.consumeWord("from");
        this.takeModuleSpecifier();
        this.consumeClause();
      }
      return;
    }
    throw new Bail();
  }

  private parseFunction(isExported: boolean): void {
    this.consumeWord("function");
    this.skipSpace();
    if (this.peek() === "*") {
      this.i += 1;
      this.prev = "other";
      this.skipSpace();
    }
    if (!this.isIdentStart(this.peek())) return;
    const line = this.line;
    const name = this.readIdent();
    if (/^[A-Z]/.test(name)) {
      this.defined.set(name, line);
      if (isExported) this.exported.set(name, line);
    }
  }

  private parseVar(isExported: boolean): void {
    while (!this.eof()) {
      this.skipSpace();
      if (this.peek() === "{" || this.peek() === "[") {
        this.scanGroup();
      } else if (this.isIdentStart(this.peek())) {
        const line = this.line;
        const name = this.readIdent();
        if (/^[A-Z]/.test(name)) {
          this.defined.set(name, line);
          if (isExported) this.exported.set(name, line);
        }
      } else {
        return;
      }
      this.skipSpace();
      if (this.peek() === ":") {
        this.i += 1;
        this.prev = ":";
        this.skipType();
      }
      this.skipSpace();
      if (this.peek() === "=" && this.peekAt(1) !== ">") {
        this.i += 1;
        this.prev = "=";
        this.newline = false;
        this.scanValue();
      }
      this.skipSpace();
      if (this.peek() === ",") {
        this.i += 1;
        this.prev = ",";
        this.newline = false;
        continue;
      }
      return;
    }
  }

  /** Read an initializer, stopping before a comma or the next statement. */
  private scanValue(): void {
    const brace = this.brace;
    const paren = this.paren;
    const bracket = this.bracket;
    while (!this.eof()) {
      this.skipSpace();
      if (this.eof()) return;
      if (this.brace === brace && this.paren === paren && this.bracket === bracket && this.angle === 0) {
        if (this.peek() === "," || this.peek() === ";") return;
        const continues = ".?([+-*/%&|^<>!".includes(this.peek()) || this.startsWith("=>");
        if (this.newline && !continues && this.canStartStatement()) return;
      }
      const before = this.i;
      if (this.tryJsx()) continue;
      this.takeToken();
      if (this.i === before) throw new Bail();
    }
  }

  /** Read a balanced `{}` or `[]` pattern, still noticing JSX in a default value. */
  private scanGroup(): void {
    this.scanBalancedFromHere();
  }

  private tryJsx(): boolean {
    if (this.peek() !== "<" || !this.jsxOk()) return false;
    const mark = this.mark();
    try {
      const built = this.parseElement();
      this.place(built);
      this.prev = "jsx";
      this.newline = false;
      return true;
    } catch (error) {
      if (error instanceof NotJsx) {
        this.restore(mark);
        return false;
      }
      throw error;
    }
  }

  private place(built: Built): void {
    const collector = this.collectors.at(-1);
    if (!collector) {
      this.stateRoots.push(built.state);
      this.recipeRoots.push(built.recipe);
      return;
    }
    if (collector.state) collector.state.push(built.state);
    collector.recipe.push(built.recipe);
  }

  private parseElement(): Built {
    const startLine = this.line;
    this.expect("<");
    this.skipJsxSpace();
    if (this.peek() === ">") {
      this.i += 1;
      this.prev = ">";
      return this.finishElement({
        kind: "fragment",
        name: "",
        startLine,
        attrs: [],
        classTokens: [],
        role: null,
        selfClosing: false,
      });
    }
    if (!this.isJsxNameStart(this.peek())) throw new NotJsx();
    const tag = this.readJsxTag();
    this.skipJsxSpace();
    const next = this.peek();
    if (next !== ">" && next !== "/" && next !== "{" && !this.isJsxNameStart(next)) throw new NotJsx();
    const opening: Opening | null = tag.kind === "opaque" || tag.kind === "fragment"
      ? null
      : { line: startLine, kind: tag.kind, name: tag.name, role: null };
    if (opening) this.openings.push(opening);
    const attrs: Array<{ name: string; literal?: string }> = [];
    let classTokens: string[] = [];
    const attrRecipe: RecipeNode[] = [];
    this.collectors.push({ state: null, recipe: attrRecipe });
    try {
      while (!this.eof()) {
        this.skipJsxSpace();
        if (this.peek() === ">" || this.peek() === "/") break;
        if (this.peek() === "{") {
          this.parseSpread();
          continue;
        }
        if (!this.isJsxNameStart(this.peek())) throw new Bail();
        const attrLine = this.line;
        const name = this.readJsxIdent();
        this.skipJsxSpace();
        if (this.peek() !== "=") {
          attrs.push({ name, literal: "true" });
          void attrLine;
          continue;
        }
        this.i += 1;
        this.skipJsxSpace();
        if (this.peek() === "'" || this.peek() === "\"") {
          const value = this.takeString();
          const attr: { name: string; literal?: string } = { name, literal: value };
          attrs.push(attr);
          if (name === "className") classTokens = splitClasses(value);
          continue;
        }
        if (this.peek() !== "{") throw new Bail();
        this.i += 1;
        this.prev = "{";
        this.newline = false;
        this.skipSpace();
        const expr = this.peek() === "}" ? { kind: "other" as const } : this.parseExpr();
        this.skipSpace();
        this.expect("}");
        const literal = directLiteral(expr);
        attrs.push(literal === undefined ? { name } : { name, literal });
        if (name === "className") classTokens = classTokensOf(expr);
      }
    } finally {
      this.collectors.pop();
    }
    this.skipJsxSpace();
    const selfClosing = this.peek() === "/";
    if (selfClosing) {
      this.expect("/");
      this.expect(">");
    } else {
      this.expect(">");
    }
    if (opening && tag.kind === "intrinsic") opening.role = attrs.find((attr) => attr.name === "role")?.literal ?? null;
    return this.finishElement({
      kind: tag.kind === "opaque" ? "fragment" : tag.kind,
      name: tag.kind === "opaque" || tag.kind === "fragment" ? "" : tag.name,
      startLine,
      attrs,
      classTokens,
      role: opening?.role ?? null,
      selfClosing,
      attrRecipe,
      closeName: tag.kind === "fragment" || tag.kind === "opaque" ? null : tag.close,
    });
  }

  private finishElement(input: {
    kind: "intrinsic" | "component" | "member" | "fragment";
    name: string;
    startLine: number;
    attrs: Array<{ name: string; literal?: string }>;
    classTokens: string[];
    role: string | null;
    selfClosing: boolean;
    attrRecipe?: RecipeNode[];
    closeName?: string | null;
  }): Built {
    const stateChildren: StateNode[] = [];
    const recipeChildren: RecipeNode[] = [...(input.attrRecipe ?? [])];
    if (!input.selfClosing) {
      this.collectors.push({ state: stateChildren, recipe: recipeChildren });
      try {
        this.parseChildren(input.closeName ?? null);
      } finally {
        this.collectors.pop();
      }
    }
    const endLine = this.line;
    const stateKind = input.kind === "intrinsic" ? "intrinsic" : input.kind === "component" ? "component" : "fragment";
    const stateName = stateKind === "fragment" ? "" : input.name;
    const recipeKind = input.kind === "intrinsic" ? "intrinsic" : input.kind === "fragment" ? "fragment" : "component";
    const recipeName = input.kind === "fragment" ? "" : input.kind === "member" ? input.name : input.name;
    const buttonRole = input.kind === "intrinsic" && input.name === "a" && input.role === "button";
    return {
      state: {
        name: stateName,
        kind: stateKind,
        line: input.startLine,
        attrs: input.attrs,
        classTokens: input.classTokens,
        children: stateChildren,
      },
      recipe: {
        name: recipeName,
        kind: recipeKind,
        line: input.startLine,
        endLine,
        buttonRole,
        children: recipeChildren,
      },
    };
  }

  private parseChildren(closeName: string | null): void {
    while (!this.eof()) {
      this.skipJsxTextSpace();
      if (this.eof()) throw new Bail();
      if (this.peek() === "<" && this.peekAt(1) === "/") {
        this.i += 2;
        this.skipJsxSpace();
        if (closeName === null) {
          this.expect(">");
          return;
        }
        const actual = this.readJsxCloseName();
        if (actual !== closeName) throw new Bail();
        this.skipJsxSpace();
        this.expect(">");
        return;
      }
      if (this.peek() === "<") {
        this.place(this.parseElement());
        this.prev = "jsx";
        continue;
      }
      if (this.peek() === "{") {
        this.i += 1;
        this.brace += 1;
        this.prev = "{";
        this.newline = false;
        this.skipSpace();
        if (this.peek() === "/" && this.peekAt(1) === "*") {
          this.skipBlockComment();
          this.skipSpace();
          this.expect("}");
          this.brace -= 1;
          continue;
        }
        const target = this.brace - 1;
        while (!this.eof() && this.brace > target) {
          const before = this.i;
          this.skipSpace();
          if (this.brace === target) break;
          if (this.peek() === "}" && this.brace === target + 1) {
            this.takeToken();
            break;
          }
          if (this.tryJsx()) continue;
          this.takeToken();
          if (this.i === before) throw new Bail();
        }
        continue;
      }
      this.i += 1;
      if (this.source[this.i - 1] === "\n") this.line += 1;
    }
    throw new Bail();
  }

  private parseSpread(): void {
    this.expect("{");
    this.skipSpace();
    if (this.peek() !== "." || this.peekAt(1) !== "." || this.peekAt(2) !== ".") throw new Bail();
    this.i += 3;
    this.prev = "other";
    const target = this.brace - 1;
    while (!this.eof() && this.brace > target) {
      const before = this.i;
      this.skipSpace();
      if (this.peek() === "}" && this.brace === target + 1) {
        this.takeToken();
        break;
      }
      if (this.tryJsx()) continue;
      this.takeToken();
      if (this.i === before) throw new Bail();
    }
  }

  private readJsxTag(): { kind: "intrinsic" | "component" | "member" | "fragment" | "opaque"; name: string; close: string } {
    const first = this.readJsxIdent();
    if (this.peek() === ":") {
      while (!this.eof() && this.isJsxNamePart(this.peek())) this.i += 1;
      return { kind: "opaque", name: "", close: "" };
    }
    if (this.peek() === ".") {
      const parts = [first];
      while (this.peek() === ".") {
        this.i += 1;
        if (!this.isJsxNameStart(this.peek())) throw new Bail();
        parts.push(this.readJsxIdent());
      }
      if (parts.length !== 2) return { kind: "opaque", name: "", close: "" };
      return { kind: "member", name: first, close: parts.join(".") };
    }
    if (first[0] === first[0]?.toLowerCase()) return { kind: "intrinsic", name: first, close: first };
    return { kind: "component", name: first, close: first };
  }

  private readJsxCloseName(): string {
    const parts = [this.readJsxIdent()];
    while (this.peek() === ".") {
      this.i += 1;
      parts.push(this.readJsxIdent());
    }
    return parts.join(".");
  }

  private parseExpr(): Expr {
    return this.parseCond();
  }

  private parseCond(): Expr {
    const test = this.parseOr();
    this.skipSpace();
    if (this.peek() === "?" && this.peekAt(1) !== "." && this.peekAt(1) !== "?") {
      this.i += 1;
      this.prev = "?";
      this.newline = false;
      const yes = this.parseCond();
      this.skipSpace();
      this.expect(":");
      const no = this.parseCond();
      return { kind: "bin", parts: [test, yes, no] };
    }
    return test;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.skipSpace(), this.startsWith("||") || this.startsWith("??")) {
      this.i += 2;
      this.prev = this.source.slice(this.i - 2, this.i);
      this.newline = false;
      const right = this.parseAnd();
      left = { kind: "bin", parts: [left, right] };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseBit();
    while (this.skipSpace(), this.startsWith("&&")) {
      this.i += 2;
      this.prev = "&&";
      this.newline = false;
      const right = this.parseBit();
      left = { kind: "bin", parts: [left, right] };
    }
    return left;
  }

  private parseBit(): Expr {
    let left = this.parseEq();
    while (this.skipSpace(), this.isBitOp()) {
      this.takeToken();
      const right = this.parseEq();
      left = { kind: "bin", parts: [left, right] };
    }
    return left;
  }

  private isBitOp(): boolean {
    const c = this.peek();
    if (c === "^") return true;
    if (c === "|" && this.peekAt(1) !== "|") return true;
    if (c === "&" && this.peekAt(1) !== "&") return true;
    return false;
  }

  private parseEq(): Expr {
    let left = this.parseRel();
    while (this.skipSpace(), this.isEqOp()) {
      this.takeToken();
      const right = this.parseRel();
      left = { kind: "bin", parts: [left, right] };
    }
    return left;
  }

  private isEqOp(): boolean {
    return this.startsWith("===") || this.startsWith("!==") || this.startsWith("==") || this.startsWith("!=");
  }

  private parseRel(): Expr {
    let left = this.parseAdd();
    while (this.skipSpace(), this.isRelOp() || this.peekWord() === "instanceof" || this.peekWord() === "in") {
      if (this.peekWord() === "instanceof" || this.peekWord() === "in") this.consumeWord(this.peekWord() ?? "");
      else this.takeToken();
      const right = this.parseAdd();
      left = { kind: "bin", parts: [left, right] };
    }
    return left;
  }

  private isRelOp(): boolean {
    if (this.jsxOk() && this.peek() === "<") return false;
    return this.startsWith("<=") || this.startsWith(">=") || this.peek() === "<" || (this.peek() === ">" && this.peekAt(1) !== ">");
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    while (this.skipSpace(), (this.peek() === "+" || this.peek() === "-") && this.peekAt(1) !== "=" && this.peekAt(1) !== ">") {
      this.takeToken();
      const right = this.parseMul();
      left = { kind: "bin", parts: [left, right] };
    }
    return left;
  }

  private parseMul(): Expr {
    let left = this.parseUnary();
    while (this.skipSpace(), this.isMulOp()) {
      if (this.peek() === "/" && this.regexAllowed()) {
        this.takeRegex();
        left = { kind: "other" };
        continue;
      }
      this.takeToken();
      const right = this.parseUnary();
      left = { kind: "bin", parts: [left, right] };
    }
    return left;
  }

  private isMulOp(): boolean {
    const c = this.peek();
    return (c === "*" || c === "/" || c === "%") && this.peekAt(1) !== "=";
  }

  private parseUnary(): Expr {
    this.skipSpace();
    if (this.startsWith("++") || this.startsWith("--")) {
      this.i += 2;
      this.prev = "other";
      this.parseUnary();
      return { kind: "other" };
    }
    const word = this.peekWord();
    if (word === "void" || word === "typeof" || word === "delete" || word === "await") {
      this.consumeWord(word);
      this.parseUnary();
      return { kind: "other" };
    }
    const c = this.peek();
    if ((c === "!" && this.peekAt(1) !== "=") || c === "~" || ((c === "+" || c === "-") && this.peekAt(1) !== c && this.peekAt(1) !== "=")) {
      this.takeToken();
      this.parseUnary();
      return { kind: "other" };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    while (true) {
      this.skipSpace();
      if (this.startsWith("?.")) {
        this.i += 2;
        this.prev = "other";
        this.newline = false;
        if (this.peek() === "(") {
          this.parseArgList();
        } else if (this.peek() === "[") {
          this.takeToken();
          this.parseExpr();
          this.skipSpace();
          this.expect("]");
        } else if (this.isIdentStart(this.peek())) {
          this.readIdent();
        }
        expr = { kind: "other" };
        continue;
      }
      if (this.peek() === ".") {
        this.takeToken();
        if (this.peek() === "#") this.i += 1;
        if (!this.isIdentStart(this.peek())) throw new Bail();
        this.readIdent();
        expr = { kind: "other" };
        continue;
      }
      if (this.peek() === "(") {
        const args = this.parseArgList();
        expr = { kind: "call", args };
        continue;
      }
      if (this.peek() === "[" && !this.newline) {
        this.takeToken();
        this.parseExpr();
        this.skipSpace();
        this.expect("]");
        expr = { kind: "other" };
        continue;
      }
      if (this.peek() === "`") {
        this.readTemplate();
        expr = { kind: "other" };
        continue;
      }
      if (this.peek() === "!" && this.peekAt(1) !== "=") {
        this.i += 1;
        this.prev = "other";
        expr = { kind: "other" };
        continue;
      }
      if (!this.newline && (this.peekWord() === "as" || this.peekWord() === "satisfies")) {
        this.consumeWord(this.peekWord() ?? "as");
        this.skipType();
        expr = { kind: "other" };
        continue;
      }
      break;
    }
    return expr;
  }

  private parsePrimary(): Expr {
    this.skipSpace();
    if (this.eof()) throw new Bail();
    if (this.jsxOk() && this.peek() === "<") {
      const mark = this.mark();
      try {
        const built = this.parseElement();
        this.place(built);
        this.prev = "jsx";
        this.newline = false;
        return { kind: "other" };
      } catch (error) {
        if (!(error instanceof NotJsx)) throw error;
        this.restore(mark);
      }
    }
    const c = this.peek();
    if (c === "'" || c === "\"") return { kind: "string", value: this.takeString() };
    if (c === "`") return { kind: "template", quasis: this.readTemplate() };
    if (c === "/" && this.regexAllowed()) {
      this.takeRegex();
      return { kind: "other" };
    }
    if (this.isNumStart(c)) return { kind: "num", value: String(Number(this.takeNumber())) };
    if (c === "(") return this.parseParen();
    if (c === "[") return this.parseArray();
    if (c === "{") {
      this.scanBalancedFromHere();
      return { kind: "other" };
    }
    if (this.peekWord() === "function" || (this.peekWord() === "async" && this.peekWordAfter("async") === "function")) {
      this.skipFunction();
      return { kind: "other" };
    }
    if (this.isIdentStart(c)) {
      const word = this.readIdent();
      if (word === "true") return { kind: "bool", value: true };
      if (word === "false") return { kind: "bool", value: false };
      return { kind: "other" };
    }
    throw new Bail();
  }

  private parseParen(): Expr {
    this.expect("(");
    this.paren += 1;
    this.prev = "(";
    this.skipSpace();
    if (this.peek() === ")") {
      this.expect(")");
      this.paren -= 1;
      this.skipSpace();
      if (this.startsWith("=>")) {
        this.consumeArrowBody();
        return { kind: "other" };
      }
      return { kind: "other" };
    }
    const first = this.parseExpr();
    const parts = [first];
    this.skipSpace();
    while (this.peek() === ",") {
      this.i += 1;
      this.prev = ",";
      this.skipSpace();
      if (this.peek() === ")") break;
      parts.push(this.parseExpr());
      this.skipSpace();
    }
    this.expect(")");
    this.paren -= 1;
    this.prev = ")";
    this.skipSpace();
    if (this.startsWith("=>")) {
      this.consumeArrowBody();
      return { kind: "other" };
    }
    if (parts.length === 1 && parts[0]) return { kind: "paren", expr: parts[0] };
    return { kind: "other" };
  }

  private consumeArrowBody(): void {
    this.i += 2;
    this.prev = "=>";
    this.newline = false;
    this.skipSpace();
    if (this.peek() === "{") {
      this.scanBalancedFromHere();
      return;
    }
    this.parseExpr();
  }

  private parseArray(): Expr {
    this.expect("[");
    this.bracket += 1;
    this.prev = "[";
    const elements: Expr[] = [];
    this.skipSpace();
    while (!this.eof() && this.peek() !== "]") {
      if (this.startsWith("...")) {
        this.i += 3;
        this.prev = "other";
        this.parseExpr();
      } else if (this.peek() !== ",") {
        elements.push(this.parseExpr());
      }
      this.skipSpace();
      if (this.peek() === ",") {
        this.i += 1;
        this.prev = ",";
        this.skipSpace();
      }
    }
    this.expect("]");
    this.bracket -= 1;
    return { kind: "array", elements };
  }

  private parseArgList(): Expr[] {
    this.expect("(");
    this.paren += 1;
    this.prev = "(";
    const args: Expr[] = [];
    this.skipSpace();
    while (!this.eof() && this.peek() !== ")") {
      if (this.startsWith("...")) {
        this.i += 3;
        this.prev = "other";
        this.parseExpr();
      } else {
        args.push(this.parseExpr());
      }
      this.skipSpace();
      if (this.peek() === ",") {
        this.i += 1;
        this.prev = ",";
        this.skipSpace();
      }
    }
    this.expect(")");
    this.paren -= 1;
    this.prev = ")";
    return args;
  }

  private skipFunction(): void {
    if (this.peekWord() === "async") this.consumeWord("async");
    this.consumeWord("function");
    this.skipSpace();
    if (this.peek() === "*") {
      this.i += 1;
      this.prev = "other";
    }
    this.skipSpace();
    if (this.isIdentStart(this.peek())) this.readIdent();
    this.skipSpace();
    if (this.peek() === "<") this.skipType();
    this.skipSpace();
    if (this.peek() === "(") this.scanBalancedFromHere();
    this.skipSpace();
    if (this.peek() === "{") this.scanBalancedFromHere();
  }

  /** Balanced `{}`, `()`, or `[]`, starting at the opener, with JSX still recorded. */
  private scanBalancedFromHere(): void {
    const open = this.peek();
    const close = open === "{" ? "}" : open === "(" ? ")" : "]";
    const depth = () => (open === "{" ? this.brace : open === "(" ? this.paren : this.bracket);
    const start = depth();
    this.takeToken();
    while (!this.eof()) {
      this.skipSpace();
      if (this.peek() === close && depth() === start + 1) {
        this.takeToken();
        return;
      }
      const before = this.i;
      if (this.tryJsx()) continue;
      this.takeToken();
      if (this.i === before) throw new Bail();
    }
    throw new Bail();
  }

  private skipType(): void {
    let depth = 0;
    while (!this.eof()) {
      this.skipSpace();
      const c = this.peek();
      if (c === "<" || c === "(" || c === "{" || c === "[") {
        depth += 1;
        this.takeToken();
        continue;
      }
      if (c === ">" || c === ")" || c === "}" || c === "]") {
        if (depth === 0) return;
        depth -= 1;
        this.takeToken();
        continue;
      }
      if (depth === 0 && (c === "," || c === ";" || c === "=" && this.peekAt(1) !== ">" || c === "?" && this.peekAt(1) !== ".")) {
        if (this.startsWith("=>")) {
          this.i += 2;
          this.prev = "=>";
          continue;
        }
        return;
      }
      if (this.startsWith("=>")) {
        this.i += 2;
        this.prev = "=>";
        continue;
      }
      if (c === "'" || c === "\"" || c === "`" || this.isIdentStart(c) || this.isNumStart(c)) {
        this.takeToken();
        continue;
      }
      this.takeToken();
    }
  }

  private takeToken(): void {
    this.skipSpace();
    if (this.eof()) throw new Bail();
    const c = this.peek();
    if (c === "'" || c === "\"") {
      this.takeString();
      return;
    }
    if (c === "`") {
      this.readTemplate();
      return;
    }
    if (c === "/" && this.regexAllowed()) {
      this.takeRegex();
      return;
    }
    if (this.isIdentStart(c)) {
      this.readIdent();
      return;
    }
    if (this.isNumStart(c)) {
      this.takeNumber();
      return;
    }
    this.takeOp();
  }

  private takeOp(): void {
    const c = this.peek();
    const n = this.peekAt(1);
    if (c === "<" && n !== "=" && n !== "<" && !this.gap) {
      this.i += 1;
      this.angle += 1;
      this.prev = "other";
      this.newline = false;
      return;
    }
    if (c === ">" && n !== "=" && this.angle > 0) {
      this.i += 1;
      this.angle -= 1;
      this.prev = "other";
      this.newline = false;
      return;
    }
    const pair = `${c}${n}`;
    if (pair === "=>" || pair === "&&" || pair === "||" || pair === "??" || pair === "==" || pair === "!=" || pair === "<=" || pair === ">=" || pair === "?.") {
      const third = this.peekAt(2);
      if ((pair === "==" || pair === "!=") && third === "=") {
        this.i += 3;
        this.prev = "other";
      } else {
        this.i += 2;
        this.prev = pair === "=>" || pair === "&&" || pair === "||" || pair === "??" ? pair : "other";
      }
      this.bump(c);
      this.newline = false;
      return;
    }
    if (c === "?" && n === "?") {
      this.i += 2;
      this.prev = "??";
      this.newline = false;
      return;
    }
    if ((c === "+" && n === "+") || (c === "-" && n === "-") || (c === "*" && n === "*") || pair === "<<") {
      this.i += 2;
      this.prev = "other";
      this.newline = false;
      return;
    }
    if (c === ">" && n === ">" ) {
      this.i += this.peekAt(2) === ">" ? 3 : 2;
      this.prev = "other";
      this.newline = false;
      return;
    }
    this.i += 1;
    this.bump(c);
    if (c === "(" || c === ")" || c === "[" || c === "]" || c === "{" || c === "}" || c === "," || c === ";" || c === "=" || c === "?" || c === ":" || c === ".") {
      this.prev = c;
    } else {
      this.prev = "other";
    }
    this.newline = false;
  }

  private bump(c: string): void {
    if (c === "{") this.brace += 1;
    else if (c === "}") this.brace = Math.max(0, this.brace - 1);
    else if (c === "(") this.paren += 1;
    else if (c === ")") this.paren = Math.max(0, this.paren - 1);
    else if (c === "[") this.bracket += 1;
    else if (c === "]") this.bracket = Math.max(0, this.bracket - 1);
  }

  private readIdent(): string {
    this.skipSpace();
    if (!this.isIdentStart(this.peek())) throw new Bail();
    const start = this.i;
    this.i += 1;
    while (this.isIdentPart(this.peek())) this.i += 1;
    const word = this.source.slice(start, this.i);
    if (word === "return" || word === "throw" || word === "else" || word === "case" || word === "yield") this.prev = word;
    else this.prev = "ident";
    this.newline = false;
    return word;
  }

  private takeString(): string {
    const quote = this.peek();
    this.i += 1;
    let value = "";
    while (!this.eof()) {
      const c = this.peek();
      if (c === "\n") throw new Bail();
      this.i += 1;
      if (c === "\\") {
        value += this.escape(this.peek());
        if (!this.eof()) this.i += 1;
        continue;
      }
      if (c === quote) {
        this.prev = "str";
        this.newline = false;
        return value;
      }
      value += c;
    }
    throw new Bail();
  }

  private readTemplate(): string[] {
    this.expect("`");
    const quasis: string[] = [];
    let current = "";
    while (!this.eof()) {
      const c = this.peek();
      if (c === "`") {
        this.i += 1;
        quasis.push(current);
        this.prev = "str";
        this.newline = false;
        return quasis;
      }
      if (c === "$" && this.peekAt(1) === "{") {
        quasis.push(current);
        current = "";
        this.i += 2;
        this.brace += 1;
        this.prev = "{";
        const target = this.brace - 1;
        while (!this.eof() && this.brace > target) {
          const before = this.i;
          this.skipSpace();
          if (this.peek() === "}" && this.brace === target + 1) {
            this.takeToken();
            break;
          }
          if (this.tryJsx()) continue;
          this.takeToken();
          if (this.i === before) throw new Bail();
        }
        continue;
      }
      this.i += 1;
      if (c === "\\") {
        current += this.escape(this.peek());
        if (!this.eof()) this.i += 1;
        continue;
      }
      if (c === "\n") this.line += 1;
      current += c;
    }
    throw new Bail();
  }

  private takeRegex(): void {
    this.expect("/");
    let inClass = false;
    while (!this.eof()) {
      const c = this.peek();
      if (c === "\n") throw new Bail();
      this.i += 1;
      if (c === "\\") {
        if (this.eof()) throw new Bail();
        this.i += 1;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        while (/[a-z]/i.test(this.peek())) this.i += 1;
        this.prev = "other";
        this.newline = false;
        return;
      }
    }
    throw new Bail();
  }

  private takeNumber(): string {
    const start = this.i;
    if (this.peek() === "0" && (this.peekAt(1) === "x" || this.peekAt(1) === "X" || this.peekAt(1) === "b" || this.peekAt(1) === "B" || this.peekAt(1) === "o" || this.peekAt(1) === "O")) {
      this.i += 2;
      while (/[0-9a-fA-F_]/.test(this.peek())) this.i += 1;
    } else {
      while (/[0-9_]/.test(this.peek())) this.i += 1;
      if (this.peek() === ".") {
        this.i += 1;
        while (/[0-9_]/.test(this.peek())) this.i += 1;
      }
      if (this.peek() === "e" || this.peek() === "E") {
        this.i += 1;
        if (this.peek() === "+" || this.peek() === "-") this.i += 1;
        while (/[0-9_]/.test(this.peek())) this.i += 1;
      }
    }
    if (this.peek() === "n") this.i += 1;
    this.prev = "num";
    this.newline = false;
    return this.source.slice(start, this.i).replaceAll("_", "");
  }

  private takeModuleSpecifier(): string {
    this.skipSpace();
    if (this.peek() !== "'" && this.peek() !== "\"") throw new Bail();
    return this.takeString();
  }

  private consumeClause(): void {
    this.skipSpace();
    const word = this.peekWord();
    if (word === "with" || word === "assert") {
      this.consumeWord(word);
      this.skipSpace();
      if (this.peek() === "{") this.scanBalancedFromHere();
    }
    this.skipSpace();
    if (this.peek() === ";") this.takeToken();
  }

  private regexAllowed(): boolean {
    return !new Set(["ident", "num", "str", ")", "]", "}", "jsx"]).has(this.prev);
  }

  private skipSpace(): void {
    this.gap = false;
    while (!this.eof()) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\f" || c === "\v") {
        this.i += 1;
        this.gap = true;
        continue;
      }
      if (c === "\n") {
        this.i += 1;
        this.line += 1;
        this.newline = true;
        this.gap = true;
        continue;
      }
      if (c === "\r") {
        this.i += 1;
        if (this.peek() === "\n") this.i += 1;
        this.line += 1;
        this.newline = true;
        this.gap = true;
        continue;
      }
      if (c === "/" && this.peekAt(1) === "/") {
        this.gap = true;
        while (!this.eof() && this.peek() !== "\n") this.i += 1;
        continue;
      }
      if (c === "/" && this.peekAt(1) === "*") {
        this.gap = true;
        this.skipBlockComment();
        continue;
      }
      return;
    }
  }

  private skipJsxSpace(): void {
    this.skipSpace();
  }

  private skipJsxTextSpace(): void {
    while (!this.eof()) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
        if (c === "\n" || c === "\r") {
          if (c === "\r" && this.peekAt(1) === "\n") this.i += 2;
          else this.i += 1;
          this.line += 1;
        } else {
          this.i += 1;
        }
        continue;
      }
      return;
    }
  }

  private skipBlockComment(): void {
    this.i += 2;
    while (!this.eof() && !(this.peek() === "*" && this.peekAt(1) === "/")) {
      if (this.peek() === "\n") this.line += 1;
      if (this.peek() === "\r") {
        this.line += 1;
        this.i += 1;
        if (this.peek() === "\n") this.i += 1;
        continue;
      }
      this.i += 1;
    }
    if (this.eof()) throw new Bail();
    this.i += 2;
  }

  private expect(c: string): void {
    this.skipJsxSpace();
    if (this.peek() !== c) throw new Bail();
    if (c === "{" || c === "}" || c === "(" || c === ")" || c === "[" || c === "]") this.bump(c);
    this.i += 1;
    this.prev = c;
    this.newline = false;
  }

  private expectWord(word: string): void {
    this.skipSpace();
    if (this.peekWord() !== word) throw new Bail();
    this.consumeWord(word);
  }

  private consumeWord(word: string): void {
    this.skipSpace();
    this.i += word.length;
    if (word === "return" || word === "throw" || word === "else" || word === "case" || word === "yield") this.prev = word;
    else this.prev = "ident";
    this.newline = false;
  }

  private peekWord(): string | null {
    this.rememberSpace();
    if (!this.isIdentStart(this.peek())) return null;
    let end = this.i + 1;
    while (this.isIdentPart(this.source[end] ?? "")) end += 1;
    return this.source.slice(this.i, end);
  }

  private peekWordAfter(word: string): string | null {
    let cursor = this.i + word.length;
    while (cursor < this.source.length && /[\s]/.test(this.source[cursor] ?? "")) cursor += 1;
    if (this.source[cursor] === "/" && this.source[cursor + 1] === "/") {
      while (cursor < this.source.length && this.source[cursor] !== "\n") cursor += 1;
    }
    if (!this.isIdentStart(this.source[cursor] ?? "")) return this.source[cursor] ?? null;
    let end = cursor + 1;
    while (this.isIdentPart(this.source[end] ?? "")) end += 1;
    return this.source.slice(cursor, end);
  }

  /** skipSpace moves the cursor. peekWord needs that. Restore nothing: skipSpace is idempotent enough if we call it. */
  private rememberSpace(): void {
    this.skipSpace();
  }

  private readJsxIdent(): string {
    if (!this.isJsxNameStart(this.peek())) throw new Bail();
    const start = this.i;
    this.i += 1;
    while (this.isJsxNamePart(this.peek())) this.i += 1;
    this.prev = "ident";
    this.newline = false;
    return this.source.slice(start, this.i);
  }

  private escape(c: string): string {
    if (c === "n") return "\n";
    if (c === "r") return "\r";
    if (c === "t") return "\t";
    if (c === "b") return "\b";
    if (c === "f") return "\f";
    if (c === "v") return "\v";
    if (c === "0") return "\0";
    return c;
  }

  private startsWith(text: string): boolean {
    return this.source.startsWith(text, this.i);
  }

  private peek(): string {
    return this.source[this.i] ?? "";
  }

  private peekAt(offset: number): string {
    return this.source[this.i + offset] ?? "";
  }

  private eof(): boolean {
    return this.i >= this.source.length;
  }

  private isIdentStart(c: string): boolean {
    return /[A-Za-z_$]/.test(c);
  }

  private isIdentPart(c: string): boolean {
    return /[A-Za-z0-9_$]/.test(c);
  }

  private isJsxNameStart(c: string): boolean {
    return /[A-Za-z_$]/.test(c);
  }

  private isJsxNamePart(c: string): boolean {
    return /[A-Za-z0-9_$-]/.test(c);
  }

  private isNumStart(c: string): boolean {
    return /[0-9]/.test(c) || (c === "." && /[0-9]/.test(this.peekAt(1)));
  }

  private mark(): Mark {
    return {
      i: this.i,
      line: this.line,
      prev: this.prev,
      newline: this.newline,
      brace: this.brace,
      paren: this.paren,
      bracket: this.bracket,
      openings: this.openings.length,
      angle: this.angle,
      collectors: this.collectors.map((collector) => ({
        state: collector.state?.length ?? -1,
        recipe: collector.recipe.length,
      })),
    };
  }

  private restore(mark: Mark): void {
    this.i = mark.i;
    this.line = mark.line;
    this.prev = mark.prev;
    this.newline = mark.newline;
    this.brace = mark.brace;
    this.paren = mark.paren;
    this.bracket = mark.bracket;
    this.openings.length = mark.openings;
    this.angle = mark.angle;
    for (let index = 0; index < this.collectors.length; index += 1) {
      const collector = this.collectors[index];
      const saved = mark.collectors[index];
      if (!collector || !saved) continue;
      collector.recipe.length = saved.recipe;
      if (collector.state && saved.state >= 0) collector.state.length = saved.state;
    }
  }
}

function directLiteral(expr: Expr): string | undefined {
  if (expr.kind === "string") return expr.value;
  if (expr.kind === "bool") return expr.value ? "true" : "false";
  if (expr.kind === "num") return expr.value;
  return undefined;
}

function classTokensOf(expr: Expr): string[] {
  switch (expr.kind) {
    case "string":
      return splitClasses(expr.value);
    case "template":
      return expr.quasis.flatMap((quasi) => splitClasses(quasi));
    case "call":
      return expr.args.flatMap((arg) => classTokensOf(arg));
    case "paren":
      return classTokensOf(expr.expr);
    case "array":
      return expr.elements.flatMap((element) => classTokensOf(element));
    case "bin":
      return expr.parts.flatMap((part) => classTokensOf(part));
    default:
      return [];
  }
}

function splitClasses(value: string): string[] {
  return value.split(/\s+/).filter((token) => token.length > 0);
}
