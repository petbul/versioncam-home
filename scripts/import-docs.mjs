// The site's docs, made from the versioncam package exactly as npm publishes
// it — never from its source, which is not public. Every page says which
// version it came from, so the site can never describe a release that does
// not exist.
//
// Where the package comes from:
//   VERSIONCAM_PACKAGE=<dir or .tgz>   a local build (before a release is out)
//   VERSIONCAM_VERSION=<spec>          a published version (default: latest)
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "src", "content", "docs");

function extract(tarball) {
  const into = mkdtempSync(join(tmpdir(), "versioncam-docs-"));
  execFileSync("tar", ["xzf", tarball, "-C", into]);
  return join(into, "package");
}

function packageDir() {
  const given = process.env.VERSIONCAM_PACKAGE;
  if (given) {
    const path = resolve(given);
    return statSync(path).isDirectory() ? path : extract(path);
  }
  const spec = `versioncam@${process.env.VERSIONCAM_VERSION ?? "latest"}`;
  const into = mkdtempSync(join(tmpdir(), "versioncam-pack-"));
  const out = execFileSync(
    "npm",
    ["pack", spec, "--pack-destination", into, "--json"],
    { encoding: "utf8" },
  );
  const [{ filename }] = JSON.parse(out);
  return extract(join(into, filename));
}

/** Split markdown on a heading level, never inside a code fence. */
function sections(markdown, level) {
  const marker = `${"#".repeat(level)} `;
  const out = [{ title: null, lines: [] }];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && line.startsWith(marker)) {
      out.push({ title: line.slice(marker.length).trim(), lines: [] });
    } else {
      out.at(-1).lines.push(line);
    }
  }
  return out;
}

/** One heading level up — a README's `###` is a page's `##` — outside fences. */
function promote(markdown) {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      return !fenced && /^#{3,6} /.test(line) ? line.slice(1) : line;
    })
    .join("\n");
}

/** The body of a document whose first line is its `# Title`. */
function withoutTitle(markdown) {
  const lines = markdown.split("\n");
  return lines[0].startsWith("# ") ? lines.slice(1).join("\n") : markdown;
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Where each README section goes, and a sidebar label where the title alone
// would read oddly in its group. A section the README gains later lands in
// `more/` under its own name, so a release never loses a page to this table.
const PLACES = {
  Install: ["start", "install", 1],
  Configure: ["start", "configure", 2],
  "Write a clip": ["start", "write-a-clip", 3],
  Authoring: ["start", "authoring", 4],
  Commands: ["reference", "commands", 1],
  "What a recording leaves behind": ["reference", "recordings", 3],
  Glossary: ["reference", "glossary", 4],
  "How it works": ["how-it-works", "overview", 1, "Overview"],
  Speed: ["how-it-works", "speed", 2],
  Determinism: ["how-it-works", "determinism", 3],
  "While recording": ["how-it-works", "while-recording", 4],
  Help: ["about", "help", 2],
  Licence: ["about", "licence", 3],
};

// Anchors as Astro writes them (github-slugger), close enough for the
// headings a README uses: lower case, punctuation gone, spaces to hyphens.
function anchor(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

/** Lines outside code fences, with a flag for whether each is fenced. */
function* unfenced(markdown) {
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      yield [line, true];
    } else yield [line, fenced];
  }
}

