// .github/scripts/generate-docs.js
// This script scans your repo, sends code to Claude, and builds a docs site.

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const { glob } = require("glob");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── CONFIG ────────────────────────────────────────────────────────────────
const PROJECT_NAME = process.env.PROJECT_NAME || "My Project";
const REPO_ROOT = process.cwd();
const OUTPUT_DIR = path.join(REPO_ROOT, "docs-site");

// File extensions to document (add/remove as needed)
const INCLUDE_EXTENSIONS = [
  ".js", ".jsx", ".ts", ".tsx",   // JavaScript / TypeScript
  ".py",                           // Python
  ".go",                           // Go
  ".rs",                           // Rust
  ".java",                         // Java
  ".rb",                           // Ruby
  ".php",                          // PHP
  ".cs",                           // C#
  ".cpp", ".cc", ".h",             // C++
];

// Paths to ignore
const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/docs-site/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/.github/**",
];

// Max characters per file sent to Claude (avoid token limits)
const MAX_FILE_CHARS = 8000;
// ───────────────────────────────────────────────────────────────────────────

async function getSourceFiles() {
  const pattern = `**/*{${INCLUDE_EXTENSIONS.join(",")}}`;
  const files = await glob(pattern, {
    cwd: REPO_ROOT,
    ignore: IGNORE_PATTERNS,
    nodir: true,
  });
  return files.sort();
}

function readFile(filePath) {
  const full = path.join(REPO_ROOT, filePath);
  try {
    const content = fs.readFileSync(full, "utf-8");
    return content.length > MAX_FILE_CHARS
      ? content.slice(0, MAX_FILE_CHARS) + "\n\n// ... [truncated for docs generation]"
      : content;
  } catch {
    return null;
  }
}

function detectLanguage(filePath) {
  const ext = path.extname(filePath);
  const map = {
    ".js": "JavaScript", ".jsx": "JavaScript (React)",
    ".ts": "TypeScript", ".tsx": "TypeScript (React)",
    ".py": "Python", ".go": "Go", ".rs": "Rust",
    ".java": "Java", ".rb": "Ruby", ".php": "PHP",
    ".cs": "C#", ".cpp": "C++", ".cc": "C++", ".h": "C/C++ Header",
  };
  return map[ext] || "Unknown";
}

async function generateFileDoc(filePath, content, language) {
  console.log(`  Documenting: ${filePath}`);
  const prompt = `You are a technical documentation expert. Analyze this ${language} file and produce structured documentation in JSON format.

File path: ${filePath}

\`\`\`${language.toLowerCase()}
${content}
\`\`\`

First, determine what KIND of file this is by looking at its contents and path:
- BACKEND/MODULE: has exports, module.exports, classes, utility functions
- FRONTEND/BROWSER: has DOM manipulation, event listeners, fetch calls, UI logic
- API ROUTE/HANDLER: has route handlers (app.get, router.post, express routes, etc.)
- CONFIG: has configuration objects or environment setup
- REACT/VUE/COMPONENT: has JSX, components, or UI framework code
- SCRIPT/CLI: has top-level procedural or scripted code

Based on the file type, populate "exports" with whatever is most meaningful:
- Backend/modules: exported functions and classes
- Frontend scripts: all named functions, event handlers, and key behaviors (NEVER return empty even if no exports keyword)
- API routes: each route with its method, path, and purpose
- React/Vue components: the component with its props and behavior
- Config files: the config keys and their purpose
- Scripts: the main actions the script performs

Respond ONLY with a valid JSON object (no markdown, no backticks):
{
  "overview": "1-2 sentence description of what this file does",
  "fileType": "backend|frontend|api-route|config|react-component|script|other",
  "exports": [
    {
      "name": "functionOrRouteOrComponentName",
      "type": "function|class|constant|route|component|handler|event",
      "signature": "full signature, route path, or component name with props",
      "description": "what it does",
      "params": [{"name": "param", "type": "type", "description": "what it is"}],
      "returns": {"type": "type", "description": "what is returned or rendered"},
      "example": "short usage example"
    }
  ],
  "dependencies": ["list", "of", "key", "imports or external resources used"],
  "notes": "any important notes, gotchas, or usage guidance"
}
IMPORTANT: Always populate exports with something meaningful. If a file has no traditional exports, document its functions, behaviors, routes, or side effects instead. Only return an empty exports array if the file is completely empty or only contains comments.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].text.trim();
    return JSON.parse(text);
  } catch (err) {
    console.warn(`    Warning: Could not parse doc for ${filePath}:`, err.message);
    return { overview: "Documentation could not be generated.", exports: [], dependencies: [], notes: "" };
  }
}

async function generateGuides(allDocs) {
  console.log("\n📖 Generating guides and overview...");
  const summary = allDocs.map(d =>
    `File: ${d.filePath}\nLanguage: ${d.language}\nOverview: ${d.doc.overview}\nExports: ${d.doc.exports.map(e => e.name).join(", ") || "none"}`
  ).join("\n\n");

  const prompt = `You are a technical writer. Based on this codebase summary, write helpful developer guides in JSON format.

