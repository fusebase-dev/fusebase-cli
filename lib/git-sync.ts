import chalk from "chalk";
import { spawn } from "child_process";
import { basename } from "path";
import { fetchApp } from "./api";
import { getConfig, getEnv, loadFuseConfig } from "./config";
import { isInsideGitWorkTree, runGitInitInDirectory } from "./git-local";

interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface GitLabProject {
  id: number;
  name: string;
  path: string;
  web_url: string;
  http_url_to_repo: string;
  default_branch?: string | null;
  topics?: string[];
}

interface GitLabGroup {
  id: number;
  full_path: string;
}

interface ResolvedGitLabConfig {
  host: string;
  token: string;
  group: string;
}

const GITLAB_BOOTSTRAP_BRANCH = "fusebase-bootstrap";
const GITLAB_BOOTSTRAP_FILE = ".fusebase-gitlab-bootstrap.md";

function normalizeHost(host: string): string {
  return host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function sanitizeProjectName(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "app"
  );
}

function slugifyOrEmpty(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function transliterateCyrillic(input: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return Array.from(input)
    .map((ch) => {
      const lower = ch.toLowerCase();
      const t = map[lower];
      if (t === undefined) return ch;
      return ch === lower ? t : t.toUpperCase();
    })
    .join("");
}

function toHumanSlug(name?: string): string {
  const raw = String(name ?? "").trim();
  if (!raw) return "";
  const direct = slugifyOrEmpty(raw);
  if (direct) return direct;
  return slugifyOrEmpty(transliterateCyrillic(raw));
}

function composeRepoName(options: {
  env: "dev" | "prod";
  subdomain?: string;
  appTitle?: string;
  fallbackName: string;
}): string {
  const titleSlug = toHumanSlug(options.appTitle);
  const folderSlug = toHumanSlug(options.fallbackName);
  const subdomainSlug = toHumanSlug(options.subdomain);
  const base = titleSlug || folderSlug || subdomainSlug || "app";
  const candidate = sanitizeProjectName(`app-${base}-${options.env}`);
  // Keep GitLab path compact and predictable.
  return candidate.length > 63 ? candidate.slice(0, 63).replace(/-+$/g, "") : candidate;
}

function resolveGitLabConfig(): {
  ok: true;
  value: ResolvedGitLabConfig;
} | {
  ok: false;
} {
  const config = getConfig();
  const host = String(config.gitlabHost ?? "").trim();
  const token = String(config.gitlabToken ?? "").trim();
  const group = String(config.gitlabGroup ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");

  if (!host || !token || !group) {
    console.log(chalk.yellow("GitLab sync skipped: missing global GitLab config."));
    console.log("Add these fields to ~/.fusebase/config.json:");
    console.log(
      chalk.dim(
        `  "gitlabHost": "gl.nimbusweb.co", "gitlabToken": "<token>", "gitlabGroup": "vibecode"`,
      ),
    );
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      host: normalizeHost(host),
      token,
      group,
    },
  };
}

async function resolveProjectName(options: {
  cwd: string;
  env: "dev" | "prod";
  appSubdomain?: string;
  appTitle?: string;
  explicitRepoName?: string;
}): Promise<string> {
  const { cwd, env, appSubdomain, appTitle, explicitRepoName } = options;
  const explicit = toHumanSlug(explicitRepoName);
  if (explicit) {
    return sanitizeProjectName(explicit);
  }
  const fusebaseConfig = loadFuseConfig();
  const orgId = String(fusebaseConfig?.orgId ?? "").trim();
  const appId = String(fusebaseConfig?.appId ?? "").trim();
  const apiKey = String(getConfig().apiKey ?? "").trim();

  if (appSubdomain || appTitle) {
    return composeRepoName({
      env,
      appTitle,
      subdomain: appSubdomain,
      fallbackName: basename(cwd),
    });
  }

  if (orgId && appId && apiKey) {
    try {
      const app = await fetchApp(apiKey, orgId, appId);
      return composeRepoName({
        env,
        appTitle: app.title,
        subdomain: app.sub,
        fallbackName: basename(cwd),
      });
    } catch {
      // Fallback to folder name if app lookup fails.
    }
  }

  return composeRepoName({ env, fallbackName: basename(cwd) });
}

function runGit(
  cwd: string,
  args: string[],
  options: { stdio?: "inherit" | "pipe" | "ignore" } = {},
): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: options.stdio ?? "pipe",
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (c) => (stdout += c.toString()));
    if (child.stderr) child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function gitHasOrigin(cwd: string): Promise<boolean> {
  const res = await runGit(cwd, ["remote", "get-url", "origin"]);
  return res.code === 0;
}

