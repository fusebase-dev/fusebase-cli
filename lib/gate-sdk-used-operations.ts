/**
 * Gate SDK: allowlist from installed @fusebase/fusebase-gate-sdk (opId in dist/apis)
 * + static analysis of TypeScript sources for calls on SDK API classes discovered
 * automatically from dist/apis/*.js.
 * Invoked by the hidden CLI `fusebase analyze gate --operations` (not end-user documented).
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import * as ts from "typescript";
import type { GateSdkOperationsSnapshot } from "./config.ts";

export interface GateOperationsResult {
  /** All operation ids from the installed SDK (sorted). */
  sdkOperationIds: string[];
  /** Operation ids referenced from *Api instances in app TS (sorted). */
  usedOps: string[];
  /** Backend code passes trustedRuntimeContext to isolated-store SQL APIs. */
  usesTrustedRuntimeContext: boolean;
  sdkVersion: string | null;
  sdkRoot: string;
  tsconfig?: string;
}

export async function extractAllowlistFromSdk(sdkRoot: string): Promise<{
  opIds: string[];
  apiClassNames: string[];
  apisDir: string;
}> {
  const apisDir = join(sdkRoot, "dist/apis");
  let files: string[];
  try {
    const entries = await readdir(apisDir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name.endsWith(".js"))
      .map((e) => join(apisDir, e.name));
  } catch {
    throw new Error(
      `Cannot read SDK apis dir: ${apisDir}. Install @fusebase/fusebase-gate-sdk in node_modules.`,
    );
  }

  const opIds = new Set<string>();
  const apiClassNames = new Set<string>();
  const opIdRe = /opId:\s*"([^"]+)"/g;

  for (const file of files) {
    const className = basename(file, ".js");
    if (className.endsWith("Api")) {
      apiClassNames.add(className);
    }
    const content = await readFile(file, "utf-8");
    let m: RegExpExecArray | null;
    while ((m = opIdRe.exec(content)) !== null) {
      opIds.add(m[1]!);
    }
  }

  return {
    opIds: [...opIds].sort(),
    apiClassNames: [...apiClassNames].sort(),
    apisDir,
  };
}

export function loadTsProgram(projectRoot: string): {
  program: ts.Program;
  configPath: string;
} | null {
  const root = resolve(projectRoot);
  for (const configName of ["tsconfig.json", "tsconfig.app.json"]) {
    const configPath = ts.findConfigFile(root, ts.sys.fileExists, configName);
    if (!configPath) continue;

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error || !configFile.config) {
      continue;
    }

    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      dirname(configPath),
      undefined,
      configPath,
    );

    if (parsed.fileNames.length === 0) {
      continue;
    }

    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: parsed.options,
    });

    return { program, configPath };
  }

  return null;
}

function unwrapTypes(type: ts.Type): ts.Type[] {
  if (type.isUnion()) {
    return type.types.flatMap((member) => unwrapTypes(member));
  }
  if (type.isIntersection()) {
    return type.types.flatMap((member) => unwrapTypes(member));
  }
  return [type];
}

function extractStringLiteralKeys(type: ts.Type): Set<string> {
  const keys = new Set<string>();
  if (type.isUnion()) {
    for (const member of type.types) {
      for (const key of extractStringLiteralKeys(member)) {
        keys.add(key);
      }
    }
    return keys;
  }
  if (type.isStringLiteral()) {
    keys.add(type.value);
    return keys;
  }
  return keys;
}

function getPickTypeArguments(
  type: ts.Type,
): { baseType: ts.Type; keys: Set<string> } | null {
  if (type.aliasSymbol?.getName() !== "Pick") {
    return null;
  }
  const args = type.aliasTypeArguments;
  if (!args || args.length < 2) {
    return null;
  }
  return {
    baseType: args[0]!,
    keys: extractStringLiteralKeys(args[1]!),
  };
}

function isGateApiInstanceType(
  type: ts.Type,
  apiClassNames: ReadonlySet<string>,
): boolean {
  const trySym = (sym: ts.Symbol | undefined): boolean => {
    if (!sym) return false;
    return apiClassNames.has(sym.getName());
  };

  if (trySym(type.symbol)) return true;
  if (trySym(type.aliasSymbol)) return true;

  const target = (type as ts.TypeReference).target;
  if (trySym(target?.symbol)) return true;

  if (type.isUnion()) {
    return type.types.some((t) => isGateApiInstanceType(t, apiClassNames));
  }
  if (type.isIntersection()) {
    return type.types.some((t) => isGateApiInstanceType(t, apiClassNames));
  }

  return false;
}

