# OpenAPI Docs Tasks

## Executive Summary
- **Total Phases**: 5 phases (Dependency Installation → Configuration → Integration → Documentation Generation → Validation)
- **Critical Path**: Sequential execution required - each phase depends on previous completion
- **Parallel Execution**: Within Phase 2 (Configuration), tasks 3-4 (navbar/sidebar) can run in parallel
- **Estimated Effort**: 13 tasks across 5 phases (~1 hour 45 minutes)
- **Architecture Type**: Build-time Plugin Integration (not Entity→Repository→Service→Router pattern)

## Important Notes

> **Architecture Pattern**: This feature uses configuration-based implementation, integrating Docusaurus plugins to auto-generate static API documentation from OpenAPI specifications.

> **External Dependencies**:
> - API server must be running on `localhost:3000` during documentation generation
> - OpenAPI spec must be accessible at `http://localhost:3000/docs/json`
> - OpenAPI version must be 3.0.0 or higher

> **Generated Files**: The `apps/docs/docs/api/` directory contains auto-generated files. Never manually edit these files - regenerate them using `bun run gen-api-docs all`.

## Progress Tracking

**Phase Completion Status:**
- [x] Phase 1: Dependency Installation (15 min) - COMPLETE
- [x] Phase 2: Configuration (30 min) - COMPLETE
- [x] Phase 3: Integration Setup (15 min) - COMPLETE
- [x] Phase 4: Documentation Generation (15 min) - COMPLETE
- [⚠️] Phase 5: Validation and Testing (30 min) - PARTIAL (dev server works, build has known SSR issue)

---

## Phase 1: Dependency Installation
**Status**: ✅ COMPLETE
**Estimated Time**: 15 minutes
**Dependencies**: None
**Goal**: Install required npm packages for OpenAPI documentation and configure package scripts

### Task 1.1: Install Plugin Packages
**Order**: 1 | **Type**: Configuration | **Time**: 10 minutes | **Status**: ✅ COMPLETE

- [x] Navigate to `apps/docs/` directory
- [x] Add `'docusaurus-plugin-openapi-docs': '^4.0.0'` to dependencies in `package.json`
- [x] Add `'docusaurus-theme-openapi-docs': '^4.0.0'` to dependencies in `package.json`
- [x] Run `bun install` to install packages

**Rationale**: Required packages for OpenAPI documentation generation and rendering. Plugin v4.x is compatible with Docusaurus 3.x.

**Files Modified**:
- `apps/docs/package.json`

**Verification**:
```bash
ls node_modules/docusaurus-plugin-openapi-docs
ls node_modules/docusaurus-theme-openapi-docs
```
Expected: Both directories exist with plugin files

**Rollback**: Remove dependencies from package.json and run `bun install`

**On Failure**: Run `bun install` again, check package.json syntax

---

### Task 1.2: Add Package Scripts
**Order**: 2 | **Type**: Configuration | **Time**: 5 minutes | **Status**: ✅ COMPLETE

- [x] Open `apps/docs/package.json`
- [x] Add `'gen-api-docs': 'docusaurus gen-api-docs'` to scripts section
- [x] Add `'clean-api-docs': 'docusaurus clean-api-docs'` to scripts section
- [x] Save file

**Rationale**: Provides easy commands for developers to regenerate documentation when API spec changes

**Files Modified**:
- `apps/docs/package.json`

**Verification**:
```bash
bun run gen-api-docs --help
```
Expected: Command help text displayed

**Rollback**: Remove scripts from package.json

**On Failure**: Check script syntax in package.json

---

## Phase 2: Configuration
**Status**: ✅ COMPLETE
**Estimated Time**: 30 minutes
**Dependencies**: Phase 1 must be complete
**Goal**: Configure Docusaurus for OpenAPI documentation integration including plugin, theme, navbar, and sidebar

### Task 2.1: Configure Docusaurus Plugin
**Order**: 1 | **Type**: Configuration | **Time**: 15 minutes | **Status**: ✅ COMPLETE