async function gitOriginUrl(cwd: string): Promise<string | null> {
  const res = await runGit(cwd, ["remote", "get-url", "origin"]);
  if (res.code !== 0) return null;
  return res.stdout.trim() || null;
}

async function gitHasCommits(cwd: string): Promise<boolean> {
  const res = await runGit(cwd, ["rev-parse", "--verify", "HEAD"], {
    stdio: "ignore",
  });
  return res.code === 0;
}

async function ensureInitialCommit(cwd: string): Promise<boolean> {
  if (await gitHasCommits(cwd)) {
    return true;
  }

  const status = await runGit(cwd, ["status", "--porcelain"]);
  if (status.code !== 0) return false;
  if (!status.stdout.trim()) return false;

  const add = await runGit(cwd, ["add", "-A"], { stdio: "pipe" });
  if (add.code !== 0) {
    console.log(chalk.yellow("Could not stage changes for initial commit automatically."));
    return false;
  }
  const commit = await runGit(cwd, ["commit", "-m", "Initial commit"], {
    stdio: "pipe",
  });
  if (commit.code !== 0) {
    console.log(
      chalk.yellow(
        "Could not create initial commit automatically. Configure git user.name/user.email and commit manually.",
      ),
    );
    return false;
  }
  const shaRes = await runGit(cwd, ["rev-parse", "--short", "HEAD"], {
    stdio: "pipe",
  });
  const sha = shaRes.code === 0 ? shaRes.stdout.trim() : "";
  console.log(
    chalk.green("✓") +
      ` Created initial commit${sha ? ` (${sha})` : ""}.`,
  );
  return true;
}

async function getCurrentBranch(cwd: string): Promise<string | null> {
  const res = await runGit(cwd, ["branch", "--show-current"]);
  if (res.code !== 0) return null;
  const branch = res.stdout.trim();
  return branch || null;
}

async function gitlabRequest(
  config: ResolvedGitLabConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("PRIVATE-TOKEN", config.token);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`https://${config.host}/api/v4${path}`, {
    ...init,
    headers,
  });
}

async function ensureGitLabAuth(config: ResolvedGitLabConfig): Promise<boolean> {
  const whoami = await gitlabRequest(config, "/user");
  if (whoami.ok) return true;
  console.log(
    chalk.yellow(
      `GitLab sync skipped: unable to authenticate on ${config.host} (status ${whoami.status}).`,
    ),
  );
  return false;
}

async function findGroup(
  config: ResolvedGitLabConfig,
  fullPath: string,
): Promise<GitLabGroup | null> {
  const groupResponse = await gitlabRequest(
    config,
    `/groups/${encodeURIComponent(fullPath)}`,
  );
  if (groupResponse.status === 404) return null;
  if (!groupResponse.ok) {
    throw new Error(
      `Failed to read GitLab group "${fullPath}" (status ${groupResponse.status}).`,
    );
  }
  return (await groupResponse.json()) as GitLabGroup;
}

async function findProject(
  config: ResolvedGitLabConfig,
  fullPath: string,
): Promise<GitLabProject | null> {
  const response = await gitlabRequest(
    config,
    `/projects/${encodeURIComponent(fullPath)}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Failed to read GitLab project "${fullPath}" (status ${response.status}).`,
    );
  }
  return (await response.json()) as GitLabProject;
}

async function ensureProject(
  config: ResolvedGitLabConfig,
  envSegment: "dev" | "prod",
  projectName: string,
): Promise<GitLabProject> {
  const fullGroupPath = `${config.group}/${envSegment}`;
  const fullProjectPath = `${fullGroupPath}/${projectName}`;
  const existing = await findProject(config, fullProjectPath);
  if (existing) {
    console.log(chalk.green("✓") + ` Using existing GitLab project: ${existing.web_url}`);
    return existing;
  }

  const group = await findGroup(config, fullGroupPath);
  if (!group) {
    throw new Error(
      `GitLab group "${fullGroupPath}" was not found. Create it first or update gitlabGroup in ~/.fusebase/config.json.`,
    );
  }

  const createResponse = await gitlabRequest(config, "/projects", {
    method: "POST",
    body: JSON.stringify({
      name: projectName,
      path: projectName,
      namespace_id: group.id,
      visibility: "private",
      initialize_with_readme: true,
      default_branch: GITLAB_BOOTSTRAP_BRANCH,
    }),
  });
  if (!createResponse.ok) {
    const details = await createResponse.text();
    throw new Error(
      `Failed to create GitLab project (${createResponse.status}): ${details}`,
    );
  }
  const project = (await createResponse.json()) as GitLabProject;
  console.log(chalk.green("✓") + ` Created GitLab project: ${project.web_url}`);
  return project;
}

