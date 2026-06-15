import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const APP_API_CONTRACT_KIND = "app-api-consumer-contract";
export const APP_API_CONTRACT_SCHEMA_VERSION = "2026-06-03";
export const APP_API_CONTRACTS_DIR = "contracts/app-apis";

const APP_API_CONTRACT_MATCHERS = new Set([
  "string",
  "number",
  "boolean",
  "enum",
] as const);

type AppApiContractMatcherName =
  | "string"
  | "number"
  | "boolean"
  | "enum";

type AppApiContractEnumValue = string | number | boolean;

export interface AppApiContractMatcher {
  $matcher: AppApiContractMatcherName;
  $optional?: boolean;
  $nullable?: boolean;
  $value?: AppApiContractEnumValue[];
}

export type AppApiContractValue =
  | null
  | string
  | number
  | boolean
  | AppApiContractMatcher
  | AppApiContractValue[]
  | { [key: string]: AppApiContractValue };

export interface AppApiContractCase {
  name: string;
  input?: AppApiContractValue;
  expect: {
    status: number;
    body?: AppApiContractValue;
    error?: AppApiContractValue;
  };
}

export interface AppApiConsumerContract {
  kind: typeof APP_API_CONTRACT_KIND;
  schemaVersion: typeof APP_API_CONTRACT_SCHEMA_VERSION;
  providerAppId: string;
  operationId: string;
  cases: AppApiContractCase[];
}

export interface AppApiContractValidationIssue {
  path: string;
  message: string;
}

export interface AppApiContractFileValidationResult {
  filePath: string;
  contract?: AppApiConsumerContract;
  issues: AppApiContractValidationIssue[];
}

export interface DiscoveredAppApiContractFile {
  filePath: string;
  contract: AppApiConsumerContract;
}

export interface DiscoverAppApiContractsResult {
  contractsDir: string;
  files: DiscoveredAppApiContractFile[];
  issues: Array<
    AppApiContractValidationIssue & {
      filePath: string;
    }
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMatcherObject(value: unknown): value is AppApiContractMatcher {
  return isRecord(value) && typeof value.$matcher === "string";
}

function isEnumValue(value: unknown): value is AppApiContractEnumValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

export function getAppApiContractsDir(appPath: string): string {
  return join(appPath, APP_API_CONTRACTS_DIR);
}

export function getAppApiContractFilePath(
  appPath: string,
  providerAppId: string,
  operationId: string,
): string {
  return join(
    getAppApiContractsDir(appPath),
    encodeURIComponent(providerAppId),
    `${encodeURIComponent(operationId)}.contract.json`,
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function collectContractFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectContractFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".contract.json")) {
      files.push(entryPath);
    }
  }

  return files;
}

export async function discoverAppApiContractFilesInDir(
  dir: string,
): Promise<string[]> {
  const resolvedDir = resolve(dir);
  if (!(await pathExists(resolvedDir))) {
    return [];
  }

  return collectContractFiles(resolvedDir);
}

export async function discoverAppApiContractFiles(
  appPath: string,
): Promise<string[]> {
  return discoverAppApiContractFilesInDir(getAppApiContractsDir(appPath));
}

export async function loadAndValidateAppApiContractFile(
  filePath: string,
): Promise<AppApiContractFileValidationResult> {
  let raw: unknown;

  try {
    raw = JSON.parse(await readFile(filePath, "utf-8")) as unknown;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown JSON parse error";
    return {
      filePath,
      issues: [{ path: "$", message: `Failed to parse JSON: ${message}` }],
    };
  }

  return validateAppApiContractDocument(raw, filePath);
}

