import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import * as ts from "typescript";
import type { AppApiContractValue } from "./app-api-contracts";
import { defaultGateSdkRoot, loadTsProgram } from "./gate-sdk-used-operations.ts";

export type AppApiDependencySource = "static";

export interface AppApiDependency {
  targetOrgId: string;
  targetAppId: string;
  operationId: string;
  source: AppApiDependencySource;
}

export interface AppApiUnresolvedDependency {
  reason:
    | "missing-arguments"
    | "dynamic-arguments"
    | "missing-path"
    | "dynamic-path"
    | "missing-orgId"
    | "dynamic-orgId"
    | "missing-appId"
    | "dynamic-appId"
    | "missing-operationId"
    | "dynamic-operationId";
  file: string;
  line: number;
  column: number;
}

export interface AppApiDependenciesResult {
  dependencies: AppApiDependency[];
  unresolved: AppApiUnresolvedDependency[];
  sdkVersion: string | null;
  sdkRoot: string;
  tsconfig?: string;
}

export interface AppApiResolvedCall {
  targetOrgId: string;
  targetAppId: string;
  operationId: string;
  source: AppApiDependencySource;
  file: string;
  line: number;
  column: number;
  input?: AppApiContractValue;
}

export interface AppApiDependencyCallsResult {
  calls: AppApiResolvedCall[];
  unresolved: AppApiUnresolvedDependency[];
  sdkVersion: string | null;
  sdkRoot: string;
  tsconfig?: string;
}

export interface AnalyzeAppApiDependenciesOptions {
  projectRoot: string;
  scopeRoot?: string;
}

interface ResolveContext {
  checker: ts.TypeChecker;
  seenSymbols: Set<ts.Symbol>;
}

export async function analyzeAppApiDependencies(
  options: AnalyzeAppApiDependenciesOptions,
): Promise<AppApiDependenciesResult> {
  const result = await analyzeAppApiDependenciesDetailed(options);

  return {
    dependencies: result.dependencies,
    unresolved: result.unresolved,
    sdkVersion: result.sdkVersion,
    sdkRoot: result.sdkRoot,
    tsconfig: result.tsconfig,
  };
}

export async function analyzeAppApiDependencyCalls(
  options: AnalyzeAppApiDependenciesOptions,
): Promise<AppApiDependencyCallsResult> {
  const result = await analyzeAppApiDependenciesDetailed(options);

  return {
    calls: result.calls,
    unresolved: result.unresolved,
    sdkVersion: result.sdkVersion,
    sdkRoot: result.sdkRoot,
    tsconfig: result.tsconfig,
  };
}

async function analyzeAppApiDependenciesDetailed(
  options: AnalyzeAppApiDependenciesOptions,
): Promise<{
  dependencies: AppApiDependency[];
  calls: AppApiResolvedCall[];
  unresolved: AppApiUnresolvedDependency[];
  sdkVersion: string | null;
  sdkRoot: string;
  tsconfig?: string;
}> {
  const loadedPrograms = loadScopedTsPrograms(options);
  if (loadedPrograms.length === 0) {
    throw new Error(
      "No tsconfig.json under current directory, or tsconfig matched zero source files. Fix tsconfig include.",
    );
  }

  const { sdkVersion, sdkRoot } = await resolveSdkVersion(options);
  const dependencies = new Set<string>();
  const calls = new Set<string>();
  const unresolved = new Set<string>();

  for (const loaded of loadedPrograms) {
    const part = collectAppApiDependencies(
      loaded.program,
      resolve(options.projectRoot),
      options.scopeRoot ? resolve(options.scopeRoot) : undefined,
    );

    for (const dependency of part.dependencies) {
      dependencies.add(serializeDependency(dependency));
    }

    for (const call of part.calls) {
      calls.add(serializeResolvedCall(call));
    }

    for (const entry of part.unresolved) {
      unresolved.add(serializeUnresolved(entry));
    }
  }

  return {
    dependencies: [...dependencies]
      .map(deserializeDependency)
      .sort(compareDependencies),
    calls: [...calls].map(deserializeResolvedCall).sort(compareResolvedCalls),
    unresolved: [...unresolved]
      .map(deserializeUnresolved)
      .sort(compareUnresolved),
    sdkVersion,
    sdkRoot,
    tsconfig: loadedPrograms[0]?.configPath,
  };
}