async function addManagedTag(
  config: ResolvedGitLabConfig,
  project: GitLabProject,
): Promise<void> {
  const currentTopics = new Set(project.topics ?? []);
  if (currentTopics.has("managed")) return;
  currentTopics.add("managed");
  const response = await gitlabRequest(config, `/projects/${project.id}`, {
    method: "PUT",
    body: JSON.stringify({ topics: Array.from(currentTopics) }),
  });
  if (!response.ok) {
    console.log(chalk.yellow("Warning: could not set managed tag in GitLab."));
    return;
  }
  console.log(chalk.green("✓") + " Added GitLab topic: managed");
}

async function setGitLabDefaultBranch(
  config: ResolvedGitLabConfig,
  project: GitLabProject,
  branch: string,
): Promise<boolean> {
  const response = await gitlabRequest(config, `/projects/${project.id}`, {
    method: "PUT",
    body: JSON.stringify({ default_branch: branch }),
  });
  if (!response.ok) {
    return false;
  }
  project.default_branch = branch;
  return true;
}

async function ensureGitLabDefaultBranch(
  config: ResolvedGitLabConfig,
  project: GitLabProject,
): Promise<string | null> {
  if (project.default_branch) {
    return project.default_branch === GITLAB_BOOTSTRAP_BRANCH
      ? GITLAB_BOOTSTRAP_BRANCH
      : null;
  }

  const commitResponse = await gitlabRequest(
    config,
    `/projects/${project.id}/repository/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        branch: GITLAB_BOOTSTRAP_BRANCH,
        commit_message: "Initialize GitLab repository",
        actions: [
          {
            action: "create",
            file_path: GITLAB_BOOTSTRAP_FILE,
            content:
              "Temporary bootstrap commit created by Fusebase CLI so GitLab can assign a default branch before the first project push.\n",
          },
        ],
      }),
    },
  );

  if (!commitResponse.ok) {
    const details = await commitResponse.text();
    const defaultSet = await setGitLabDefaultBranch(
      config,
      project,
      GITLAB_BOOTSTRAP_BRANCH,
    );
    if (!defaultSet) {
      throw new Error(
        `GitLab project has no default branch and Fusebase CLI could not initialize one (${commitResponse.status}): ${details}`,
      );
    }
  } else if (
    !(await setGitLabDefaultBranch(config, project, GITLAB_BOOTSTRAP_BRANCH))
  ) {
    throw new Error(
      `GitLab project has no default branch and Fusebase CLI could not assign ${GITLAB_BOOTSTRAP_BRANCH} as default.`,
    );
  }

  console.log(
    chalk.green("✓") +
      ` Initialized GitLab default branch: ${GITLAB_BOOTSTRAP_BRANCH}`,
  );
  return GITLAB_BOOTSTRAP_BRANCH;
}

async function deleteGitLabBranch(
  config: ResolvedGitLabConfig,
  project: GitLabProject,
  branch: string,
): Promise<void> {
  const response = await gitlabRequest(
    config,
    `/projects/${project.id}/repository/branches/${encodeURIComponent(branch)}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404) {
    console.log(
      chalk.yellow(
        `Warning: could not delete temporary GitLab branch ${branch}.`,
      ),
    );
  }
}

async function ensureOrigin(cwd: string, remoteUrl: string): Promise<boolean> {
  const originUrl = await gitOriginUrl(cwd);
  if (originUrl) {
    if (originUrl === remoteUrl) {
      console.log(chalk.green("✓") + " Git remote origin already configured.");
      return true;
    }
    console.log(chalk.yellow("Git sync skipped: origin already points to another URL."));
    console.log(chalk.dim(`  existing: ${originUrl}`));
    console.log(chalk.dim(`  wanted:   ${remoteUrl}`));
    return false;
  }
  const addRemote = await runGit(cwd, ["remote", "add", "origin", remoteUrl], {
    stdio: "inherit",
  });
  if (addRemote.code !== 0) return false;
  console.log(chalk.green("✓") + " Added remote origin.");
  return true;
}

