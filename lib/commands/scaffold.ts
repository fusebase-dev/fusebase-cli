import { Command } from "commander";
import { resolve } from "path";
import { listTemplates, copyTemplate, checkTemplateCollisions } from "../feature-templates";

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
      if (templateId === "backend") {
        console.log(`
Next steps:
  1. Install backend dependencies:
       cd ${targetDir}/backend && npm install

  2. Add the backend block to this feature's entry in fusebase.json:
       "backend": {
         "dev":   { "command": "npm run dev" },
         "build": { "command": "npm run build" },
         "start": { "command": "npm run start" }
       }
`);
      }
    } catch (err: any) {
      console.error(`Error: ${err?.message ?? err}`);
      process.exit(1);
    }
  });
