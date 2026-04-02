import { Command } from "commander";
import { resolve, join } from "path";
import { spawn } from "child_process";
import { listTemplates, copyTemplate, checkTemplateCollisions } from "../feature-templates";

async function runNpmInstall(cwd: string): Promise<void> {
  console.log(`   Installing dependencies in ${cwd}...`);
  return new Promise((resolve, reject) => {
    const child = spawn("npm install --include=dev", {
      shell: true,
      cwd,
      stdio: "inherit",
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`npm install failed with exit code ${code} in ${cwd}`));
      } else {
        resolve();
      }
    });
  });
}

export const scaffoldCommand = new Command("scaffold")
  .description("Scaffold a new feature from a template. Without options, lists available templates.")
  .option("-t, --template <templateId>", "Template ID to scaffold (e.g. spa, backend)")
  .option("-d, --dir <directory>", "Target directory where the template will be deployed")
  .action(async (options: { template?: string; dir?: string }) => {
    const { template: templateId, dir } = options;

    // No template specified — list available templates
    if (!templateId) {
      const templates = await listTemplates();
      if (templates.length === 0) {
        console.log("No templates available.");
        return;
      }
      console.log("Available scaffold templates:\n");
      for (const t of templates) {
        console.log(`  ${t.id}`);
        console.log(`    Name:        ${t.name}`);
        console.log(`    Description: ${t.description}`);
        console.log(`    Stack:       ${t.stack}`);
        console.log();
      }
      console.log("Usage: fusebase scaffold --template <id> --dir <path>");
      return;
    }

    if (!dir) {
      console.error("Error: --dir is required when --template is specified.");
      process.exit(1);
    }

    const targetDir = resolve(dir);

    // Check for collisions before writing anything
    let collisions: string[];
    try {
      collisions = await checkTemplateCollisions(templateId, targetDir);
    } catch (err: any) {
      console.error(`Error: ${err?.message ?? err}`);
      process.exit(1);
    }

    if (collisions.length > 0) {
      console.error(
        `Error: Scaffold '${templateId}' would overwrite existing files in '${targetDir}':`
      );
      for (const f of collisions) {
        console.error(`  ${f}`);
      }
      process.exit(1);
    }

    try {
      await copyTemplate(templateId, targetDir);
      console.log(`✓ Scaffolded template '${templateId}' into ${targetDir}`);

      // Install dependencies
      if (templateId === "backend") {
        await runNpmInstall(join(targetDir, "backend"));
      } else {
        await runNpmInstall(targetDir);
      }
      console.log("✓ Dependencies installed");
    } catch (err: any) {
      console.error(`Error: ${err?.message ?? err}`);
      process.exit(1);
    }
  });
