import { requestGateService } from "./gate-api";
import { readEnvFileMap } from "./commands/steps/create-env";

type ScopeType = "organization" | "workspace" | "portal" | "user" | "client";

type Scope = {
  scopeType: ScopeType;
  scopeId: string;
};

type McpManagerTemplate = {
  name: string;
  globalId: string;
  auth?: {
    app: string;
    type: string;
  } | null;
};

type CreateAuthPayload = {
  type: "composio_managed" | "token_bearer";
  globalId: string;
  app: string;
  scopes: Scope[];
  replaceInactiveAuth: boolean;
  token?: string;
};

type AuthResponse = {
  globalId: string;
  status: string;
  data: {
    redirectUrl?: string | null;
  };
};

type ServerResponse = {
  globalId: string;
  command?: unknown;
};

export type ConnectManagedMcpTemplateOptions = {
  templateName: string;
  gateToken: string;
  scope?: {
    scopeType: string,
    scopeId: string,
  };
  channelId?: string;
  noChannel?: boolean;
  waitTimeoutSec?: number;
  pollIntervalSec?: number;
  token?: string;
};

export type ConnectedManagedMcpServer = {
  serverId: string;
  command?: unknown;
};

export async function readAppGateTokenOrExit(cwd: string): Promise<string> {
  const envMap = await readEnvFileMap(cwd);
  const gateToken = envMap.get("GATE_MCP_TOKEN")?.trim();

  if (!gateToken) {
    console.error(
      "Error: Missing GATE_MCP_TOKEN in project .env. Run 'fusebase env create' first.",
    );
    process.exit(1);
  }

  return gateToken;
}

export async function listManagedMcpTemplates(
  gateToken: string,
): Promise<Array<{ name: string; globalId: string; app: string }>> {
  const { templates } = await fetchManagedMcpTemplates(gateToken);
  return templates
    .filter(
      (template): template is McpManagerTemplate & {
        auth: { app: string; type: "composio_managed" };
      } => template.auth?.type === "composio_managed",
    )
    .map((template) => ({
      name: template.name,
      globalId: template.globalId,
      app: template.auth.app,
    }));
}

export async function connectManagedMcpTemplate(
  options: ConnectManagedMcpTemplateOptions,
): Promise<ConnectedManagedMcpServer> {
  if (options.noChannel === true && options.channelId !== undefined) {
    throw new Error("Use either --channel-id or --no-channel, not both.");
  }

  const scope: Scope | undefined = options.scope ? {
    scopeType: parseScopeType(options.scope.scopeType),
    scopeId: options.scope.scopeId,
  } : undefined;
  const waitTimeoutMs = (options.waitTimeoutSec ?? 300) * 1000;
  const pollIntervalMs = (options.pollIntervalSec ?? 5) * 1000;

  const { templates } = await fetchManagedMcpTemplates(options.gateToken);
  const template = findTemplateByName(templates, options.templateName);
  const createAuthPayload = buildCreateAuthPayload({ template, scope, token: options.token });
  const createdAuth = await requestGateService<AuthResponse>(options.gateToken, {
    method: "POST",
    path: "/mcp-manager/auth",
    body: createAuthPayload,
  });
  const activeAuth = await waitUntilAuthIsActive(
    options.gateToken,
    createdAuth,
    waitTimeoutMs,
    pollIntervalMs,
  );

  const server = await requestGateService<ServerResponse>(options.gateToken, {
    method: "POST",
    path: `/mcp-manager/servers/from-template/${encodeURIComponent(template.globalId)}`,
    body: {
      globalId: crypto.randomUUID(),
      scopes: scope ? [scope] : [],
      channels: [],
      authId: activeAuth.globalId,
    },
  });

  return {
    serverId: server.globalId,
    command: server.command,
  };
}

async function fetchManagedMcpTemplates(
  gateToken: string,
): Promise<{ templates: McpManagerTemplate[] }> {
  return requestGateService<{ templates: McpManagerTemplate[] }>(gateToken, {
    method: "GET",
    path: "/mcp-manager/templates",
    query: { rules: true },
  });
}

function findTemplateByName(
  templates: McpManagerTemplate[],
  templateName: string,
): McpManagerTemplate {
  const exactMatch = templates.find((template) => template.name === templateName);
  if (exactMatch !== undefined) {
    return exactMatch;
  }

  const caseInsensitiveMatches = templates.filter(
    (template) => template.name.toLowerCase() === templateName.toLowerCase(),
  );
  if (caseInsensitiveMatches.length === 1) {
    return caseInsensitiveMatches[0]!;
  }
  if (caseInsensitiveMatches.length > 1) {
    const matches = caseInsensitiveMatches
      .map((template) => `${template.name} (${template.globalId})`)
      .join(", ");
    throw new Error(`Template name "${templateName}" is ambiguous. Matches: ${matches}`);
  }

  const available = templates
    .map((template) => template.name)
    .sort()
    .join(", ");
  throw new Error(`Template "${templateName}" not found. Available templates: ${available}`);
}

function buildCreateAuthPayload({ template, scope, token }: {
  template: McpManagerTemplate,
  scope?: Scope,
  token: string | undefined,
}): CreateAuthPayload {
  if (template.auth === undefined || template.auth === null) {
    throw new Error(`Template "${template.name}" (${template.globalId}) does not require auth.`);
  }

  const app = template.auth.app?.trim();
  if (!app) {
    throw new Error("Template auth app is missing.");
  }

  if (template.auth.type === "composio_managed") {
    return {
      type: "composio_managed",
      globalId: crypto.randomUUID(),
      app,
      scopes: scope ? [scope] : [],
      replaceInactiveAuth: true,
    };
  }

  if (template.auth.type === "token_bearer") {
    if (token === undefined || token.trim() === "") {
      throw new Error("Template requires token_bearer auth. Provide --token.");
    }

    return {
      type: "token_bearer",
      globalId: crypto.randomUUID(),
      app,
      token,
      scopes: scope ? [scope] : [],
      replaceInactiveAuth: true,
    };
  }

  throw new Error(`Auth type "${template.auth.type}" is not supported by this command.`);
}

function parseScopeType(rawValue: string): ScopeType {
  switch (rawValue) {
    case "organization":
    case "workspace":
    case "portal":
    case "user":
    case "client":
      return rawValue;
    default:
      throw new Error(
        `Invalid scope type "${rawValue}". Use one of: organization, workspace, portal, user.`,
      );
  }
}

async function waitUntilAuthIsActive(
  gateToken: string,
  auth: AuthResponse,
  waitTimeoutMs: number,
  pollIntervalMs: number,
): Promise<AuthResponse> {
  if (auth.status === "ACTIVE") {
    return auth;
  }

  if (
    auth.data.redirectUrl !== undefined &&
    auth.data.redirectUrl !== null &&
    auth.data.redirectUrl.trim() !== ""
  ) {
    console.error(`Complete OAuth in browser before timeout: ${auth.data.redirectUrl}`);
  }

  const deadline = Date.now() + waitTimeoutMs;
  let currentAuth = auth;

  while (Date.now() <= deadline) {
    await sleep(pollIntervalMs);
    currentAuth = await requestGateService<AuthResponse>(gateToken, {
      method: "PATCH",
      path: `/mcp-manager/auth/${encodeURIComponent(currentAuth.globalId)}`,
      body: {
        refetch: true,
        autofillName: true,
      },
    });

    if (currentAuth.status === "ACTIVE") {
      return currentAuth;
    }
  }

  throw new Error(
    `Auth ${currentAuth.globalId} is still ${currentAuth.status}. Increase --wait-timeout-sec and complete OAuth.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
