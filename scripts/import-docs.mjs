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
  "How it works": ["how-it-works", "overview", 1, "Overview"],
  Speed: ["how-it-works", "speed", 2],
  Determinism: ["how-it-works", "determinism", 3],
  "While recording": ["how-it-works", "while-recording", 4],
  Licence: ["about", "licence", 2],
};

function page(dir, slug, title, order, body, source, label) {
  const front = [
    "---",
    `title: ${JSON.stringify(title)}`,
    "sidebar:",
    `  order: ${order}`,
    ...(label ? [`  label: ${JSON.stringify(label)}`] : []),
    "---",
    "",
  ].join("\n");
  const note = `\n\n---\n\n<small>From ${source}.</small>\n`;
  mkdirSync(join(DOCS, dir), { recursive: true });
  writeFileSync(join(DOCS, dir, `${slug}.md`), `${front}${body.trim()}${note}`);
}

const pkg = packageDir();
const { version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
const read = (file) => readFileSync(join(pkg, file), "utf8");
const from = (file) => `\`${file}\` in versioncam ${version}, as published on npm`;

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