/** The page's first sentence as plain text, for its meta description. */
function describe(body) {
  for (const block of body.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || /^(#|```|~~~|<|[-*|>] |\d+\. )/.test(text)) continue;
    const plain = text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[`*_]/g, "")
      .replace(/\s+/g, " ");
    const sentence = plain.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? plain;
    return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
  }
  return undefined;
}

// Every section and sub-section a page will hold, by title, so a README's
// italic cross-reference (*In CI*, *Authoring*) can become a link on the
// site while staying plain text on npm.
const targets = new Map();
function register(dir, slug, title, body) {
  targets.set(title, `/${dir}/${slug}/`);
  for (const [line, fenced] of unfenced(body)) {
    const heading = !fenced && line.match(/^#{2,3} (.+)$/);
    if (heading) targets.set(heading[1].trim(), `/${dir}/${slug}/#${anchor(heading[1])}`);
  }
}

/** `*Title*` becomes a link wherever Title names a section elsewhere. */
function link(body, self) {
  const out = [];
  for (const [line, fenced] of unfenced(body)) {
    if (fenced) {
      out.push(line);
      continue;
    }
    // Leave inline code alone: only the text between backtick spans changes.
    out.push(
      line
        .split(/(`[^`]*`)/)
        .map((part, i) =>
          i % 2
            ? part
            : part.replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, (whole, title) => {
                const url = targets.get(title);
                return url && url !== self ? `[${title}](${url})` : whole;
              }),
        )
        .join(""),
    );
  }
  return out.join("\n");
}

/**
 * Code blocks that are a message to the skill rather than a shell command
 * are labelled as such, so nobody pastes `/versioncam "..."` into a terminal.
 */
function label(body) {
  return body.replace(/^```[a-z]*\n(\/versioncam\b)/gm, '```text title="Claude Code"\n$1');
}

const pages = [];
function page(dir, slug, title, order, body, source, sidebarLabel) {
  register(dir, slug, title, body);
  pages.push({ dir, slug, title, order, body, source, sidebarLabel });
}

/** A heading with nothing under it (a changelog's empty Unreleased) is dropped. */
function withoutEmptySections(body) {
  const lines = body.split("\n");
  return lines
    .filter((line, i) => {
      if (!/^## /.test(line)) return true;
      const next = lines.slice(i + 1).find((l) => l.trim() !== "");
      return next !== undefined && !/^## /.test(next);
    })
    .join("\n");
}

function write({ dir, slug, title, order, body, source, sidebarLabel }) {
  const self = `/${dir}/${slug}/`;
  const text = label(link(withoutEmptySections(body), self)).trim();
  let sections = 0;
  for (const [line, fenced] of unfenced(text)) {
    if (!fenced && /^#{2,3} /.test(line)) sections += 1;
  }
  const description = describe(text);
  const front = [
    "---",
    `title: ${JSON.stringify(title)}`,
    ...(description ? [`description: ${JSON.stringify(description)}`] : []),
    // A contents column listing one heading is a column of nothing.
    ...(sections < 2 ? ["tableOfContents: false"] : []),
    "sidebar:",
    `  order: ${order}`,
    ...(sidebarLabel ? [`  label: ${JSON.stringify(sidebarLabel)}`] : []),
    "---",
    "",
  ].join("\n");
  mkdirSync(join(DOCS, dir), { recursive: true });
  writeFileSync(join(DOCS, dir, `${slug}.md`), `${front}${source}\n\n${text}\n`);
}

const pkg = packageDir();
const { version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
const read = (file) => readFileSync(join(pkg, file), "utf8");
// The provenance stamp under each page's title: the file, and the release it
// came from, amber on the site because it is read from the tarball itself.
const from = (file) =>
  `<p class="vc-stamp">Source <code>${file}</code> · versioncam <span class="vc-num">${version}</span> from npm</p>`;

rmSync(DOCS, { recursive: true, force: true });
mkdirSync(DOCS, { recursive: true });

// The README, one page per section; what comes before the first section is
// the lede, and the front page's.
const [lede, ...parts] = sections(read("README.md"), 2);
const extra = [];
for (const part of parts) {
  const [dir, slug, order, label] = PLACES[part.title] ?? [
    "more",
    slugify(part.title),
    50,
  ];
  if (!PLACES[part.title]) extra.push(part.title);
  page(dir, slug, part.title, order, promote(part.lines.join("\n")), from("README.md"), label);
}

page("reference", "dsl", "The clip DSL", 2, withoutTitle(read("dsl.md")), from("dsl.md"));
page("start", "skill", "The skill", 5, withoutTitle(read("plugin/README.md")), from("plugin/README.md"));
page("about", "changelog", "Changelog", 1, withoutTitle(read("CHANGELOG.md")), from("CHANGELOG.md"));

// Links need every page registered first, so pages are written only now.
for (const each of pages) write(each);

// A missing page, in the viewfinder's words: no signal at this address.
writeFileSync(
  join(DOCS, "404.md"),
  [
    "---",
    "title: No signal",
    "template: splash",
    "editUrl: false",
    "pagefind: false",
    "hero:",
    "  title: Nothing was recorded here.",
    "  tagline: This address has no page. The clips and the docs are one step back.",
    "  image:",
    `    html: '<div class="vc-nosignal" aria-hidden="true"><span class="vc-nosignal-mode">STBY</span><span class="vc-nosignal-text">NO SIGNAL</span><span class="vc-nosignal-tc">--:--:--:--</span></div>'`,
    "  actions:",
    "    - text: version.cam",
    "      link: /",
    "    - text: Read the docs",
    "      link: /start/install/",
    "      variant: minimal",
    "---",
    "",
  ].join("\n"),
);

// The front page: the README's own lede and install commands, and the example
// app's clips as this repository's CI last rendered them.
const [tagline, ...rest] = lede.lines
  .filter((line) => !line.startsWith("# "))
  .join("\n")
  .trim()
  .split(/\n\s*\n/);
const install = parts.find((p) => p.title === "Install");
const commands =
  install?.lines.join("\n").match(/```bash\n([\s\S]*?)```/)?.[1]?.trim() ??
  "npm i -D versioncam";
const template = readFileSync(join(ROOT, "scripts", "index.mdx.template"), "utf8");
writeFileSync(
  join(DOCS, "index.mdx"),
  template
    .replaceAll("{{version}}", version)
    .replaceAll("{{tagline}}", JSON.stringify(tagline.replace(/\s+/g, " ").trim()))
    .replaceAll("{{lede}}", rest.join("\n\n"))
    .replaceAll("{{install}}", commands)
    .replaceAll("{{clips}}", process.env.CLIPS_BASE ?? "https://clips.version.cam/example"),
);

console.log(
  `docs from versioncam ${version}: ${parts.length} README sections, the DSL, the skill, the changelog` +
    (extra.length ? `; new sections in more/: ${extra.join(", ")}` : ""),
);