export async function discoverAndValidateAppApiContracts(
  appPath: string,
  contractFiles?: string[],
): Promise<DiscoverAppApiContractsResult> {
  const files = contractFiles ?? (await discoverAppApiContractFiles(appPath));
  const validationResults = await Promise.all(
    files.map((filePath) => loadAndValidateAppApiContractFile(filePath)),
  );
  const discoveredFiles: DiscoveredAppApiContractFile[] = [];
  const issues: Array<AppApiContractValidationIssue & { filePath: string }> = [];
  const seenContractKeys = new Map<string, string>();

  for (const result of validationResults) {
    for (const issue of result.issues) {
      issues.push({ ...issue, filePath: result.filePath });
    }

    if (!result.contract || result.issues.length > 0) {
      continue;
    }

    const contractKey = `${result.contract.providerAppId}\u0000${result.contract.operationId}`;
    const previousFilePath = seenContractKeys.get(contractKey);
    if (previousFilePath) {
      issues.push({
        filePath: result.filePath,
        path: "$",
        message:
          `Duplicate contract for ${result.contract.providerAppId}#${result.contract.operationId}. ` +
          `Already defined in ${previousFilePath}`,
      });
      continue;
    }

    seenContractKeys.set(contractKey, result.filePath);
    discoveredFiles.push({
      filePath: result.filePath,
      contract: result.contract,
    });
  }

  return {
    contractsDir: resolve(getAppApiContractsDir(appPath)),
    files: discoveredFiles.sort((a, b) => a.filePath.localeCompare(b.filePath)),
    issues: issues.sort(
      (a, b) =>
        a.filePath.localeCompare(b.filePath) || a.path.localeCompare(b.path),
    ),
  };
}

export function buildDraftAppApiConsumerContractFromConsumerCalls(params: {
  providerAppId: string;
  operationId: string;
  calls: Array<{ input?: AppApiContractValue }>;
}): AppApiConsumerContract {
  const cases =
    params.calls.length > 0
      ? params.calls.map((call, index) => ({
          name:
            params.calls.length === 1
              ? `${params.operationId}-contract-draft`
              : `${params.operationId}-contract-draft-${index + 1}`,
          ...(call.input !== undefined && { input: call.input }),
          expect: { status: 200 },
        }))
      : [{
          name: `${params.operationId}-contract-draft`,
          expect: { status: 200 },
        }];

  return {
    kind: APP_API_CONTRACT_KIND,
    schemaVersion: APP_API_CONTRACT_SCHEMA_VERSION,
    providerAppId: params.providerAppId,
    operationId: params.operationId,
    cases,
  };
}

export function validateAppApiContractDocument(
  raw: unknown,
  filePath = "contract.json",
): AppApiContractFileValidationResult {
  const issues: AppApiContractValidationIssue[] = [];

  const pushIssue = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  if (!isRecord(raw)) {
    pushIssue("$", "Contract file must be a JSON object.");
    return { filePath, issues };
  }

  if (raw.kind !== APP_API_CONTRACT_KIND) {
    pushIssue(
      "$.kind",
      `kind must be "${APP_API_CONTRACT_KIND}".`,
    );
  }

  if (raw.schemaVersion !== APP_API_CONTRACT_SCHEMA_VERSION) {
    pushIssue(
      "$.schemaVersion",
      `schemaVersion must be "${APP_API_CONTRACT_SCHEMA_VERSION}".`,
    );
  }

  if (!isNonEmptyString(raw.providerAppId)) {
    pushIssue("$.providerAppId", "providerAppId must be a non-empty string.");
  }

  if (!isNonEmptyString(raw.operationId)) {
    pushIssue("$.operationId", "operationId must be a non-empty string.");
  }

  if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
    pushIssue("$.cases", "cases must be a non-empty array.");
  } else {
    const seenCaseNames = new Set<string>();

    raw.cases.forEach((item, index) => {
      const casePath = `$.cases[${index}]`;
      if (!isRecord(item)) {
        pushIssue(casePath, "Case must be an object.");
        return;
      }

      if (!isNonEmptyString(item.name)) {
        pushIssue(`${casePath}.name`, "Case name must be a non-empty string.");
      } else if (seenCaseNames.has(item.name)) {
        pushIssue(`${casePath}.name`, `Duplicate case name: ${item.name}`);
      } else {
        seenCaseNames.add(item.name);
      }

      if (item.input !== undefined) {
        validateContractValue(item.input, `${casePath}.input`, pushIssue);
      }

      if (!isRecord(item.expect)) {
        pushIssue(`${casePath}.expect`, "expect must be an object.");
        return;
      }

      if (
        !isFiniteInteger(item.expect.status) ||
        item.expect.status < 100 ||
        item.expect.status > 599
      ) {
        pushIssue(
          `${casePath}.expect.status`,
          "expect.status must be an integer between 100 and 599.",
        );
      }

      if (item.expect.body !== undefined) {
        validateContractValue(
          item.expect.body,
          `${casePath}.expect.body`,
          pushIssue,
        );
      }

      if (item.expect.error !== undefined) {
        validateContractValue(
          item.expect.error,
          `${casePath}.expect.error`,
          pushIssue,
        );
      }
    });
  }

  if (issues.length > 0) {
    return { filePath, issues };
  }

  const providerAppId = raw.providerAppId as string;
  const operationId = raw.operationId as string;
  const cases = raw.cases as AppApiContractCase[];

  const contract: AppApiConsumerContract = {
    kind: APP_API_CONTRACT_KIND,
    schemaVersion: APP_API_CONTRACT_SCHEMA_VERSION,
    providerAppId,
    operationId,
    cases,
  };

  return {
    filePath,
    contract,
    issues,
  };
}