function loadScopedTsPrograms(
  options: AnalyzeAppApiDependenciesOptions,
): Array<{ program: ts.Program; configPath: string }> {
  if (!options.scopeRoot) {
    const single = loadTsProgram(options.projectRoot);
    return single ? [single] : [];
  }

  const roots = [
    resolve(options.scopeRoot),
    resolve(options.scopeRoot, "backend"),
    resolve(options.projectRoot),
  ];

  const programs: Array<{ program: ts.Program; configPath: string }> = [];
  const seenConfigPaths = new Set<string>();

  for (const root of roots) {
    const loaded = loadTsProgram(root);
    if (!loaded) continue;
    if (seenConfigPaths.has(loaded.configPath)) continue;

    seenConfigPaths.add(loaded.configPath);
    programs.push(loaded);
  }

  return programs;
}

async function resolveSdkVersion(options: AnalyzeAppApiDependenciesOptions): Promise<{
  sdkVersion: string | null;
  sdkRoot: string;
}> {
  const candidates: string[] = [];
  if (options.scopeRoot) {
    candidates.push(defaultGateSdkRoot(options.scopeRoot));
  }
  candidates.push(defaultGateSdkRoot(options.projectRoot));

  for (const sdkRoot of candidates) {
    const sdkVersion = await readSdkVersion(sdkRoot);
    if (sdkVersion !== null) {
      return { sdkVersion, sdkRoot };
    }
  }

  return {
    sdkVersion: null,
    sdkRoot: candidates[0] ?? defaultGateSdkRoot(options.projectRoot),
  };
}

