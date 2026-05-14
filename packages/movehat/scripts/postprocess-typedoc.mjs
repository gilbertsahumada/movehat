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
import { fileURLToPath } from 'node:url';

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
  const allPages = [...finalPages, ...subdirs];
  writeMetaForDir(dir, title, allPages);
}

const mdFiles = walkMd(referenceDir);
if (mdFiles.length === 0) {
  console.error(`No .md files found under ${referenceDir} — did typedoc run?`);
  process.exit(1);
}

processDir(referenceDir);

console.log(`Postprocessed ${mdFiles.length} TypeDoc pages under ${referenceDir}`);
