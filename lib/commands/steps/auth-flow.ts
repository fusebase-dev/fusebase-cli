import { mkdir, writeFile } from "fs/promises";
import { CONFIG_DIR, CONFIG_FILE, getConfig, type Config } from "../../config";
import { fetchOrgs } from "../../api";
import { logger } from "../../logger";
import { openBrowser } from "../utils/open-browser";

async function ensureConfigDir(): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
  } catch {
    // Directory already exists
  }
}

async function saveConfig(config: Config): Promise<void> {
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Generate a random code verifier for PKCE
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Generate SHA256 hash of the code verifier for PKCE challenge
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Exchange authorization code for API key
 */
async function exchangeCodeForApiKey(
  code: string,
  codeVerifier: string,
  baseUrl: string,
): Promise<string> {
  const url = `${baseUrl}/auth/apikey/exchange?code=${encodeURIComponent(code)}&code_verifier=${encodeURIComponent(codeVerifier)}`;

  const response = await fetch(url);
  if (!response.ok) {
    logger.warn(
      "Failed to exchange code for api key %s %s",
      url,
      await response.text(),
    );
    throw new Error(`Failed to exchange code: ${response.statusText}`);
  }

  const data = (await response.json()) as { apiKey: string };
  if (!data.apiKey) {
    throw new Error("No API key received from exchange endpoint");
  }

  return data.apiKey;
}

/**
 * Start OAuth flow with PKCE
 */
async function startOAuthFlow(
  isDev: boolean,
  options?: { openBrowser?: boolean },
): Promise<string> {
  const baseUrl = isDev
    ? "https://app.dev-thefusebase.com"
    : "https://app.nimbusweb.me";

  // Generate PKCE parameters
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  return new Promise((resolve, reject) => {
    let serverInstance: ReturnType<typeof Bun.serve>;

    // Use port 0 to let the OS assign an available port atomically,
    // avoiding any race condition between port-check and bind.
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);

        // Handle the OAuth callback
        if (url.searchParams.has("code")) {
          const code = url.searchParams.get("code")!;

          try {
            // Exchange code for API key
            const apiKey = await exchangeCodeForApiKey(
              code,
              codeVerifier,
              baseUrl,
            );

            // Stop server and resolve with API key
            setTimeout(() => {
              serverInstance.stop();
              resolve(apiKey);
            }, 100);

            // Redirect to the auth-form success page
            const successUrl = `${baseUrl}/auth/apikey/cli-success`;
            return Response.redirect(successUrl, 302);
          } catch (error) {
            // Stop server and reject
            setTimeout(() => {
              serverInstance.stop();
              reject(error);
            }, 100);

            // Redirect to the auth-form success page with error
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            const errorUrl = `${baseUrl}/auth/apikey/cli-success?error=${encodeURIComponent(errorMessage)}`;
            return Response.redirect(errorUrl, 302);
          }
        }

        // Default response
        return new Response("Waiting for authentication...", {
          headers: { "Content-Type": "text/plain" },
        });
      },
    });

    serverInstance = server;
    // Bun assigns the actual port when port 0 is used
    const port = server.port;
    const redirectUri = `http://localhost:${port}`;

    console.log(`Starting local server on port ${port}...`);

    // Build authorization URL and open browser
    const authUrl = `${baseUrl}/auth/apikey/initeauth?redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${encodeURIComponent(codeChallenge)}&r=1`;

    if (options?.openBrowser === false) {
      console.log(`Open this URL to authenticate: ${authUrl}`);
    } else {
      console.log("Opening browser for authentication...");
      console.log(
        `If the browser doesn't open automatically, visit: ${authUrl}`,
      );
      openBrowser(authUrl);
    }
  });
}

/**
 * Run the authentication flow and save the API key
 * @param isDev Whether to use the dev environment
 * @returns The authenticated API key
 */
export async function runAuthFlow(
  isDev: boolean,
  options?: { openBrowser?: boolean },
): Promise<string> {
  console.log("Starting authentication flow...");

  try {
    const apiKey = await startOAuthFlow(isDev, options);

    // Validate against the same environment we got the key from (avoid 401 when
    // getEnv() would use fusebase.json or ~/.fusebase/config.json and hit the wrong API)
    const config = getConfig();
    config.env = isDev ? "dev" : "prod";
    config.apiKey = apiKey;
    await fetchOrgs(apiKey);

    await saveConfig(config);

    console.log("✓ Authentication successful");
    return apiKey;
  } catch (error) {
    console.error("Error: Authentication failed");
    console.error(error instanceof Error ? error.message : "Unknown error");
    throw error;
  }
}

/**
 * Check if user is authenticated
 * @returns The API key if authenticated, null otherwise
 */
export function checkAuthentication(): string | null {
  const config = getConfig();
  return config.apiKey || null;
}