async function readSdkVersion(sdkRoot: string): Promise<string | null> {
  try {
    const raw = await readFile(join(sdkRoot, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

function collectAppApiDependencies(
  program: ts.Program,
  projectRoot: string,
  scopeRoot?: string,
): {
  dependencies: AppApiDependency[];
  calls: AppApiResolvedCall[];
  unresolved: AppApiUnresolvedDependency[];
} {
  const checker = program.getTypeChecker();
  const dependencies: AppApiDependency[] = [];
  const calls: AppApiResolvedCall[] = [];
  const unresolved: AppApiUnresolvedDependency[] = [];

  const isWithinScope = (fileName: string): boolean => {
    if (!scopeRoot) return true;
    const resolvedFileName = resolve(fileName);
    return (
      resolvedFileName === scopeRoot ||
      resolvedFileName.startsWith(`${scopeRoot}${sep}`)
    );
  };

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes("node_modules")) continue;
    if (!isWithinScope(sourceFile.fileName)) continue;

    const ctx: ResolveContext = {
      checker,
      seenSymbols: new Set<ts.Symbol>(),
    };

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callTarget = getCallTarget(node);
        if (callTarget && callTarget.methodName === "callAppApi") {
          const receiverType = checker.getTypeAtLocation(callTarget.receiverExpr);
          if (isAppApisApiInstanceType(receiverType)) {
            const resolved = resolveCallDependency(node, sourceFile, projectRoot, ctx);
            if (resolved.type === "resolved") {
              dependencies.push(resolved.dependency);
              calls.push(resolved.call);
            } else {
              unresolved.push(...resolved.unresolved);
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return { dependencies, calls, unresolved };
}

function getCallTarget(
  node: ts.CallExpression,
): { receiverExpr: ts.Expression; methodName: string } | null {
  const expression = node.expression;

  if (
    ts.isPropertyAccessExpression(expression) ||
    ts.isPropertyAccessChain(expression)
  ) {
    return {
      receiverExpr: expression.expression,
      methodName: expression.name.text,
    };
  }

  if (ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression;
    if (argument && ts.isStringLiteralLike(argument)) {
      return {
        receiverExpr: expression.expression,
        methodName: argument.text,
      };
    }
  }

  return null;
}

function isAppApisApiInstanceType(type: ts.Type): boolean {
  const hasTargetName = (symbol: ts.Symbol | undefined): boolean => {
    if (!symbol) return false;
    if (symbol.getName() !== "AppApisApi") return false;

    const declarations = symbol.declarations ?? [];
    if (declarations.length === 0) return true;

    return declarations.some((declaration) => {
      const sourcePath = normalizePath(declaration.getSourceFile().fileName);
      return sourcePath.includes("/@fusebase/fusebase-gate-sdk/");
    });
  };

  if (hasTargetName(type.symbol)) return true;
  if (hasTargetName(type.aliasSymbol)) return true;

  if (type.isUnion()) {
    return type.types.some((part) => isAppApisApiInstanceType(part));
  }

  if (type.isIntersection()) {
    return type.types.some((part) => isAppApisApiInstanceType(part));
  }

  return false;
}

function resolveCallDependency(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  projectRoot: string,
  ctx: ResolveContext,
):
  | { type: "resolved"; dependency: AppApiDependency; call: AppApiResolvedCall }
  | { type: "unresolved"; unresolved: AppApiUnresolvedDependency[] } {
  const position = getNodePosition(sourceFile, call, projectRoot);

  const callArg = call.arguments[0];
  if (!callArg) {
    return {
      type: "unresolved",
      unresolved: [{ ...position, reason: "missing-arguments" }],
    };
  }

  const callProperties = resolveObjectLiteralProperties(callArg, ctx);
  if (!callProperties) {
    return {
      type: "unresolved",
      unresolved: [{ ...position, reason: "dynamic-arguments" }],
    };
  }

  const pathExpression = callProperties.get("path");
  if (!pathExpression) {
    return {
      type: "unresolved",
      unresolved: [{ ...position, reason: "missing-path" }],
    };
  }

  const pathProperties = resolveObjectLiteralProperties(pathExpression, ctx);
  if (!pathProperties) {
    return {
      type: "unresolved",
      unresolved: [{ ...position, reason: "dynamic-path" }],
    };
  }

  const orgId = resolveRequiredStringProperty(
    pathProperties,
    "orgId",
    "missing-orgId",
    "dynamic-orgId",
    position,
    ctx,
  );

  const appId = resolveRequiredStringProperty(
    pathProperties,
    "appId",
    "missing-appId",
    "dynamic-appId",
    position,
    ctx,
  );

  const operationId = resolveRequiredStringProperty(
    pathProperties,
    "operationId",
    "missing-operationId",
    "dynamic-operationId",
    position,
    ctx,
  );

  if (
    orgId.type === "unresolved" ||
    appId.type === "unresolved" ||
    operationId.type === "unresolved"
  ) {
    const unresolved: AppApiUnresolvedDependency[] = [];
    if (orgId.type === "unresolved") {
      unresolved.push(orgId.unresolved);
    }
    if (appId.type === "unresolved") {
      unresolved.push(appId.unresolved);
    }
    if (operationId.type === "unresolved") {
      unresolved.push(operationId.unresolved);
    }
    return { type: "unresolved", unresolved };
  }

  const inputExpression = callProperties.get("body");
  const input = inputExpression
    ? resolveContractValueExpression(inputExpression, ctx)
    : undefined;

  return {
    type: "resolved",
    dependency: {
      targetOrgId: orgId.value,
      targetAppId: appId.value,
      operationId: operationId.value,
      source: "static",
    },
    call: {
      targetOrgId: orgId.value,
      targetAppId: appId.value,
      operationId: operationId.value,
      source: "static",
      ...position,
      ...(input !== undefined && { input }),
    },
  };
}

function resolveContractValueExpression(
  expression: ts.Expression,
  ctx: ResolveContext,
): AppApiContractValue | undefined {
  const unwrapped = unwrapExpression(expression);

  if (
    ts.isStringLiteralLike(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped)
  ) {
    return unwrapped.text;
  }

  if (ts.isNumericLiteral(unwrapped)) {
    return Number(unwrapped.text);
  }

  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }

  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }

  if (ts.isPrefixUnaryExpression(unwrapped)) {
    const operandValue = resolveContractValueExpression(unwrapped.operand, ctx);
    if (typeof operandValue === "number") {
      return unwrapped.operator === ts.SyntaxKind.MinusToken
        ? -operandValue
        : operandValue;
    }
  }

  if (ts.isArrayLiteralExpression(unwrapped)) {
    const values: AppApiContractValue[] = [];
    for (const element of unwrapped.elements) {
      if (ts.isSpreadElement(element)) {
        const inferred = inferContractMatcherFromExpression(element.expression, ctx);
        if (inferred !== undefined) {
          values.push(inferred);
        }
        continue;
      }

      const value =
        resolveContractValueExpression(element, ctx) ??
        inferContractMatcherFromExpression(element, ctx);
      if (value !== undefined) {
        values.push(value);
      }
    }
    return values;
  }

  if (ts.isObjectLiteralExpression(unwrapped)) {
    const objectValue: Record<string, AppApiContractValue> = {};

    for (const property of unwrapped.properties) {
      if (ts.isSpreadAssignment(property)) {
        continue;
      }

      if (ts.isShorthandPropertyAssignment(property)) {
        const propertyValue =
          resolveContractValueExpression(property.name, ctx) ??
          inferContractMatcherFromExpression(property.name, ctx);
        if (propertyValue !== undefined) {
          objectValue[property.name.text] = propertyValue;
        }
        continue;
      }

      if (!ts.isPropertyAssignment(property)) {
        continue;
      }

      const key = getPropertyNameText(property.name);
      if (key === null) {
        continue;
      }

      const propertyValue =
        resolveContractValueExpression(property.initializer, ctx) ??
        inferContractMatcherFromExpression(property.initializer, ctx);
      if (propertyValue !== undefined) {
        objectValue[key] = propertyValue;
      }
    }

    return objectValue;
  }

  if (ts.isIdentifier(unwrapped)) {
    const initializer = resolveIdentifierInitializer(unwrapped, ctx);
    if (initializer) {
      return resolveContractValueExpression(initializer, ctx);
    }
    return inferContractMatcherFromExpression(unwrapped, ctx);
  }

  if (
    ts.isPropertyAccessExpression(unwrapped) ||
    ts.isPropertyAccessChain(unwrapped) ||
    ts.isElementAccessExpression(unwrapped)
  ) {
    const valueExpression = resolvePropertyAccessExpression(unwrapped, ctx);
    if (valueExpression) {
      return resolveContractValueExpression(valueExpression, ctx);
    }
    return inferContractMatcherFromExpression(unwrapped, ctx);
  }

  return inferContractMatcherFromExpression(unwrapped, ctx);
}

function inferContractMatcherFromExpression(
  expression: ts.Expression,
  ctx: ResolveContext,
): AppApiContractValue | undefined {
  return inferContractValueFromType(ctx.checker.getTypeAtLocation(expression), ctx);
}

function inferContractValueFromType(
  type: ts.Type,
  ctx: ResolveContext,
): AppApiContractValue | undefined {
  if (type.isUnion()) {
    const nonNullTypes = type.types.filter((part) => !isNullishType(part));
    const enumValues = collectEnumValues(nonNullTypes);
    if (enumValues.length > 0) {
      return { $matcher: "enum", $value: enumValues };
    }

    if (nonNullTypes.every(isStringLikeType)) {
      return { $matcher: "string" };
    }

    if (nonNullTypes.every(isNumberLikeType)) {
      return { $matcher: "number" };
    }

    if (nonNullTypes.every(isBooleanLikeType)) {
      return { $matcher: "boolean" };
    }

    const firstDefined = nonNullTypes[0];
    return firstDefined ? inferContractValueFromType(firstDefined, ctx) : undefined;
  }

  if (isStringLikeType(type)) {
    return { $matcher: "string" };
  }

  if (isNumberLikeType(type)) {
    return { $matcher: "number" };
  }

  if (isBooleanLikeType(type)) {
    return { $matcher: "boolean" };
  }

  if (ctx.checker.isArrayType(type)) {
    const elementType = getArrayElementType(type, ctx.checker);
    if (!elementType) {
      return [];
    }

    const elementValue = inferContractValueFromType(elementType, ctx);
    return elementValue === undefined ? [] : [elementValue];
  }

  return undefined;
}

function isNullishType(type: ts.Type): boolean {
  return (
    (type.flags & ts.TypeFlags.Null) !== 0 ||
    (type.flags & ts.TypeFlags.Undefined) !== 0
  );
}

function isStringLikeType(type: ts.Type): boolean {
  return (
    (type.flags & ts.TypeFlags.StringLike) !== 0 ||
    type.isStringLiteral()
  );
}

function isNumberLikeType(type: ts.Type): boolean {
  return (
    (type.flags & ts.TypeFlags.NumberLike) !== 0 ||
    type.isNumberLiteral()
  );
}

function isBooleanLikeType(type: ts.Type): boolean {
  return (
    (type.flags & ts.TypeFlags.BooleanLike) !== 0 ||
    typeToBooleanLiteralValue(type) !== undefined
  );
}

function collectEnumValues(types: ts.Type[]): Array<string | number | boolean> {
  const values: Array<string | number | boolean> = [];

  for (const type of types) {
    if (type.isStringLiteral()) {
      values.push(type.value);
      continue;
    }

    if (type.isNumberLiteral()) {
      values.push(type.value);
      continue;
    }

    const booleanLiteralValue = typeToBooleanLiteralValue(type);
    if (booleanLiteralValue !== undefined) {
      values.push(booleanLiteralValue);
      continue;
    }

    return [];
  }

  return [...new Set(values)];
}

function getArrayElementType(
  type: ts.Type,
  checker: ts.TypeChecker,
): ts.Type | undefined {
  if (!("typeArguments" in type) || !Array.isArray(type.typeArguments)) {
    return undefined;
  }

  const [elementType] = checker.getTypeArguments(type as ts.TypeReference);
  return elementType;
}

function typeToBooleanLiteralValue(type: ts.Type): boolean | undefined {
  if ((type.flags & ts.TypeFlags.BooleanLiteral) === 0) {
    return undefined;
  }

  const text = type.isLiteral() ? `${type.value}` : type.symbol?.escapedName;
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }

  return undefined;
}

function resolveRequiredStringProperty(
  properties: Map<string, ts.Expression>,
  propertyName: string,
  missingReason: AppApiUnresolvedDependency["reason"],
  dynamicReason: AppApiUnresolvedDependency["reason"],
  position: Omit<AppApiUnresolvedDependency, "reason">,
  ctx: ResolveContext,
):
  | { type: "resolved"; value: string }
  | { type: "unresolved"; unresolved: AppApiUnresolvedDependency } {
  const expression = properties.get(propertyName);
  if (!expression) {
    return {
      type: "unresolved",
      unresolved: { ...position, reason: missingReason },
    };
  }

  const value = resolveStringExpression(expression, ctx);
  if (value === null) {
    return {
      type: "unresolved",
      unresolved: { ...position, reason: dynamicReason },
    };
  }

  return {
    type: "resolved",
    value,
  };
}

function resolveObjectLiteralProperties(
  expression: ts.Expression,
  ctx: ResolveContext,
): Map<string, ts.Expression> | null {
  const unwrapped = unwrapExpression(expression);

  if (ts.isObjectLiteralExpression(unwrapped)) {
    const map = new Map<string, ts.Expression>();

    for (const property of unwrapped.properties) {
      if (ts.isSpreadAssignment(property)) {
        return null;
      }

      if (ts.isPropertyAssignment(property)) {
        const key = getPropertyNameText(property.name);
        if (key === null) return null;
        map.set(key, property.initializer);
        continue;
      }

      if (ts.isShorthandPropertyAssignment(property)) {
        map.set(property.name.text, property.name);
        continue;
      }

      return null;
    }

    return map;
  }

  if (ts.isIdentifier(unwrapped)) {
    const initializer = resolveIdentifierInitializer(unwrapped, ctx);
    if (!initializer) return null;
    return resolveObjectLiteralProperties(initializer, ctx);
  }

  if (
    ts.isPropertyAccessExpression(unwrapped) ||
    ts.isPropertyAccessChain(unwrapped) ||
    ts.isElementAccessExpression(unwrapped)
  ) {
    const valueExpression = resolvePropertyAccessExpression(unwrapped, ctx);
    if (!valueExpression) return null;
    return resolveObjectLiteralProperties(valueExpression, ctx);
  }

  return null;
}

function resolveStringExpression(
  expression: ts.Expression,
  ctx: ResolveContext,
): string | null {
  const unwrapped = unwrapExpression(expression);

  if (
    ts.isStringLiteralLike(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped)
  ) {
    return unwrapped.text;
  }

  if (ts.isIdentifier(unwrapped)) {
    const initializer = resolveIdentifierInitializer(unwrapped, ctx);
    if (!initializer) return null;
    return resolveStringExpression(initializer, ctx);
  }

  if (
    ts.isPropertyAccessExpression(unwrapped) ||
    ts.isPropertyAccessChain(unwrapped) ||
    ts.isElementAccessExpression(unwrapped)
  ) {
    const valueExpression = resolvePropertyAccessExpression(unwrapped, ctx);
    if (!valueExpression) return null;
    return resolveStringExpression(valueExpression, ctx);
  }

  return null;
}

function resolvePropertyAccessExpression(
  expression:
    | ts.PropertyAccessExpression
    | ts.PropertyAccessChain
    | ts.ElementAccessExpression,
  ctx: ResolveContext,
): ts.Expression | null {
  let key: string | null = null;
  if (
    ts.isPropertyAccessExpression(expression) ||
    ts.isPropertyAccessChain(expression)
  ) {
    key = expression.name.text;
  }

  if (ts.isElementAccessExpression(expression)) {
    const arg = expression.argumentExpression;
    if (!arg || !ts.isStringLiteralLike(arg)) {
      return null;
    }
    key = arg.text;
  }

  if (!key) return null;

  const baseProperties = resolveObjectLiteralProperties(expression.expression, ctx);
  if (!baseProperties) return null;

  return baseProperties.get(key) ?? null;
}

function resolveIdentifierInitializer(
  identifier: ts.Identifier,
  ctx: ResolveContext,
): ts.Expression | null {
  let symbol = ctx.checker.getSymbolAtLocation(identifier);
  if (!symbol) return null;

  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = ctx.checker.getAliasedSymbol(symbol);
  }

  if (ctx.seenSymbols.has(symbol)) {
    return null;
  }

  ctx.seenSymbols.add(symbol);
  try {
    const declarations = symbol.declarations ?? [];

    for (const declaration of declarations) {
      if (!ts.isVariableDeclaration(declaration)) continue;
      if (!isConstVariableDeclaration(declaration)) continue;
      if (!declaration.initializer) continue;

      return declaration.initializer;
    }

    return null;
  } finally {
    ctx.seenSymbols.delete(symbol);
  }
}

function isConstVariableDeclaration(declaration: ts.VariableDeclaration): boolean {
  const declarationList = declaration.parent;
  if (!ts.isVariableDeclarationList(declarationList)) {
    return false;
  }

  return (declarationList.flags & ts.NodeFlags.Const) !== 0;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (true) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }

    if (ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }

    if (ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }

    if (ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }

    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }

    return current;
  }
}

function getPropertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
    return name.text;
  }

  if (ts.isNumericLiteral(name)) {
    return name.text;
  }

  if (ts.isComputedPropertyName(name)) {
    const expression = unwrapExpression(name.expression);
    if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) {
      return expression.text;
    }
  }

  return null;
}

function getNodePosition(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  projectRoot: string,
): Omit<AppApiUnresolvedDependency, "reason"> {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  const relPath = relative(projectRoot, sourceFile.fileName);

  return {
    file: relPath.startsWith("..") ? sourceFile.fileName : normalizePath(relPath),
    line: position.line + 1,
    column: position.character + 1,
  };
}

function normalizePath(filePath: string): string {
  return filePath.split("\\").join("/");
}

function serializeDependency(dep: AppApiDependency): string {
  return `${dep.targetOrgId}\u0001${dep.targetAppId}\u0001${dep.operationId}\u0001${dep.source}`;
}

function deserializeDependency(value: string): AppApiDependency {
  const [targetOrgId, targetAppId, operationId, source] = value.split("\u0001");
  return {
    targetOrgId: targetOrgId ?? "",
    targetAppId: targetAppId ?? "",
    operationId: operationId ?? "",
    source: source === "static" ? "static" : "static",
  };
}

function compareDependencies(a: AppApiDependency, b: AppApiDependency): number {
  return (
    a.targetOrgId.localeCompare(b.targetOrgId) ||
    a.targetAppId.localeCompare(b.targetAppId) ||
    a.operationId.localeCompare(b.operationId) ||
    a.source.localeCompare(b.source)
  );
}

