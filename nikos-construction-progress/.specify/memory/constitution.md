<!--
Sync Impact Report
Version change: (unversioned template) → 1.0.0
Ratified: 2026-05-22 | Last Amended: 2026-05-22
Modified principles: All five defined for the first time (template placeholders → concrete):
  - [PRINCIPLE_1_NAME] → I. Authentication via FuseBase Users
  - [PRINCIPLE_2_NAME] → II. Simple, Stylish UI
  - [PRINCIPLE_3_NAME] → III. Unit Testing Discipline
  - [PRINCIPLE_4_NAME] → IV. Maintainability
  - [PRINCIPLE_5_NAME] → V. One FuseBase Product
Added sections:
  - Platform & Technology Constraints (Section 2)
  - Development Workflow & Quality Gates (Section 3)
Removed sections: none
Templates status:
  ✅ .specify/templates/plan-template.md — Constitution Check uses a generic placeholder; compatible
  ✅ .specify/templates/spec-template.md — no constitution coupling; compatible
  ✅ .specify/templates/tasks-template.md — Tests note updated to require unit tests per Principle III
  ✅ .specify/templates/checklist-template.md — no constitution coupling; compatible
Follow-up TODOs: none
-->

# Nikos Construction Progress Constitution

## Core Principles

### I. Authentication via FuseBase Users

All authentication MUST use FuseBase Users as the sole identity provider. Every user is
authenticated through the FuseBase platform app token (cookie `fbsfeaturetoken`, falling
back to `window.FBS_FEATURE_TOKEN` only when the cookie is absent). Runtime code MUST NOT
implement a custom credential store, parallel login system, or separate identity service.
Backend handlers MUST accept the app token as `header('x-app-feature-token') ||
cookie('fbsfeaturetoken')`. User-facing flows MUST stay in user context — there is no
silent fallback to service-account tokens — and missing or invalid tokens MUST fail closed
with `401`/`403`.

**Rationale**: A single platform identity keeps access control consistent, auditable, and
aligned with FuseBase org membership and permissions; rolling a custom auth system would
fragment trust and reintroduce solved security problems.

### II. Simple, Stylish UI

Every user-facing surface MUST be simple to use and visually polished. UI MUST follow the
`app-ui-design` skill (shadcn/ui + Tailwind CSS v4): clear visual hierarchy, consistent
spacing, and minimal cognitive load. Generic "AI slop" aesthetics are NOT acceptable —
interfaces MUST be distinctive and intentional. Designs SHOULD prefer fewer screens and
controls; any element that does not serve the user's task MUST be removed.

**Rationale**: Construction-progress users need fast, unambiguous workflows on site;
restraint paired with craft delivers more value than feature clutter.

### III. Unit Testing Discipline

Non-trivial logic MUST be covered by unit tests. Business logic, data transformations, and
validation MUST have tests that assert observable behavior rather than implementation
detail. Unit tests MUST pass before code is considered done and before any deploy. Every
bug fix MUST add a regression test that fails before the fix and passes after.

**Rationale**: Unit tests are the cheapest guard against regressions and the precondition
for safe refactoring; without them, maintainability (Principle IV) cannot be upheld.

### IV. Maintainability

The built platform MUST remain easy to change. Code MUST be strictly typed: no `any`,
`as any`, `as Record<string, unknown>`, or `as unknown as …` on SDK/API JSON — use
`@fusebase/*` exports, `Awaited<ReturnType<…>>`, `sdk_describe`, and narrowing at
boundaries. Code MUST match the style of its surroundings, stay modular, and avoid
duplication. `npm run lint` and `npm run typecheck` MUST pass. Any isolated SQL schema
change MUST follow migration discipline with no exceptions: update/create files in
`postgres/migrations/` → compute checksum from file bytes → run status → apply.

**Rationale**: Maintainability compounds; type erasure and undisciplined schema changes
pass checks today but cause silent, expensive failures later.

### V. One FuseBase Product

The platform MUST be built entirely on the FuseBase Apps platform within a single FuseBase
product — no external hosting and no parallel stacks. When scope grows, functionality MAY
be split into multiple apps, but every app MUST live within the same product and share its
identity, permissions, and data surfaces. New app-owned structured data MUST use FuseBase
PostgreSQL Database by default; FuseBase Project Dashboards are used only when explicitly
requested or when integrating with an existing dashboard surface.

**Rationale**: One product keeps identity, permissions, deployment, and data coherent;
multiple apps within it provide modular separation without fragmenting the platform.

## Platform & Technology Constraints

- **Runtime & build**: FuseBase Apps platform. Frontend is a React + Vite SPA; an optional
  Hono backend lives in `backend/` and is added only when server-side logic is genuinely
  required. No code is shared between SPA and backend.
- **SDKs**: Runtime code depends on the published `@fusebase/dashboard-service-sdk` and
  `@fusebase/fusebase-gate-sdk` packages from the public npm registry.
- **MCP vs SDK boundary**: Development/LLM work uses MCP only; app runtime uses the SDK
  only. There is no crossover and no MCP workaround scripts. If MCP is unavailable, work
  STOPS rather than inventing workarounds.
- **Dashboard data SDK shape**: `DashboardDataApi` calls (`getDashboardViewData`,
  `batchPutDashboardData`, etc.) MUST use `{ path: { dashboardId, viewId }, … }` in both
  SPA and `backend/` code — never the flat MCP `tool_call` arg shape.
- **Secrets**: Backend `process.env` keys MUST be registered via `fusebase secret create`.
  No `backend/.env` file and no `dotenv` dependency.
- **IDs**: Database/dashboard/view IDs MUST be discovered via MCP — never hardcoded.

## Development Workflow & Quality Gates

- **Spec-driven flow**: Work follows the Spec Kit sequence — constitution → specify →
  clarify → plan → tasks → implement. Plans MUST pass the Constitution Check gate before
  research and again after design.
- **Scaffolding**: New apps MUST be created with `fusebase scaffold`; `package.json`,
  `vite.config.ts`, `tsconfig.json`, `index.html`, and similar config files MUST NOT be
  hand-created. Apps are registered with `fusebase app create` and run locally via
  `fusebase dev start`.
- **Quality gate (before "done")**: `npm run lint`, `npm run typecheck`, and the unit-test
  suite MUST all pass. Unresolved errors MUST be surfaced explicitly to the user.
- **Deploy & permissions**: Deployment uses `fusebase deploy`. `deploy` publishes code
  only — runtime permissions are published exclusively via `fusebase app create` /
  `fusebase app update` (including `--sync-gate-permissions` for Gate-integrated apps).
- **Version control**: Changes are committed atomically with clear, descriptive messages.

## Governance

This constitution supersedes other practices and conventions. When a conflict arises, the
constitution wins.

- **Amendments** require a documented rationale, a version bump, and propagation of any
  resulting changes to dependent templates in `.specify/templates/`.
- **Versioning policy** follows semantic versioning: MAJOR for backward-incompatible
  principle removals or redefinitions, MINOR for a new principle/section or materially
  expanded guidance, PATCH for clarifications and non-semantic refinements.
- **Compliance**: Every plan's Constitution Check and every code review MUST verify
  adherence to these principles. Justified deviations MUST be recorded in the plan's
  Complexity Tracking table; unjustified violations MUST be rejected.
- **Runtime development guidance**: Day-to-day implementation guidance lives in `AGENTS.md`
  and `.claude/skills/`; those documents MUST stay consistent with this constitution.

**Version**: 1.0.0 | **Ratified**: 2026-05-22 | **Last Amended**: 2026-05-22