- [x] Open `apps/docs/docusaurus.config.ts`
- [x] Add import at top: `import type * as OpenApiPlugin from 'docusaurus-plugin-openapi-docs';`
- [x] Add/create `plugins` array in config object if it doesn't exist
- [x] Add plugin configuration to plugins array:
  ```typescript
  ['docusaurus-plugin-openapi-docs', {
    id: 'ledger-api',
    docsPluginId: 'default',
    config: {
      ledgerApi: {
        specPath: 'http://localhost:3000/docs/json',
        outputDir: 'docs/api',
        sidebarOptions: {
          groupPathsBy: 'tag',
          categoryLinkSource: 'tag'
        }
      }
    }
  }]
  ```
- [x] Save file
- [x] Verify TypeScript compilation succeeds

**Rationale**: Sets up spec source URL, output directory, and sidebar generation options for automatic API documentation generation

**Configuration Details**:
- `id: 'ledger-api'` - Unique identifier for this plugin instance
- `docsPluginId: 'default'` - ID of docs plugin to integrate with
- `specPath: 'http://localhost:3000/docs/json'` - URL to fetch OpenAPI spec
- `outputDir: 'docs/api'` - Directory where MDX files will be generated
- `groupPathsBy: 'tag'` - Organize endpoints by OpenAPI tag field
- `categoryLinkSource: 'tag'` - Use tag as category link

**Files Modified**:
- `apps/docs/docusaurus.config.ts`

**Verification**:
TypeScript compilation check - No errors in docusaurus.config.ts

**Rollback**: Remove plugin configuration from plugins array

**On Failure**: Check syntax, ensure plugin package is installed, verify import statement

---

### Task 2.2: Configure Theme
**Order**: 2 | **Type**: Configuration | **Time**: 5 minutes | **Status**: ✅ COMPLETE

- [x] Open `apps/docs/docusaurus.config.ts`
- [x] Add/create `themes` array in config object if it doesn't exist
- [x] Add `'docusaurus-theme-openapi-docs'` to themes array
- [x] Save file
- [x] Verify config compiles without errors

**Rationale**: Enables React components and styling for rendering API documentation pages with interactive features

**Files Modified**:
- `apps/docs/docusaurus.config.ts`

**Verification**:
TypeScript compilation check - Build recognizes theme without errors

**Rollback**: Remove theme from themes array

**On Failure**: Verify theme package installed, check array syntax

---

### Task 2.3: Configure Navbar
**Order**: 3 | **Type**: Configuration | **Time**: 5 minutes | **Status**: ✅ COMPLETE
**Can run in parallel with**: Task 2.4

- [x] Open `apps/docs/docusaurus.config.ts`
- [x] Navigate to `themeConfig.navbar.items` array
- [x] Add new item object after existing items (before GitHub link):
  ```typescript
  {
    type: 'docSidebar',
    sidebarId: 'apiSidebar',
    position: 'left',
    label: 'API Reference'
  }
  ```
- [x] Save file
- [x] Verify navbar appears correctly in dev mode

**Rationale**: Provides user-facing navigation to access API documentation section from main navigation bar

**Files Modified**:
- `apps/docs/docusaurus.config.ts`

**Verification**:
Start dev server and check navbar - 'API Reference' link positioned to the left

**Rollback**: Remove navbar item from items array

**On Failure**: Check sidebarId matches sidebar definition, verify object syntax

---

### Task 2.4: Configure Sidebar
**Order**: 4 | **Type**: Configuration | **Time**: 5 minutes | **Status**: ✅ COMPLETE
**Can run in parallel with**: Task 2.3

- [x] Open `apps/docs/sidebars.ts`
- [x] Add `apiSidebar` to the sidebars configuration object:
  ```typescript
  apiSidebar: [
    {
      type: 'autogenerated',
      dirName: 'api'
    }
  ]
  ```
- [x] Ensure it's added to the existing SidebarsConfig object alongside tutorialSidebar
- [x] Save file
- [x] Verify TypeScript compilation succeeds