${summary}

Respond ONLY with valid JSON (no markdown backticks):
{
  "projectOverview": "2-3 paragraph overview of what this project does and its architecture",
  "gettingStarted": "step-by-step getting started guide in markdown format",
  "guides": [
    {
      "title": "Guide Title",
      "slug": "url-safe-slug",
      "content": "full guide content in markdown"
    }
  ],
  "architecture": "description of how the codebase is structured"
}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].text.trim();
    return JSON.parse(text);
  } catch (err) {
    console.warn("  Warning: Could not generate guides:", err.message);
    return {
      projectOverview: "See individual file documentation below.",
      gettingStarted: "# Getting Started\n\nRefer to the API reference for usage details.",
      guides: [],
      architecture: "",
    };
  }
}

function groupByDirectory(allDocs) {
  const groups = {};
  for (const item of allDocs) {
    const dir = path.dirname(item.filePath) === "." ? "root" : path.dirname(item.filePath);
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(item);
  }
  return groups;
}

function renderMarkdownToHTML(md) {
  // Simple markdown renderer for code blocks, headers, bold, lists
  return md
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="language-${lang}">${escapeHTML(code.trim())}</code></pre>`)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[h|p|l|u|o|c|p])(.+)$/gm, '<p>$1</p>');
}

function escapeHTML(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSite(allDocs, guides) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const grouped = groupByDirectory(allDocs);
  const navItems = Object.keys(grouped).map(dir => ({
    dir,
    files: grouped[dir].map(d => ({
      name: path.basename(d.filePath),
      id: d.filePath.replace(/[^a-zA-Z0-9]/g, "_"),
    })),
  }));

  const guideNavItems = guides.guides.map(g => ({ title: g.title, slug: g.slug }));

  // ── Build shared layout parts ──────────────────────────────────────────
  const sharedCSS = `
    @import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap');

    :root {
      --bg: #0a0a0a;
      --surface: #111111;
      --surface2: #161616;
      --border: #1f1f1f;
      --border2: #2a2a2a;
      --accent: #ffffff;
      --accent-dim: rgba(255,255,255,0.08);
      --accent-hover: rgba(255,255,255,0.04);
      --text: #ededed;
      --text2: #a1a1a1;
      --text3: #666666;
      --blue: #4d9ef7;
      --green: #3ecf8e;
      --orange: #f7934d;
      --purple: #a78bfa;
      --red: #f87171;
      --code-bg: #0d0d0d;
      --sidebar-w: 248px;
      --radius: 6px;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html { font-size: 15px; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Geist', 'Helvetica Neue', sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Typography ── */
    h1 {
      font-family: 'Instrument Serif', Georgia, serif;
      font-size: 2.2rem;
      font-weight: 400;
      letter-spacing: -0.03em;
      line-height: 1.15;
      color: var(--text);
      margin-bottom: 10px;
    }
    h2 {
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text3);
      margin: 40px 0 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    h3 {
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--text2);
      margin: 18px 0 6px;
      letter-spacing: 0.01em;
    }
    p { font-size: 0.9rem; line-height: 1.75; color: var(--text2); margin: 6px 0; }
    li { font-size: 0.9rem; line-height: 1.75; color: var(--text2); margin-left: 18px; }
    strong { color: var(--text); font-weight: 600; }

    a { color: var(--text); text-decoration: none; }
    a:hover { color: var(--text); text-decoration: underline; text-decoration-color: var(--border2); }

    /* ── Code ── */
    code {
      font-family: 'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.8em;
      background: var(--surface2);
      border: 1px solid var(--border);
      padding: 1px 5px;
      border-radius: 4px;
      color: var(--text);
    }
    pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 20px;
      overflow-x: auto;
      margin: 14px 0;
      position: relative;
    }
    pre::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent);
    }
    pre code {
      background: none;
      border: none;
      padding: 0;
      color: var(--text2);
      font-size: 0.82rem;
      line-height: 1.65;
    }

    /* ── Sidebar ── */
    .sidebar {
      width: var(--sidebar-w);
      background: var(--bg);
      border-right: 1px solid var(--border);
      position: fixed;
      top: 0; left: 0; bottom: 0;
      overflow-y: auto;
      z-index: 100;
      padding-bottom: 40px;
      scrollbar-width: none;
    }
    .sidebar::-webkit-scrollbar { display: none; }

    .sidebar-logo {
      padding: 18px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .sidebar-logo-mark {
      width: 20px; height: 20px;
      background: var(--text);
      border-radius: 4px;
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px;
    }
    .sidebar-logo span {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
      letter-spacing: -0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sidebar-section {
      padding: 20px 20px 6px;
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: var(--text3);
    }

    .sidebar a {
      display: flex;
      align-items: center;
      padding: 5px 12px;
      margin: 1px 8px;
      font-size: 0.82rem;
      color: var(--text3);
      border-radius: 5px;
      transition: color 0.1s, background 0.1s;
      line-height: 1.4;
    }
    .sidebar a:hover { color: var(--text); background: var(--accent-hover); text-decoration: none; }
    .sidebar a.active { color: var(--text); background: var(--accent-dim); }

    .sidebar .dir-label {
      padding: 12px 20px 4px;
      font-size: 0.63rem;
      color: var(--border2);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    /* ── Main content ── */
    .main {
      margin-left: var(--sidebar-w);
      flex: 1;
      max-width: 820px;
      padding: 52px 60px 80px;
    }

    /* ── Breadcrumb ── */
    .breadcrumb {
      font-size: 0.75rem;
      color: var(--text3);
      margin-bottom: 28px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .breadcrumb span { color: var(--border2); }

    /* ── File overview callout ── */
    .file-overview {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px 20px;
      margin-bottom: 32px;
      font-size: 0.88rem;
      line-height: 1.7;
      color: var(--text2);
      background: var(--surface);
      position: relative;
      overflow: hidden;
    }
    .file-overview::before {
      content: '';
      position: absolute;
      top: 0; left: 0;
      width: 2px; height: 100%;
      background: var(--text3);
    }

    /* ── Export cards ── */
    .export-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin: 12px 0;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .export-card:hover { border-color: var(--border2); }

    .export-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 18px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    .export-name {
      font-family: 'Geist Mono', monospace;
      font-size: 0.88rem;
      font-weight: 500;
      color: var(--text);
    }
    .export-body { padding: 16px 18px; }
    .export-body > p { margin-bottom: 12px; }

    .signature {
      font-family: 'Geist Mono', monospace;
      font-size: 0.78rem;
      color: var(--text2);
      background: var(--code-bg);
      border: 1px solid var(--border);
      padding: 10px 14px;
      border-radius: var(--radius);
      margin: 10px 0;
      overflow-x: auto;
      line-height: 1.5;
    }

    /* ── Param table ── */
    .param-table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 0.8rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .param-table th {
      text-align: left;
      padding: 8px 14px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      color: var(--text3);
      font-weight: 600;
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }
    .param-table td {
      padding: 9px 14px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
      color: var(--text2);
    }
    .param-table tr:last-child td { border-bottom: none; }
    .param-table td:first-child { font-family: 'Geist Mono', monospace; color: var(--text); font-size: 0.78rem; }
    .param-table td:nth-child(2) { font-family: 'Geist Mono', monospace; color: var(--blue); font-size: 0.78rem; }

    /* ── Tags / badges ── */
    .tag {
      display: inline-flex;
      align-items: center;
      font-size: 0.62rem;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 3px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-family: 'Geist Mono', monospace;
    }
    .tag-function { background: rgba(77,158,247,0.1); color: var(--blue); border: 1px solid rgba(77,158,247,0.2); }
    .tag-class { background: rgba(62,207,142,0.1); color: var(--green); border: 1px solid rgba(62,207,142,0.2); }
    .tag-constant { background: rgba(167,139,250,0.1); color: var(--purple); border: 1px solid rgba(167,139,250,0.2); }
    .tag-type { background: rgba(247,147,77,0.1); color: var(--orange); border: 1px solid rgba(247,147,77,0.2); }
    .tag-interface { background: rgba(248,113,113,0.1); color: var(--red); border: 1px solid rgba(248,113,113,0.2); }

    /* ── Dep badges ── */
    .dep-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .dep-badge {
      font-family: 'Geist Mono', monospace;
      font-size: 0.72rem;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text3);
      padding: 3px 10px;
      border-radius: 3px;
    }

    /* ── Hero stats ── */
    .hero-stats { display: flex; gap: 1px; margin: 28px 0; background: var(--border); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    .stat {
      background: var(--surface);
      padding: 18px 24px;
      flex: 1;
    }
    .stat-num {
      font-family: 'Instrument Serif', serif;
      font-size: 2rem;
      color: var(--text);
      line-height: 1;
      font-weight: 400;
    }
    .stat-label { font-size: 0.72rem; color: var(--text3); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.06em; }

    /* ── Lang badge ── */
    .lang-badge {
      display: inline-flex;
      align-items: center;
      font-family: 'Geist Mono', monospace;
      font-size: 0.68rem;
      padding: 2px 8px;
      border-radius: 3px;
      font-weight: 500;
      background: var(--surface2);
      border: 1px solid var(--border);
      color: var(--text3);
      margin-left: 10px;
      vertical-align: middle;
    }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .sidebar { transform: translateX(-100%); }
      .main { margin-left: 0; padding: 32px 24px; }
    }
  `;

  const buildSidebar = (activePage) => {
    const apiLinks = navItems.map(group => `
      <div class="dir-label">${group.dir}</div>
      ${group.files.map(f =>
        `<a href="api-${f.id}.html" ${activePage === `api-${f.id}` ? 'class="active"' : ''}>${f.name}</a>`
      ).join("")}
    `).join("");

    const guideLinks = guideNavItems.map(g =>
      `<a href="guide-${g.slug}.html" ${activePage === `guide-${g.slug}` ? 'class="active"' : ''}>${g.title}</a>`
    ).join("");

    return `
    <div class="sidebar">
      <div class="sidebar-logo">
        <div class="sidebar-logo-mark">◆</div>
        <span>${PROJECT_NAME}</span>
      </div>
      <div class="sidebar-section">Overview</div>
      <a href="index.html" ${activePage === "index" ? 'class="active"' : ''}>Introduction</a>
      <a href="getting-started.html" ${activePage === "getting-started" ? 'class="active"' : ''}>Getting Started</a>
      ${guideLinks ? `<div class="sidebar-section">Guides</div>${guideLinks}` : ""}
      <div class="sidebar-section">API Reference</div>
      ${apiLinks}
    </div>`;
  };

  // ── Index page ────────────────────────────────────────────────────────
  const totalExports = allDocs.reduce((n, d) => n + (d.doc.exports?.length || 0), 0);
  const languages = [...new Set(allDocs.map(d => d.language))];

  const indexHTML = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>${PROJECT_NAME} Docs</title>
    <style>${sharedCSS}</style>
  </head><body>
    ${buildSidebar("index")}
    <div class="main">
      <div class="breadcrumb">Home</div>
      <h1>${PROJECT_NAME}</h1>
      <p style="font-size:1.05rem;color:#8b949e;margin-bottom:24px;">Auto-generated documentation powered by Claude AI</p>
      <div class="hero-stats">
        <div class="stat"><div class="stat-num">${allDocs.length}</div><div class="stat-label">Files Documented</div></div>
        <div class="stat"><div class="stat-num">${totalExports}</div><div class="stat-label">Exports</div></div>
        <div class="stat"><div class="stat-num">${languages.length}</div><div class="stat-label">Languages</div></div>
      </div>
      <h2>Project Overview</h2>
      ${renderMarkdownToHTML(guides.projectOverview)}
      ${guides.architecture ? `<h2>Architecture</h2>${renderMarkdownToHTML(guides.architecture)}` : ""}
      <h2>Languages</h2>
      <div class="dep-list">${languages.map(l => `<span class="dep-badge">${l}</span>`).join("")}</div>
    </div>
  </body></html>`;
  fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), indexHTML);

  // ── Getting Started page ──────────────────────────────────────────────
  const gsHTML = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>Getting Started — ${PROJECT_NAME}</title>
    <style>${sharedCSS}</style>
  </head><body>
    ${buildSidebar("getting-started")}
    <div class="main">
      <div class="breadcrumb">Home <span>›</span> Getting Started</div>
      ${renderMarkdownToHTML(guides.gettingStarted)}
    </div>
  </body></html>`;
  fs.writeFileSync(path.join(OUTPUT_DIR, "getting-started.html"), gsHTML);

  // ── Guide pages ───────────────────────────────────────────────────────
  for (const guide of guides.guides) {
    const html = `<!DOCTYPE html><html lang="en"><head>
      <meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
      <title>${guide.title} — ${PROJECT_NAME}</title>
      <style>${sharedCSS}</style>
    </head><body>
      ${buildSidebar(`guide-${guide.slug}`)}
      <div class="main">
        <div class="breadcrumb">Home <span>›</span> Guides <span>›</span> ${guide.title}</div>
        ${renderMarkdownToHTML(guide.content)}
      </div>
    </body></html>`;
    fs.writeFileSync(path.join(OUTPUT_DIR, `guide-${guide.slug}.html`), html);
  }

  // ── API reference pages (one per file) ───────────────────────────────
  for (const { filePath, language, doc } of allDocs) {
    const fileId = filePath.replace(/[^a-zA-Z0-9]/g, "_");
    const fileName = path.basename(filePath);
    const dir = path.dirname(filePath);

    const exportsHTML = (doc.exports || []).map(exp => {
      const paramsTable = exp.params?.length ? `
        <table class="param-table">
          <tr><th>Parameter</th><th>Type</th><th>Description</th></tr>
          ${exp.params.map(p => `<tr><td>${p.name}</td><td>${escapeHTML(p.type || "")}</td><td>${p.description || ""}</td></tr>`).join("")}
        </table>` : "";

      const returnsHTML = exp.returns?.type ? `
        <h3>Returns</h3>
        <p><code>${escapeHTML(exp.returns.type)}</code> — ${exp.returns.description || ""}</p>` : "";

      const exampleHTML = exp.example ? `
        <h3>Example</h3>
        <pre><code>${escapeHTML(exp.example)}</code></pre>` : "";

      const typeClass = `tag-${(exp.type || "function").toLowerCase()}`;

      return `
        <div class="export-card">
          <div class="export-header">
            <span class="export-name">${escapeHTML(exp.name)}</span>
            <span class="tag tag-${(exp.type || "function").toLowerCase()}">${exp.type || "function"}</span>
          </div>
          <div class="export-body">
            <div class="signature">${escapeHTML(exp.signature || exp.name)}</div>
            <p>${exp.description || ""}</p>
            ${paramsTable}
            ${returnsHTML}
            ${exampleHTML}
          </div>
        </div>`;
    }).join("");

    const depsHTML = doc.dependencies?.length ? `
      <h2>Dependencies</h2>
      <div class="dep-list">${doc.dependencies.map(d => `<span class="dep-badge">${escapeHTML(d)}</span>`).join("")}</div>` : "";

    const html = `<!DOCTYPE html><html lang="en"><head>
      <meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
      <title>${fileName} — ${PROJECT_NAME}</title>
      <style>${sharedCSS}</style>
    </head><body>
      ${buildSidebar(`api-${fileId}`)}
      <div class="main">
        <div class="breadcrumb">Home <span>›</span> API Reference <span>›</span> ${dir !== "." ? dir + " › " : ""}${fileName}</div>
        <h1>${fileName} <span class="lang-badge">${language}</span></h1>
        <div class="file-overview">${doc.overview || ""}</div>
        ${doc.notes ? `<p><strong>Notes:</strong> ${doc.notes}</p>` : ""}
        ${depsHTML}
        ${exportsHTML ? `<h2>Exports</h2>${exportsHTML}` : "<p style='color:var(--muted)'>No notable exports found in this file.</p>"}
      </div>
    </body></html>`;
    fs.writeFileSync(path.join(OUTPUT_DIR, `api-${fileId}.html`), html);
  }

  console.log(`\n✅ Site built: ${OUTPUT_DIR} (${fs.readdirSync(OUTPUT_DIR).length} pages)`);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔍 Scanning repository...");
  const files = await getSourceFiles();
  console.log(`   Found ${files.length} source files\n`);

  if (files.length === 0) {
    console.log("No source files found. Check INCLUDE_EXTENSIONS in the script.");
    process.exit(0);
  }

  console.log("📝 Generating API documentation...");
  const allDocs = [];
  for (const filePath of files) {
    const content = readFile(filePath);
    if (!content) continue;
    const language = detectLanguage(filePath);
    const doc = await generateFileDoc(filePath, content, language);
    allDocs.push({ filePath, language, doc });
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  const guides = await generateGuides(allDocs);

  console.log("\n🏗️  Building docs site...");
  buildSite(allDocs, guides);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