function validateContractValue(
  value: unknown,
  path: string,
  pushIssue: (path: string, message: string) => void,
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validateContractValue(item, `${path}[${index}]`, pushIssue);
    });
    return;
  }

  if (!isRecord(value)) {
    pushIssue(path, "Value must be JSON-serializable.");
    return;
  }

  if (isMatcherObject(value)) {
    validateMatcherObject(value, path, pushIssue);
    return;
  }

  for (const [key, childValue] of Object.entries(value)) {
    validateContractValue(childValue, `${path}.${key}`, pushIssue);
  }
}

function validateMatcherObject(
  matcher: Record<string, unknown>,
  path: string,
  pushIssue: (path: string, message: string) => void,
): void {
  const allowedKeys = new Set(["$matcher", "$optional", "$nullable", "$value"]);

  for (const key of Object.keys(matcher)) {
    if (!allowedKeys.has(key)) {
      pushIssue(
        `${path}.${key}`,
        "Matcher objects only support $matcher, $optional, $nullable, and $value.",
      );
    }
  }

  if (
    typeof matcher.$matcher !== "string" ||
    !APP_API_CONTRACT_MATCHERS.has(
      matcher.$matcher as AppApiContractMatcherName,
    )
  ) {
    pushIssue(
      `${path}.$matcher`,
      "Matcher must be one of: string, number, boolean, enum.",
    );
    return;
  }

  if (
    matcher.$optional !== undefined &&
    typeof matcher.$optional !== "boolean"
  ) {
    pushIssue(`${path}.$optional`, "$optional must be a boolean.");
  }

  if (
    matcher.$nullable !== undefined &&
    typeof matcher.$nullable !== "boolean"
  ) {
    pushIssue(`${path}.$nullable`, "$nullable must be a boolean.");
  }

  if (matcher.$matcher === "enum") {
    if (!Array.isArray(matcher.$value) || matcher.$value.length === 0) {
      pushIssue(
        `${path}.$value`,
        "Enum matcher requires a non-empty $value array.",
      );
      return;
    }

    matcher.$value.forEach((item, index) => {
      if (!isEnumValue(item)) {
        pushIssue(
          `${path}.$value[${index}]`,
          "Enum matcher values must be string, number, or boolean.",
        );
      }
    });
    return;
  }

  if (matcher.$value !== undefined) {
    pushIssue(
      `${path}.$value`,
      "Only enum matcher supports $value.",
    );
  }
}