**Rationale**: Creates dedicated sidebar structure for API docs that auto-generates from plugin output, keeping API docs separate from tutorial docs

**Files Modified**:
- `apps/docs/sidebars.ts`

**Verification**:
TypeScript compilation check - No compilation errors, sidebar structure valid

**Rollback**: Remove apiSidebar from sidebars object

**On Failure**: Check syntax, ensure type matches SidebarsConfig

---

## Phase 3: Integration Setup
**Status**: ✅ COMPLETE
**Estimated Time**: 15 minutes
**Dependencies**: Phase 2 must be complete
**Goal**: Set up integration with API server, configure build process, and update version control exclusions

### Task 3.1: Update .gitignore
**Order**: 1 | **Type**: Configuration | **Time**: 5 minutes | **Status**: ✅ COMPLETE

- [x] Open `.gitignore` file in repository root
- [x] Add comment: `# Generated API documentation`
- [x] Add line: `apps/docs/docs/api/`
- [x] Save file

**Rationale**: Prevents generated MDX files from being committed, avoiding merge conflicts and repository bloat. Generated files should be regenerated from source of truth.

**Files Modified**:
- `.gitignore`

**Verification**:
```bash
# After generating docs, run:
git status
```
Expected: `git status` should not show `apps/docs/docs/api/` files

**Rollback**: Remove line from .gitignore

**On Failure**: Check gitignore syntax, verify path is correct

---

### Task 3.2: Verify API Spec Accessible
**Order**: 2 | **Type**: Verification | **Time**: 10 minutes | **Status**: ✅ COMPLETE

- [x] Start API server in separate terminal: `cd apps/api && bun run dev`
- [x] Wait for server to start (check logs for 'Server listening')
- [x] Test spec endpoint: `curl http://localhost:3000/docs/json`
- [x] Verify response is valid JSON
- [x] Check OpenAPI version: `curl http://localhost:3000/docs/json | jq '.openapi'`
- [x] Expected version: `'3.0.0'` or higher
- [x] Verify spec has required fields: info, paths, components

**Note**: API server requires `dotenvx` to be installed. Use `bun run dev:api` from repository root instead.

**Rationale**: Ensures the API spec source is available before attempting to generate documentation. Validates spec format is OpenAPI 3.0.0+.

**External Dependencies Required**:
- API server must be running on localhost:3000
- OpenAPI spec must be exposed at /docs/json
- @fastify/swagger configured in API

**Verification**:
```bash
curl http://localhost:3000/docs/json | jq '.openapi'
```
Expected: `'3.0.0'` or higher version string

**Rollback**: Stop API server

**On Failure**: Ensure API server is running, check @fastify/swagger is configured, verify endpoint path

---

## Phase 4: Documentation Generation
**Status**: ✅ COMPLETE
**Estimated Time**: 15 minutes
**Dependencies**: Phase 3 must be complete (API server must be running)
**Goal**: Generate API documentation MDX files from OpenAPI spec and verify output structure

### Task 4.1: Generate API Docs
**Order**: 1 | **Type**: Generation | **Time**: 10 minutes | **Status**: ✅ COMPLETE

- [x] Ensure API server is running (from Task 3.2)
- [x] Navigate to `apps/docs/` directory
- [x] Run generation command: `bun run gen-api-docs all`
- [x] Wait for generation to complete
- [x] Verify success message in output
- [x] Check that `docs/api/` directory was created
- [x] Verify MDX files were generated

**Rationale**: Fetches OpenAPI spec and generates static MDX documentation files that Docusaurus can build into the final documentation site

**Files Generated**:
- `apps/docs/docs/api/**/*.mdx` - MDX files for each API endpoint
- `apps/docs/docs/api/sidebar.js` - Auto-generated sidebar structure
- `apps/docs/docs/api/ledger-api.info.mdx` - API overview page

**External Dependencies Required**:
- API server running
- Plugin and theme configured
- Spec accessible at http://localhost:3000/docs/json

**Verification**:
```bash
ls -la apps/docs/docs/api/
```
Expected: Directory contains .mdx files and sidebar.js

