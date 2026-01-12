export interface DetectedCommand {
  command: string;
  type: string;
}

// Common patterns for dev server URLs in console output
const URL_PATTERNS = [
  // Vite: "Local:   http://localhost:5173/"
  /Local:\s+(https?:\/\/[^\s]+)/i,
  // Next.js: "- Local:        http://localhost:3000"
  /-\s*Local:\s+(https?:\/\/[^\s]+)/i,
  // webpack-dev-server: "Project is running at http://localhost:8080/"
  /running at (https?:\/\/[^\s]+)/i,
  // Create React App: "Local:            http://localhost:3000"
  /Local:\s+(https?:\/\/[^\s]+)/i,
  // Generic: "Server started at http://localhost:3000"
  /(?:server|app|dev|started|listening|running|available)\s+(?:at|on)\s+(https?:\/\/[^\s]+)/i,
  // Generic: "http://localhost:3000" at the start of line or after arrow
  /(?:^|➜|→|=>)\s*(https?:\/\/localhost[^\s]*)/im,
  // Fallback: any http://localhost URL
  /(https?:\/\/localhost:\d+\/?)/i,
];

export function detectDevServerUrl(output: string): string | null {
  // Strip ANSI escape sequences from output
  const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, '');

  for (const pattern of URL_PATTERNS) {
    const match = cleanOutput.match(pattern);
    if (match && match[1]) {
      // Clean up the URL (remove trailing punctuation, etc.)
      return match[1].replace(/[,;:'"\)\]}>]+$/, '');
    }
  }
  return null;
}

interface PackageJson {
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

function getAllDeps(packageJson: PackageJson) {
  const devDeps = packageJson.devDependencies || {};
  const deps = packageJson.dependencies || {};
  return { ...deps, ...devDeps };
}

export function detectDevCommandByPackageJson(packageJson: PackageJson): DetectedCommand | null {
  const allDeps = getAllDeps(packageJson);
  const scripts = packageJson.scripts || {};

  // Check for common frameworks and their dev commands
  // Vite
  if (allDeps["vite"]) {
    if (scripts["dev"]) return { command: "npm run dev", type: "Vite" };
    return { command: "npx vite", type: "Vite" };
  }

  // Angular
  if (allDeps["@angular/core"]) {
    if (scripts["start"]) return { command: "npm start", type: "Angular" };
    if (scripts["serve"]) return { command: "npm run serve", type: "Angular" };
    return { command: "npx ng serve", type: "Angular" };
  }

  // Next.js
  if (allDeps["next"]) {
    if (scripts["dev"]) return { command: "npm run dev", type: "Next.js" };
    return { command: "npx next dev", type: "Next.js" };
  }

  // Create React App
  if (allDeps["react-scripts"]) {
    if (scripts["start"]) return { command: "npm start", type: "Create React App" };
    return { command: "npx react-scripts start", type: "Create React App" };
  }

  // Vue CLI
  if (allDeps["@vue/cli-service"]) {
    if (scripts["serve"]) return { command: "npm run serve", type: "Vue CLI" };
    return { command: "npx vue-cli-service serve", type: "Vue CLI" };
  }

  // Nuxt
  if (allDeps["nuxt"]) {
    if (scripts["dev"]) return { command: "npm run dev", type: "Nuxt" };
    return { command: "npx nuxt dev", type: "Nuxt" };
  }

  // SvelteKit
  if (allDeps["@sveltejs/kit"]) {
    if (scripts["dev"]) return { command: "npm run dev", type: "SvelteKit" };
    return { command: "npx vite dev", type: "SvelteKit" };
  }

  // Remix
  if (allDeps["@remix-run/dev"]) {
    if (scripts["dev"]) return { command: "npm run dev", type: "Remix" };
    return { command: "npx remix dev", type: "Remix" };
  }

  // Astro
  if (allDeps["astro"]) {
    if (scripts["dev"]) return { command: "npm run dev", type: "Astro" };
    return { command: "npx astro dev", type: "Astro" };
  }

  // Webpack Dev Server
  if (allDeps["webpack-dev-server"]) {
    if (scripts["start"]) return { command: "npm start", type: "Webpack" };
    if (scripts["dev"]) return { command: "npm run dev", type: "Webpack" };
    return { command: "npx webpack serve", type: "Webpack" };
  }

  // Parcel
  if (allDeps["parcel"]) {
    if (scripts["start"]) return { command: "npm start", type: "Parcel" };
    if (scripts["dev"]) return { command: "npm run dev", type: "Parcel" };
    return { command: "npx parcel", type: "Parcel" };
  }

  // Generic fallback - check for common script names
  if (scripts["dev"]) return { command: "npm run dev", type: "Node.js" };
  if (scripts["start"]) return { command: "npm start", type: "Node.js" };
  if (scripts["serve"]) return { command: "npm run serve", type: "Node.js" };

  return null;
}

export function detectBuildCommandByPackageJson(packageJson: PackageJson): DetectedCommand | null {
  const allDeps = getAllDeps(packageJson);
  const scripts = packageJson.scripts || {};

  // Check for common frameworks and their build commands
  // Vite
  if (allDeps["vite"]) {
    if (scripts["build"]) return { command: "npm run build", type: "Vite" };
    return { command: "npx vite build", type: "Vite" };
  }

  // Angular
  if (allDeps["@angular/core"]) {
    if (scripts["build"]) return { command: "npm run build", type: "Angular" };
    return { command: "npx ng build", type: "Angular" };
  }

  // Next.js
  if (allDeps["next"]) {
    if (scripts["build"]) return { command: "npm run build", type: "Next.js" };
    return { command: "npx next build", type: "Next.js" };
  }

  // Create React App
  if (allDeps["react-scripts"]) {
    if (scripts["build"]) return { command: "npm run build", type: "Create React App" };
    return { command: "npx react-scripts build", type: "Create React App" };
  }

  // Vue CLI
  if (allDeps["@vue/cli-service"]) {
    if (scripts["build"]) return { command: "npm run build", type: "Vue CLI" };
    return { command: "npx vue-cli-service build", type: "Vue CLI" };
  }

  // Nuxt
  if (allDeps["nuxt"]) {
    if (scripts["build"]) return { command: "npm run build", type: "Nuxt" };
    if (scripts["generate"]) return { command: "npm run generate", type: "Nuxt" };
    return { command: "npx nuxt build", type: "Nuxt" };
  }

  // SvelteKit
  if (allDeps["@sveltejs/kit"]) {
    if (scripts["build"]) return { command: "npm run build", type: "SvelteKit" };
    return { command: "npx vite build", type: "SvelteKit" };
  }

  // Remix
  if (allDeps["@remix-run/dev"]) {
    if (scripts["build"]) return { command: "npm run build", type: "Remix" };
    return { command: "npx remix build", type: "Remix" };
  }

  // Astro
  if (allDeps["astro"]) {
    if (scripts["build"]) return { command: "npm run build", type: "Astro" };
    return { command: "npx astro build", type: "Astro" };
  }

  // Webpack
  if (allDeps["webpack"]) {
    if (scripts["build"]) return { command: "npm run build", type: "Webpack" };
    return { command: "npx webpack", type: "Webpack" };
  }

  // Parcel
  if (allDeps["parcel"]) {
    if (scripts["build"]) return { command: "npm run build", type: "Parcel" };
    return { command: "npx parcel build", type: "Parcel" };
  }

  // TypeScript
  if (allDeps["typescript"]) {
    if (scripts["build"]) return { command: "npm run build", type: "TypeScript" };
    return { command: "npx tsc", type: "TypeScript" };
  }

  // Generic fallback - check for common script names
  if (scripts["build"]) return { command: "npm run build", type: "Node.js" };

  return null;
}

export interface DetectedOutputDir {
  outputDir: string;
  type: string;
}

export function detectBuildOutputDirByPackageJson(packageJson: PackageJson): DetectedOutputDir | null {
  const allDeps = getAllDeps(packageJson);

  // Check for common frameworks and their default output directories
  // Vite
  if (allDeps["vite"]) {
    return { outputDir: "dist", type: "Vite" };
  }

  // Angular - default is dist/<project-name>, but commonly just dist
  if (allDeps["@angular/core"]) {
    return { outputDir: "dist", type: "Angular" };
  }

  // Next.js - uses .next for dev, but 'out' for static export
  if (allDeps["next"]) {
    return { outputDir: "out", type: "Next.js" };
  }

  // Create React App
  if (allDeps["react-scripts"]) {
    return { outputDir: "build", type: "Create React App" };
  }

  // Vue CLI
  if (allDeps["@vue/cli-service"]) {
    return { outputDir: "dist", type: "Vue CLI" };
  }

  // Nuxt - uses .output for Nuxt 3, dist for Nuxt 2 generate
  if (allDeps["nuxt"]) {
    return { outputDir: "dist", type: "Nuxt" };
  }

  // SvelteKit - uses build directory
  if (allDeps["@sveltejs/kit"]) {
    return { outputDir: "build", type: "SvelteKit" };
  }

  // Remix - uses build directory
  if (allDeps["@remix-run/dev"]) {
    return { outputDir: "build", type: "Remix" };
  }

  // Astro
  if (allDeps["astro"]) {
    return { outputDir: "dist", type: "Astro" };
  }

  // Webpack - commonly dist
  if (allDeps["webpack"]) {
    return { outputDir: "dist", type: "Webpack" };
  }

  // Parcel
  if (allDeps["parcel"]) {
    return { outputDir: "dist", type: "Parcel" };
  }

  // TypeScript - commonly dist or build
  if (allDeps["typescript"]) {
    return { outputDir: "dist", type: "TypeScript" };
  }

  return null;
}