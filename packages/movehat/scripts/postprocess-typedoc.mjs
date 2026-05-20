// Postprocess typedoc-plugin-markdown output for Fumadocs:
// - Inject Fumadocs frontmatter (`title`, `description`) into each page.
// - Rename `.md → .mdx`.
// - Rewrite internal `.md` links to extensionless paths (Fumadocs convention).
// - Emit `meta.json` per directory so the sidebar nav has a stable order.
//
// Anchored to this script's location so it works regardless of caller cwd
// (matches the precedent set by check-package-json.js — see PR #153).

import { readFileSync, writeFileSync, renameSync, readdirSync, statSync, rmSync } from 'node:fs';
import { resolve, dirname, join, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const referenceDir = resolve(here, '..', '..', 'docs', 'content', 'docs', 'api', 'reference');

function walkMd(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkMd(full));
    } else if (extname(entry) === '.md') {
      out.push(full);
    }
  }
  return out;
}

// Extract a single-line description: first non-empty paragraph after the H1
// that isn't itself a header, list, or "Defined in:" link.
function extractDescription(body) {
  const lines = body.split('\n');
  let inFirstParagraph = false;
  const buf = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!inFirstParagraph) {
      if (line === '' || line.startsWith('#') || line.startsWith('Defined in:')) continue;
      inFirstParagraph = true;
    }
    if (line === '') break;
    if (line.startsWith('#') || line.startsWith('Defined in:')) break;
    buf.push(line);
  }
  if (buf.length === 0) return '';
  // Strip markdown emphasis + escape YAML-unfriendly characters.
  return buf
    .join(' ')
    .replace(/[`*_]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .slice(0, 200);
}

function extractTitle(body) {
  const m = body.match(/^#\s+(.+)$/m);
  if (!m) return 'Reference';
  // "Class: Harness" → "Harness"; "Function: foo()" → "foo()"; "movehat" → "movehat".
  return m[1].replace(/^(Class|Interface|Type Alias|Function|Variable|Enumeration):\s+/, '').trim();
}

// `[Foo](path/to/Foo.md)` → `[Foo](path/to/Foo)`; `[Foo](./Foo.md#anchor)` → `[Foo](./Foo#anchor)`.
function rewriteLinks(body) {
  return body.replace(/\]\(([^)]+?)\.md(#[^)]+)?\)/g, '](.$1$2)').replace(/\]\(\.\.\//g, '](../');
}

function processFile(filePath) {
  const body = readFileSync(filePath, 'utf8');
  const title = extractTitle(body);
  const description = extractDescription(body);
  const rewritten = rewriteLinks(body);
  const frontmatter =
    `---\n` +
    `title: ${JSON.stringify(title)}\n` +
    (description ? `description: ${JSON.stringify(description)}\n` : '') +
    `---\n\n`;
  const mdxPath = filePath.replace(/\.md$/, '.mdx');
  writeFileSync(mdxPath, frontmatter + rewritten, 'utf8');
  if (mdxPath !== filePath) rmSync(filePath);
  return { mdxPath, title };
}

const CATEGORY_TITLES = {
  classes: 'Classes',
  interfaces: 'Interfaces',
  'type-aliases': 'Type Aliases',
  functions: 'Functions',
  variables: 'Variables',
  enumerations: 'Enumerations',
};

// Maps each public-surface symbol (re-exported from `packages/movehat/src/index.ts`)
// to a functional category for the sidebar. Drives the Fumadocs
// "---Section---" separators inserted by `groupPagesByCategory`. Unknown
// symbols fall through to "Other".
const SYMBOL_CATEGORY = {
  // Harness
  Harness: 'Harness',
  HarnessDisposedError: 'Harness',
  HarnessMode: 'Harness',
  // Account
  AccountManager: 'Account',
  StoredAccount: 'Account',
  createTestAccount: 'Account',
  // Contract
  MoveContract: 'Contract',
  TransactionResult: 'Contract',
  getContract: 'Contract',
  // Fork
  ForkManager: 'Fork',
  ForkServer: 'Fork',
  ForkStorage: 'Fork',
  MovementApiClient: 'Fork',
  ForkMetadata: 'Fork',
  ForkInfo: 'Fork',
  AccountState: 'Fork',
  LedgerInfo: 'Fork',
  AccountData: 'Fork',
  AccountResource: 'Fork',
  SnapshotOptions: 'Fork',
  compareForkState: 'Fork',
  getForkInfo: 'Fork',
  listSnapshots: 'Fork',
  snapshot: 'Fork',
  viewForkResource: 'Fork',
  // Deployment helpers
  DeployCodeObjectOptions: 'Deployment Helpers',
  UpgradeCodeObjectOptions: 'Deployment Helpers',
  CodeObjectInfo: 'Deployment Helpers',
  RunViewFunctionOptions: 'Deployment Helpers',
  RunMoveScriptOptions: 'Deployment Helpers',
  MoveScriptResult: 'Deployment Helpers',
  DeploymentInfo: 'Deployment Helpers',
  assertTransactionSuccess: 'Deployment Helpers',
  assertTransactionFailed: 'Deployment Helpers',
  getAllDeployments: 'Deployment Helpers',
  getDeployedAddress: 'Deployment Helpers',
  loadDeployment: 'Deployment Helpers',
  saveDeployment: 'Deployment Helpers',
  // Errors
  ModuleAlreadyDeployedError: 'Errors',
  PostPublishError: 'Errors',
  // Test setup / runtime (Other bucket — small, varied surface)
  LocalNodeManager: 'Other',
  LocalNodeOptions: 'Other',
  LocalNodeInfo: 'Other',
  LocalTestingContext: 'Other',
  LocalTestOptions: 'Other',
  MovehatConfig: 'Other',
  MovehatRuntime: 'Other',
  NetworkInfo: 'Other',
  TestEnvironment: 'Other',
  TestFixture: 'Other',
  initRuntime: 'Other',
  setupLocalTesting: 'Other',
  setupMinimalFixture: 'Other',
  setupTestEnvironment: 'Other',
  setupTestFixture: 'Other',
};

// Order categories appear in the sidebar. Anything missing from this list
// is dropped to the bottom under "Other".
const CATEGORY_ORDER = [
  'Harness',
  'Account',
  'Contract',
  'Fork',
  'Deployment Helpers',
  'Errors',
  'Other',
];

// Directories where we apply category grouping. `type-aliases/` is too
// small (1 entry today) to benefit from grouping.
const GROUPED_DIRS = new Set(['classes', 'functions', 'interfaces']);

// Interleave Fumadocs "---SectionTitle---" separators into a sorted page
// list, grouped by the symbol → category map. Within each category,
// preserves the input order (caller is expected to pass alphabetically
// sorted pages).
function groupPagesByCategory(pages) {
  const byCategory = new Map();
  for (const page of pages) {
    const category = SYMBOL_CATEGORY[page] ?? 'Other';
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(page);
  }

  const out = [];
  for (const category of CATEGORY_ORDER) {
    const items = byCategory.get(category);
    if (!items || items.length === 0) continue;
    out.push(`---${category}---`);
    out.push(...items);
  }

  // Any category not in CATEGORY_ORDER falls under a final "Other"-style
  // bucket. Defensive; SYMBOL_CATEGORY today maps every known symbol.
  for (const [category, items] of byCategory) {
    if (CATEGORY_ORDER.includes(category)) continue;
    out.push(`---${category}---`);
    out.push(...items);
  }

  return out;
}

function writeMetaForDir(dir, title, pages) {
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ title, pages }, null, 2) + '\n');
}

function processDir(dir) {
  const subdirs = [];
  const pages = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      subdirs.push(entry);
    } else if (extname(entry) === '.md') {
      const { title } = processFile(full);
      const slug = basename(entry, '.md');
      pages.push({ slug, title });
    }
  }
  for (const sub of subdirs) processDir(join(dir, sub));

  // Root README → index; sort pages alphabetically by slug.
  const orderedPages = pages
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((p) => (p.slug === 'README' ? 'index' : p.slug));

  // Drop typedoc's root README — when it coexists as index.mdx at the same
  // level as subfolders (classes/, functions/, ...), Next's static `/raw/`
  // export collides (EISDIR copying reference.body → reference/). The sidebar
  // nav handles entry anyway; users land on the first subfolder page.
  if (orderedPages.includes('README')) {
    rmSync(join(dir, 'README.mdx'));
  }
  const finalPages = orderedPages.filter((p) => p !== 'README');

  const dirName = basename(dir);
  const title = CATEGORY_TITLES[dirName] ?? 'Reference';
  const orderedFinalPages = GROUPED_DIRS.has(dirName)
    ? groupPagesByCategory(finalPages)
    : finalPages;
  const allPages = [...orderedFinalPages, ...subdirs];
  writeMetaForDir(dir, title, allPages);
}

// Only run as a script when invoked directly via `node ...mjs`. Gating the
// side-effect lets vitest import `groupPagesByCategory` for unit tests
// without triggering `processDir(referenceDir)` (which would fail because
// the typedoc output dir doesn't exist in the test sandbox).
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  const mdFiles = walkMd(referenceDir);
  if (mdFiles.length === 0) {
    console.error(`No .md files found under ${referenceDir} — did typedoc run?`);
    process.exit(1);
  }

  processDir(referenceDir);

  console.log(`Postprocessed ${mdFiles.length} TypeDoc pages under ${referenceDir}`);
}

export { groupPagesByCategory };