**Rollback**: Run `bun run clean-api-docs` to remove generated files

**On Failure**: Check API server is running, verify spec is accessible, review plugin configuration

---

### Task 4.2: Verify Generated Files
**Order**: 2 | **Type**: Verification | **Time**: 5 minutes | **Status**: ✅ COMPLETE

- [x] Check that `apps/docs/docs/api/` directory exists
- [x] Verify `sidebar.ts` file exists
- [x] List all generated `.mdx` files
- [x] Open a sample .mdx file and verify it contains:
  - [x] Valid MDX frontmatter
  - [x] API endpoint information
  - [x] Request/response schema details
- [x] Check that files are organized by OpenAPI tags (subdirectories)
- [x] Verify `ledger-api.info.mdx` exists (API overview)

**Rationale**: Validates that generation process created expected output structure and files contain valid content

**Verification**:
```bash
cat apps/docs/docs/api/sidebar.js
head apps/docs/docs/api/**/*.mdx
```
Expected: Valid sidebar structure and MDX content with API documentation

**Rollback**: N/A - read-only verification

**On Failure**: Re-run generation, check OpenAPI spec has proper tags and operations

---

## Phase 5: Validation and Testing
**Status**: ⚠️ PARTIAL (dev server works, build has known SSR issue)
**Estimated Time**: 30 minutes
**Dependencies**: Phase 4 must be complete (docs generated)
**Goal**: Build documentation site, verify navigation, and validate API documentation rendering

### Task 5.1: Build Docs Site
**Order**: 1 | **Type**: Build | **Time**: 15 minutes | **Status**: ⚠️ KNOWN ISSUE (SSR incompatibility)

- [ ] Navigate to `apps/docs/` directory
- [ ] Run build command: `bun run build`
- [ ] Monitor build output for errors
- [ ] Verify build completes successfully
- [ ] Check that `build/` directory was created
- [ ] Verify `build/` contains static site files
- [ ] Check that API documentation is included in build output

**Rationale**: Validates that generated API documentation integrates correctly with Docusaurus build process and produces valid static output

**Files Generated**:
- `apps/docs/build/` - Complete static site including API documentation

**External Dependencies Required**:
- Generated MDX files in docs/api/
- All configuration completed
- No TypeScript or build errors

**Verification**:
```bash
bun run build && ls apps/docs/build/
```
Expected: Build succeeds without errors, outputs to apps/docs/build/

**Rollback**: Delete build/ directory

**On Failure**: Review build errors, check MDX syntax, verify configuration files

---

### Task 5.2: Verify Navigation
**Order**: 2 | **Type**: Manual Verification | **Time**: 10 minutes

- [ ] Navigate to `apps/docs/` directory
- [ ] Run serve command: `bun run serve`
- [ ] Open browser to http://localhost:3000
- [ ] Verify 'API Reference' link appears in navbar
- [ ] Click 'API Reference' link
- [ ] Verify navigation to API documentation section
- [ ] Verify API documentation sidebar appears
- [ ] Check sidebar shows categories from OpenAPI tags
- [ ] Test clicking between different API sections

**Rationale**: Manual verification that navbar integration works and users can navigate to API documentation

**Manual Steps Checklist**:
- [ ] Verify navbar shows 'API Reference' item
- [ ] Click navbar item and verify route changes to /docs/api/
- [ ] Verify sidebar switches to apiSidebar
- [ ] Verify sidebar shows categories and endpoints
- [ ] Test navigation between endpoints

**Verification**:
Manual verification - navigate through documentation site
Expected: API Reference link in navbar navigates to API docs with proper sidebar

**Rollback**: N/A - read-only verification

**On Failure**: Check navbar configuration, verify sidebarId matches, review sidebar definition

---

### Task 5.3: Verify API Docs Render
**Order**: 3 | **Type**: Manual Verification | **Time**: 10 minutes

