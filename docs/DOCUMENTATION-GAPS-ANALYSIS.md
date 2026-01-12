# Documentation Gaps Analysis & Additions

This document summarizes the gaps identified in the existing documentation and the additions made to fill them.

## Phase 1: Gap Analysis Summary

### 1. App Lifecycle

**Status**: ⚠️ Partially explained

**Gaps identified**:
- **CLI-FLOWS.md**: Explains the init flow but doesn't clarify what "creating an app" means
- **Missing**: Clear distinction between API-side app entity vs local project
- **Missing**: Explanation of source of truth (API vs fusebase.json)

**Where gap exists**: 
- `docs/CLI-FLOWS.md` - Init Flow section
- `docs/ARCHITECTURE.md` - No conceptual model section

**What was missing**: 
- App is an API entity (source of truth)
- Local project is a workspace that links to an app via `fusebase.json`
- App exists in Fusebase regardless of local files

---

### 2. Feature Lifecycle

**Status**: ⚠️ Partially explained

**Gaps identified**:
- **CLI-FLOWS.md**: Explains feature configuration but doesn't clarify the dual nature
- **Missing**: Distinction between feature record (API) vs feature code (local)
- **Missing**: How feature IDs, paths, and runtime URLs relate

**Where gap exists**:
- `docs/CLI-FLOWS.md` - Feature Configuration Flow section
- `docs/CLI.md` - Feature configuration section

**What was missing**:
- Feature record is API-side entity (metadata)
- Feature code is local source code (implementation)
- They are linked via `fusebase.json` → `features[].id`
- Runtime URL uses API-side feature path, not local directory path

---

### 3. MCP Configuration

**Status**: ⚠️ Partially explained

**Gaps identified**:
- **CLI-FLOWS.md**: Explains MCP preconfiguration but doesn't explain verification
- **Missing**: How to verify MCP is actually working
- **Missing**: What happens if MCP is unavailable

**Where gap exists**:
- `docs/CLI-FLOWS.md` - MCP Preconfiguration Flow section

**What was missing**:
- Manual verification steps
- What to check if MCP fails
- Impact of MCP unavailability on feature code and LLM assistance

---

### 4. SDK Usage

**Status**: ❌ Missing

**Gaps identified**:
- **ARCHITECTURE.md**: Mentions SDK but doesn't explain when/how to use it
- **Missing**: When to use SDK vs MCP tools
- **Missing**: How SDK relates to MCP tools (mirroring)
- **Missing**: How to discover SDK methods

**Where gap exists**:
- `docs/ARCHITECTURE.md` - SDK Integration section (planned, not current)
- No conceptual explanation anywhere

**What was missing**:
- MCP is for discovery, SDK is for execution
- SDK methods mirror MCP tools 1:1 by operation ID
- How to find SDK method corresponding to MCP tool
- When to use each (discovery vs implementation)

---

### 5. LLM Mental Model

**Status**: ⚠️ Partially explained

**Gaps identified**:
- **ARCHITECTURE.md**: Has "How LLM Discovers Capabilities" but incomplete
- **Missing**: Discovery → implementation flow
- **Missing**: Clear "what NOT to do" guidance
- **Missing**: How LLM should move from MCP discovery to SDK implementation

**Where gap exists**:
- `docs/ARCHITECTURE.md` - How LLM Discovers Capabilities section

**What was missing**:
- Step-by-step flow: discovery → planning → implementation
- Explicit "do not" list (guessing endpoints, etc.)
- How LLM should reason about MCP vs SDK usage

---

### 6. Data Operations

**Status**: ⚠️ Partially explained

**Gaps identified**:
- **Missing**: Conceptual flow explanation (how data access works)
- **Missing**: How MCP + SDK work together
- **Missing**: How to discover required IDs (database, dashboard, view)

**Where gap existed** (now resolved):
- `project-template/AGENTS.md` (updated with MCP+SDK model)
- `project-template/skills/FUSEBASE_DASHBOARDS_MCP.md`, `FUSEBASE_DASHBOARDS_SDK.md` (MCP flow + SDK for runtime)

**What was missing**:
- Conceptual hierarchy: Organization → Database → Dashboard → View → Rows
- How to discover IDs (explore-databases.ts vs MCP tools)
- Conceptual flow of read/write operations

---

## Phase 2: Documentation Additions