async function pushCurrentBranch(
  cwd: string,
  options?: { compactOutput?: boolean },
): Promise<string | null> {
  await ensureInitialCommit(cwd);
  const branch = await getCurrentBranch(cwd);
  if (!branch) {
    console.log(
      chalk.yellow(
        "Skipped push: no current branch detected. Create a commit/branch, then run `fusebase git sync`.",
      ),
    );
    return null;
  }
  const push = await runGit(cwd, ["push", "-u", "origin", branch], {
    stdio: options?.compactOutput ? "pipe" : "inherit",
  });
  if (push.code !== 0) {
    console.log(chalk.yellow("Push failed. Run `git push -u origin <branch>` manually."));
    if (options?.compactOutput && push.stderr.trim()) {
      console.log(chalk.dim(push.stderr.trim()));
    }
    return null;
  }
  console.log(chalk.green("✓") + ` Pushed branch ${branch} to origin.`);
  return branch;
}

export async function syncGitWithGitLab(options: {
  cwd: string;
  tagManaged: boolean;
  push?: boolean;
  appSubdomain?: string;
  appTitle?: string;
  explicitRepoName?: string;
  compactOutput?: boolean;
}): Promise<void> {
  const {
    cwd,
    tagManaged,
    push = true,
    appSubdomain,
    appTitle,
    explicitRepoName,
    compactOutput,
  } = options;
  if (!(await isInsideGitWorkTree(cwd))) {
    console.log(
      chalk.yellow(
        "Git sync skipped: current directory is not a Git repository. Run `fusebase git` first.",
      ),
    );
    return;
  }
  const resolved = resolveGitLabConfig();
  if (!resolved.ok) return;
  const config = resolved.value;
  if (!(await ensureGitLabAuth(config))) return;

  const env = getEnv() === "dev" ? "dev" : "prod";
  const projectName = await resolveProjectName({
    cwd,
    env,
    appSubdomain,
    appTitle,
    explicitRepoName,
  });
  console.log(chalk.green("✓") + ` Using GitLab repository name: ${projectName}`);
  const project = await ensureProject(config, env, projectName);
  const bootstrapBranch = await ensureGitLabDefaultBranch(config, project);
  if (tagManaged) {
    await addManagedTag(config, project);
  }

  const hasOrigin = await gitHasOrigin(cwd);
  if (!hasOrigin && !(await ensureOrigin(cwd, project.http_url_to_repo))) {
    return;
  }
  if (hasOrigin) {
    const currentOrigin = await gitOriginUrl(cwd);
    if (currentOrigin && currentOrigin !== project.http_url_to_repo) {
      console.log(
        chalk.yellow(
          "Skipping push because origin points to another repository. Run `fusebase git sync` in a clean repo or adjust origin manually.",
        ),
      );
      return;
    }
  }

  if (push) {
    const pushedBranch = await pushCurrentBranch(cwd, { compactOutput });
    if (pushedBranch && bootstrapBranch && pushedBranch !== bootstrapBranch) {
      if (await setGitLabDefaultBranch(config, project, pushedBranch)) {
        console.log(
          chalk.green("✓") + ` Set GitLab default branch: ${pushedBranch}`,
        );
        await deleteGitLabBranch(config, project, bootstrapBranch);
      } else {
        console.log(
          chalk.yellow(
            `Warning: could not set GitLab default branch to ${pushedBranch}.`,
          ),
        );
      }
    }
  }
}

export async function runGitInitAndSync(options: {
  cwd: string;
  tagManaged: boolean;
  appSubdomain?: string;
  appTitle?: string;
  explicitRepoName?: string;
  compactOutput?: boolean;
}): Promise<void> {
  const {
    cwd,
    tagManaged,
    appSubdomain,
    appTitle,
    explicitRepoName,
    compactOutput,
  } = options;
  await runGitInitInDirectory(cwd);
  await syncGitWithGitLab({
    cwd,
    tagManaged,
    push: true,
    appSubdomain,
    appTitle,
    explicitRepoName,
    compactOutput,
  });
}

export function isManagedAppInCurrentProject(): boolean {
  const fusebaseConfig = loadFuseConfig();
  return Boolean(fusebaseConfig?.managed);
}

export function previewGitLabRepoName(options: {
  env: "dev" | "prod";
  appSubdomain?: string;
  appTitle?: string;
  fallbackName: string;
}): string {
  return composeRepoName(options);
}