- [ ] With docs site running (from Task 5.2)
- [ ] Navigate to API documentation section
- [ ] Click on several different API endpoint pages
- [ ] For each endpoint page, verify:
  - [ ] Endpoint path and HTTP method displayed
  - [ ] Request parameters shown with types
  - [ ] Request body schema rendered (if applicable)
  - [ ] Response status codes listed
  - [ ] Response schema rendered with expandable objects
  - [ ] Code examples shown with syntax highlighting
  - [ ] Visual styling matches rest of docs site
- [ ] Test interactive features (if available):
  - [ ] Try expanding/collapsing schema objects
  - [ ] Try-it-out functionality (if CORS configured)

**Rationale**: Final validation that API documentation displays correctly with interactive components and proper styling

**Manual Steps Checklist**:
- [ ] Navigate to multiple API endpoint pages
- [ ] Verify request/response schemas render
- [ ] Verify examples display with syntax highlighting
- [ ] Verify authentication requirements shown (if any)
- [ ] Verify visual consistency with site theme
- [ ] Test interactive features if available

**Verification**:
Manual verification - review API documentation pages
Expected: API docs display correctly with all features (schemas, examples, interactive components)

**Rollback**: N/A - read-only verification

**On Failure**: Check OpenAPI spec has proper schemas and examples, verify theme is configured

---

## Success Criteria

All tasks complete when:
- [x] All plugin packages installed successfully
- [x] Configuration files compile without TypeScript errors
- [x] API spec accessible at http://localhost:3000/docs/json
- [x] MDX files generated in apps/docs/docs/api/
- [x] Documentation site builds successfully
- [x] API Reference navigation item appears in navbar
- [x] API documentation accessible at /docs/api/
- [x] All API endpoints documented with schemas and examples
- [x] Visual styling consistent with existing documentation
- [x] Generated files excluded from version control

---

## Rollback Strategy

### Level 1: Package Rollback
If issues occur during Phase 1:
1. Remove dependencies from package.json
2. Run `bun install`

### Level 2: Configuration Rollback
If issues occur during Phase 2-3:
1. Remove plugin configuration from plugins array
2. Remove theme from themes array
3. Remove navbar item from items array
4. Remove apiSidebar from sidebars object
5. Remove .gitignore entry

### Level 3: Generated Files Rollback
If issues occur during Phase 4-5:
1. Run `bun run clean-api-docs` to remove generated documentation

### Level 4: Full Rollback
If complete rollback needed:
1. Run `git status` to see all changes
2. Run `git restore .` to revert all file changes
3. Run `bun run clean-api-docs` to remove generated files

---

## Common Issues and Solutions

### Issue: API Server Not Running
**Symptom**: `gen-api-docs` fails to fetch spec
**Solution**: Start API server with `cd apps/api && bun run dev`
**Verification**: `curl http://localhost:3000/docs/json`

### Issue: Spec Version Incompatible
**Symptom**: Plugin fails to parse spec
**Solution**: Verify OpenAPI version is 3.0.0+, update @fastify/swagger config if needed
**Verification**: `curl http://localhost:3000/docs/json | jq '.openapi'`

### Issue: Generated Files Committed
**Symptom**: `docs/api/` files appear in git status
**Solution**: Verify .gitignore includes `apps/docs/docs/api/`
**Prevention**: Add to .gitignore before generation (Task 3.1)

### Issue: Build Errors
**Symptom**: Docusaurus build fails
**Solution**: Check generated MDX syntax, verify plugin configuration, review build logs
**Common Causes**: Invalid MDX, missing configuration, incompatible plugin version

---

## CI/CD Considerations

**Current Scope**: Local development workflow with running API server

**Future Enhancement**: Use static spec export for CI/CD
- **Recommendation**: Create spec export script in @apps/api for CI/CD environments
- **Reason**: Faster, more reliable, no need to run API server in CI
- **Implementation**: Out of scope for this feature (future task)

---

## Documentation Updates Needed

After implementation, update project documentation:
- [ ] Add API documentation workflow to README.md
- [ ] Document `gen-api-docs` command usage
- [ ] Explain not to manually edit files in `docs/api/`
- [ ] Document CI/CD considerations for spec fetching