function serializeUnresolved(entry: AppApiUnresolvedDependency): string {
  return `${entry.file}\u0001${entry.line}\u0001${entry.column}\u0001${entry.reason}`;
}

function serializeResolvedCall(call: AppApiResolvedCall): string {
  return JSON.stringify(call);
}

function deserializeResolvedCall(value: string): AppApiResolvedCall {
  const parsed = JSON.parse(value) as Partial<AppApiResolvedCall>;

  return {
    targetOrgId:
      typeof parsed.targetOrgId === "string" ? parsed.targetOrgId : "",
    targetAppId:
      typeof parsed.targetAppId === "string" ? parsed.targetAppId : "",
    operationId:
      typeof parsed.operationId === "string" ? parsed.operationId : "",
    source: parsed.source === "static" ? "static" : "static",
    file: typeof parsed.file === "string" ? parsed.file : "",
    line: typeof parsed.line === "number" ? parsed.line : 0,
    column: typeof parsed.column === "number" ? parsed.column : 0,
    ...(parsed.input !== undefined && { input: parsed.input as AppApiContractValue }),
  };
}

function deserializeUnresolved(value: string): AppApiUnresolvedDependency {
  const [file, line, column, reason] = value.split("\u0001");
  return {
    file: file ?? "",
    line: Number(line ?? 0),
    column: Number(column ?? 0),
    reason: isUnresolvedReason(reason) ? reason : "dynamic-arguments",
  };
}

function compareUnresolved(
  a: AppApiUnresolvedDependency,
  b: AppApiUnresolvedDependency,
): number {
  return (
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.column - b.column ||
    a.reason.localeCompare(b.reason)
  );
}

function compareResolvedCalls(a: AppApiResolvedCall, b: AppApiResolvedCall): number {
  return (
    a.targetOrgId.localeCompare(b.targetOrgId) ||
    a.targetAppId.localeCompare(b.targetAppId) ||
    a.operationId.localeCompare(b.operationId) ||
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.column - b.column
  );
}

function isUnresolvedReason(
  value: string | undefined,
): value is AppApiUnresolvedDependency["reason"] {
  return (
    value === "missing-arguments" ||
    value === "dynamic-arguments" ||
    value === "missing-path" ||
    value === "dynamic-path" ||
    value === "missing-orgId" ||
    value === "dynamic-orgId" ||
    value === "missing-appId" ||
    value === "dynamic-appId" ||
    value === "missing-operationId" ||
    value === "dynamic-operationId"
  );
}