function receiverSupportsGateSdkOperation(
  checker: ts.TypeChecker,
  receiverType: ts.Type,
  methodName: string,
  apiClassNames: ReadonlySet<string>,
): boolean {
  if (isGateApiInstanceType(receiverType, apiClassNames)) {
    return true;
  }

  for (const memberType of unwrapTypes(receiverType)) {
    const pick = getPickTypeArguments(memberType);
    if (
      pick &&
      pick.keys.has(methodName) &&
      isGateApiInstanceType(pick.baseType, apiClassNames)
    ) {
      return true;
    }

    const prop = memberType.getProperty(methodName);
    if (!prop) continue;

    for (const decl of prop.declarations ?? []) {
      if (!ts.isMethodDeclaration(decl) && !ts.isMethodSignature(decl)) {
        continue;
      }
      const parent = decl.parent;
      if (
        (ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent)) &&
        parent.name &&
        apiClassNames.has(parent.name.text)
      ) {
        return true;
      }
    }

    const valueDeclaration = prop.valueDeclaration;
    if (valueDeclaration) {
      const propType = checker.getTypeOfSymbolAtLocation(
        prop,
        valueDeclaration,
      );
      const signatures = propType.getCallSignatures();
      for (const signature of signatures) {
        const declaration = signature.getDeclaration();
        const parent = declaration?.parent;
        if (
          parent &&
          (ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent)) &&
          parent.name &&
          apiClassNames.has(parent.name.text)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

export function collectUsedOperations(
  program: ts.Program,
  allowlist: Set<string>,
  apiClassNames: ReadonlySet<string>,
  scopeRoot?: string,
): Set<string> {
  const checker = program.getTypeChecker();
  const used = new Set<string>();
  const resolvedScopeRoot = scopeRoot ? resolve(scopeRoot) : undefined;

  const isWithinScope = (fileName: string): boolean => {
    if (!resolvedScopeRoot) return true;
    const resolvedFileName = resolve(fileName);
    return (
      resolvedFileName === resolvedScopeRoot ||
      resolvedFileName.startsWith(`${resolvedScopeRoot}${sep}`)
    );
  };

  function visitSourceFile(sf: ts.SourceFile): void {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const expr = node.expression;
        let receiverExpr: ts.Expression | undefined;
        let methodName: string | undefined;

        if (
          ts.isPropertyAccessExpression(expr) ||
          ts.isPropertyAccessChain(expr)
        ) {
          receiverExpr = expr.expression;
          methodName = expr.name.text;
        } else if (ts.isElementAccessExpression(expr)) {
          receiverExpr = expr.expression;
          const arg = expr.argumentExpression;
          if (arg && ts.isStringLiteralLike(arg)) {
            methodName = arg.text;
          }
        }

        if (!receiverExpr || !methodName) {
          ts.forEachChild(node, visit);
          return;
        }

        if (!allowlist.has(methodName)) {
          ts.forEachChild(node, visit);
          return;
        }

        const receiverType = checker.getTypeAtLocation(receiverExpr);
        if (
          receiverSupportsGateSdkOperation(
            checker,
            receiverType,
            methodName,
            apiClassNames,
          )
        ) {
          used.add(methodName);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);
  }

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (sf.fileName.includes("node_modules")) continue;
    if (!isWithinScope(sf.fileName)) continue;
    visitSourceFile(sf);
  }

  return used;
}

function isTrustedRuntimeContextPropertyName(name: ts.PropertyName): boolean {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
    return name.text === "trustedRuntimeContext";
  }
  return false;
}

export function collectTrustedRuntimeContextUsage(
  program: ts.Program,
  scopeRoot?: string,
): boolean {
  const resolvedScopeRoot = scopeRoot ? resolve(scopeRoot) : undefined;

  const isWithinScope = (fileName: string): boolean => {
    if (!resolvedScopeRoot) return true;
    const resolvedFileName = resolve(fileName);
    return (
      resolvedFileName === resolvedScopeRoot ||
      resolvedFileName.startsWith(`${resolvedScopeRoot}${sep}`)
    );
  };

  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;

    if (ts.isPropertyAssignment(node) && isTrustedRuntimeContextPropertyName(node.name)) {
      found = true;
      return;
    }

    if (
      ts.isShorthandPropertyAssignment(node) &&
      node.name.text === "trustedRuntimeContext"
    ) {
      found = true;
      return;
    }

    if (
      (ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "trustedRuntimeContext"
    ) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (sf.fileName.includes("node_modules")) continue;
    if (!isWithinScope(sf.fileName)) continue;
    visit(sf);
    if (found) break;
  }

  return found;
}

async function readSdkVersion(sdkRoot: string): Promise<string | null> {
  try {
    const raw = await readFile(join(sdkRoot, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

export interface AnalyzeGateSdkOperationsOptions {
  /** App root (tsconfig + node_modules). Use `resolve(process.cwd())` from CLI. */
  projectRoot: string;
  /** Optional subdirectory scope to analyze, e.g. a single feature path. */
  scopeRoot?: string;
}

export function defaultGateSdkRoot(projectRoot: string): string {
  return resolve(projectRoot, "node_modules/@fusebase/fusebase-gate-sdk");
}

async function resolveSdkMetadata(options: AnalyzeGateSdkOperationsOptions): Promise<{
  sdkRoot: string;
  opIds: string[];
  apiClassNames: string[];
}> {
  const candidateRoots: string[] = [];
  if (options.scopeRoot) {
    candidateRoots.push(defaultGateSdkRoot(options.scopeRoot));
  }
  candidateRoots.push(defaultGateSdkRoot(options.projectRoot));

  let lastError: Error | null = null;
  for (const sdkRoot of candidateRoots) {
    try {
      const { opIds, apiClassNames } = await extractAllowlistFromSdk(sdkRoot);
      return { sdkRoot, opIds, apiClassNames };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("Could not resolve Gate SDK path.");
}

function loadScopedTsPrograms(options: AnalyzeGateSdkOperationsOptions): Array<{
  program: ts.Program;
  configPath: string;
}> {
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

export async function analyzeGateSdkOperations(
  options: AnalyzeGateSdkOperationsOptions,
): Promise<GateOperationsResult> {
  const { sdkRoot, opIds, apiClassNames } = await resolveSdkMetadata(options);
  const allowlist = new Set(opIds);
  const sdkVersion = await readSdkVersion(sdkRoot);

  const loadedPrograms = loadScopedTsPrograms(options);
  if (loadedPrograms.length === 0) {
    throw new Error(
      "No tsconfig.json under current directory, or tsconfig matched zero source files. Fix tsconfig include.",
    );
  }

  const used = new Set<string>();
  let usesTrustedRuntimeContext = false;
  for (const loaded of loadedPrograms) {
    const part = collectUsedOperations(
      loaded.program,
      allowlist,
      new Set(apiClassNames),
      options.scopeRoot,
    );
    for (const op of part) {
      used.add(op);
    }
    if (
      collectTrustedRuntimeContextUsage(loaded.program, options.scopeRoot)
    ) {
      usesTrustedRuntimeContext = true;
    }
  }

  return {
    sdkOperationIds: opIds,
    usedOps: [...used].sort(),
    usesTrustedRuntimeContext,
    sdkVersion,
    sdkRoot,
    tsconfig: loadedPrograms[0]?.configPath,
  };
}

export function printGateOperationsResult(
  result: GateOperationsResult,
  json: boolean,
  options?: {
    fusebaseSaved?: boolean;
    fusebaseSnapshot?: GateSdkOperationsSnapshot;
  },
): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          sdkOperationIds: result.sdkOperationIds,
          usedOps: result.usedOps,
          sdkVersion: result.sdkVersion,
          tsconfig: result.tsconfig,
          sdkRoot: result.sdkRoot,
          ...(options?.fusebaseSnapshot && {
            analyzedAt: options.fusebaseSnapshot.analyzedAt,
            usedOpsChangedAt: options.fusebaseSnapshot.usedOpsChangedAt,
            ...(options.fusebaseSnapshot.permissionsChangedAt !==
              undefined && {
              permissionsChangedAt:
                options.fusebaseSnapshot.permissionsChangedAt,
            }),
            ...(options.fusebaseSnapshot.permissions && {
              permissions: options.fusebaseSnapshot.permissions,
            }),
          }),
          ...(options?.fusebaseSaved !== undefined && {
            fusebaseSaved: options.fusebaseSaved,
          }),
        },
        null,
        2,
      ),
    );
    return;
  }

  const ver = result.sdkVersion ? ` ${result.sdkVersion}` : "";
  console.log(`@fusebase/fusebase-gate-sdk${ver}`);
  console.log("");
  console.log(`usedOps (${result.usedOps.length}):`);
  if (result.usedOps.length === 0) {
    console.log(
      "  (none — import @fusebase/fusebase-gate-sdk and call methods on *Api instances)",
    );
  } else {
    for (const id of result.usedOps) {
      console.log(`  ${id}`);
    }
    console.log("");
    console.log("Comma-separated (e.g. for resolve-operation-permissions):");
    console.log(result.usedOps.join(","));
  }

  if (options?.fusebaseSnapshot) {
    const s = options.fusebaseSnapshot;
    console.log("");
    console.log(`analyzedAt: ${s.analyzedAt}`);
    console.log(`usedOpsChangedAt: ${s.usedOpsChangedAt}`);
    if (s.permissionsChangedAt !== undefined) {
      console.log(`permissionsChangedAt: ${s.permissionsChangedAt}`);
    }
    if (s.permissions && s.permissions.length > 0) {
      console.log("");
      console.log(`Permissions (${s.permissions.length}):`);
      for (const p of s.permissions) {
        console.log(`  ${p}`);
      }
      console.log("");
      console.log("Comma-separated (permissions):");
      console.log(s.permissions.join(","));
    }
  }
}