### New File: `docs/CONCEPTS.md`

**Rationale**: Central location for conceptual explanations that span multiple topics. Provides first-principles understanding of the system.

**Contents**:
- App Lifecycle: API Entity vs Local Project
- Feature Lifecycle: Record vs Code
- Feature IDs, Paths, and Runtime URLs
- MCP vs SDK: Responsibility Split
- How Capability Discovery Works (for Humans and LLMs)
- Conceptual Data Access Flow

**Why separate file**: 
- Concepts are referenced from multiple other docs
- Provides comprehensive conceptual model
- Can be read independently for onboarding

---

### Updated: `docs/ARCHITECTURE.md`

**Additions**:
1. **Conceptual Model section** (after Purpose & Scope):
   - Quick reference to CONCEPTS.md
   - Key definitions (App, Local Project, Feature Record, Feature Code, MCP, SDK)

2. **Enhanced "How LLM Discovers Capabilities" section**:
   - Discovery → Implementation flow (3 phases)
   - Explicit "What LLMs Should NOT Do" section
   - Clear guidance on MCP vs SDK usage

**Why**: Provides architectural context and LLM guidance at the architecture level.

---

### Updated: `docs/CLI-FLOWS.md`

**Additions**:
1. **Init Flow - "What This Creates" section**:
   - Clarifies API-side vs local-side creation
   - Explains source of truth

2. **Feature Configuration Flow - "Understanding Feature Records vs Feature Code" section**:
   - Explains dual nature of features
   - Clarifies relationship between API record and local code

3. **MCP Preconfiguration Flow - Enhanced verification section**:
   - Manual verification steps
   - What to check if MCP fails
   - Impact of MCP unavailability

**Why**: Fills gaps in flow documentation with conceptual clarity.

---

### Updated: `docs/CLI.md`

**Additions**:
1. **Enhanced "Legacy Dashboard Client" section**:
   - Clearer deprecation status
   - Replacement guidance (MCP + SDK)
   - Reference to CONCEPTS.md

2. **Related Documentation section**:
   - Links to all major docs

**Why**: Clarifies deprecated client status and provides navigation.

---

### Updated: `README.md`

**Additions**:
- Added "Conceptual Model" to the list of topics covered
- Added link to CONCEPTS.md

**Why**: Makes conceptual documentation discoverable from main entry point.

---

## Phase 3: Consistency Pass

### Terminology Standardization

**Consistent terms used**:
- **"MCP tool"**: Refers to MCP protocol tools (for discovery)
- **"SDK method"**: Refers to SDK functions (for execution)
- **"Feature record"**: API-side entity (metadata)
- **"Feature code"**: Local source code (implementation)
- **"Discovery"**: Process of finding available operations (MCP)
- **"Execution"**: Process of calling operations (SDK)

**SDK references**:
- Always use `@fusebase/dashboard-service-sdk`
- MCP for discovery, SDK for execution
- SDK methods mirror MCP tools 1:1 by operation ID

### Cross-References

All major docs now link to:
- ARCHITECTURE.md
- CLI.md
- CLI-FLOWS.md
- CONCEPTS.md (new)

### Contradiction Check

**Verified consistency**:
- ✅ App lifecycle: Consistent across all docs (API is source of truth)
- ✅ Feature lifecycle: Consistent (record vs code distinction)
- ✅ MCP vs SDK: Consistent (discovery vs execution)
- ✅ SDK usage: Consistent (use `@fusebase/dashboard-service-sdk`)
- ✅ LLM guidance: Consistent (discover via MCP, execute via SDK)

---

## Summary of Changes

### New Files Created
1. `docs/CONCEPTS.md` - Comprehensive conceptual model

### Files Updated
1. `docs/ARCHITECTURE.md` - Added conceptual model reference and enhanced LLM discovery section
2. `docs/CLI-FLOWS.md` - Added clarifications on app/feature lifecycle and MCP verification
3. `docs/CLI.md` - Enhanced SDK usage section and added links
4. `README.md` - Added link to conceptual model

### Key Additions
- Clear distinction between API entities and local files
- MCP vs SDK responsibility split explained
- Discovery → implementation flow for LLMs
- Conceptual data access flow
- Explicit "what NOT to do" guidance
- MCP verification steps

All existing content has been preserved. Only additions and clarifications were made.
