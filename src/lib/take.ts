// A take: what CI published about the example app's last recording on
// `main`, read the same way at build time (to render the page) and in the
// browser (to catch a take newer than the build).
//
// CI uploads beside each video the recording's own timeline and the script
// that made it, then `manifest.json` last. Everything a take shows comes from
// those files: the commit and the versioncam version are the recording's, and
// the lit line is the recording's own step, never an estimate from the clock.

export type Step = { frame: number; call: string };

export type Manifest = {
  commit: string | null;
  recordedAt: string;
  recorder: string;
  check: boolean;
  clips: {
    id: string;
    title: string;
    fps: number;
    frames: number;
    captured: number | null;
    seconds: number;
    source: boolean;
  }[];
};

type Timeline = {
  fps: number;
  durationFrames: number;
  steps?: Step[];
  meta: { appCommit?: string; recorder?: string; captured?: number };
};

export type TakeClip = {
  id: string;
  title: string;
  fps: number;
  frames: number;
  captured: number | null;
  /** The versioncam that recorded it, from the recording itself. */
  recorder: string | null;
  /** The app's commit, from the recording itself. */
  commit: string | null;
  source: string | null;
  /** Each step, with the index of the source line that made it, if found. */
  steps: (Step & { line: number | null })[];
};

export type Take = {
  commit: string | null;
  recordedAt: string;
  clips: TakeClip[];
};

async function get(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

/** The manifest. `fresh` revalidates it: it is cached for five minutes. */
export async function loadManifest(base: string, fresh = false): Promise<Manifest> {
  const response = await get(
    `${base}/manifest.json`,
    fresh ? { cache: "no-cache" } : undefined,
  );
  return (await response.json()) as Manifest;
}

const newest = new Map<string, Promise<Manifest>>();

/** The newest manifest, asked for once per page however many panels want it. */
export function latestManifest(base: string): Promise<Manifest> {
  let pending = newest.get(base);
  if (!pending) {
    pending = loadManifest(base, true);
    newest.set(base, pending);
  }
  return pending;
}

/**
 * What makes one take's files distinct from the last take's in any cache.
 * Every file but the manifest is asked for with it, so a video and a script
 * from different takes are never shown together.
 */
export function versionQuery(manifest: Pick<Manifest, "commit" | "recordedAt">): string {
  return `?v=${encodeURIComponent(manifest.commit ?? manifest.recordedAt)}`;
}

/** Every clip in the take the manifest names, with its steps bound to lines. */
export async function loadTake(base: string, manifest: Manifest): Promise<Take> {
  const v = versionQuery(manifest);
  const clips = await Promise.all(
    manifest.clips.map(async (clip): Promise<TakeClip> => {
      const [timeline, source] = await Promise.all([
        get(`${base}/${clip.id}.timeline.json${v}`).then(
          (r) => r.json() as Promise<Timeline>,
        ),
        clip.source
          ? get(`${base}/${clip.id}.clip.ts${v}`).then((r) => r.text())
          : Promise.resolve(null),
      ]);
      const steps = timeline.steps ?? [];
      const lines = source ? bind(steps, calls(source)) : steps.map(() => null);
      return {
        id: clip.id,
        title: clip.title,
        fps: timeline.fps,
        frames: timeline.durationFrames,
        captured: timeline.meta.captured ?? clip.captured,
        recorder: timeline.meta.recorder ?? null,
        commit: timeline.meta.appCommit ?? manifest.commit,
        source,
        steps: steps.map((step, i) => ({ ...step, line: lines[i] })),
      };
    }),
  );
  return { commit: manifest.commit, recordedAt: manifest.recordedAt, clips };
}

/** What `versioncam check` printed in the run that published the take. */
export async function loadCheck(base: string, manifest: Manifest): Promise<string | null> {
  if (!manifest.check) return null;
  return (await get(`${base}/check.txt${versionQuery(manifest)}`)).text();
}

// ---- The script ------------------------------------------------------------

// Comments, strings, keywords, numbers and called names, in the site's code
// greys. One pattern, so the classes a line gets here match what Expressive
// Code gives the same text in the docs closely enough to read as one voice.
const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`)|\b(import|from|export|default|async|await|const|let|return|new|typeof|function|true|false|null|undefined)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;
const CLASSES = ["t-c", "t-s", "t-k", "t-n", "t-f"];

export const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The source as HTML, one string per line. */
export function highlight(source: string): string[] {
  const lines = [""];
  const put = (text: string, cls?: string) =>
    text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push("");
      if (!part) return;
      lines[lines.length - 1] += cls
        ? `<span class="${cls}">${escape(part)}</span>`
        : escape(part);
    });
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    put(source.slice(last, match.index));
    put(match[0], CLASSES[match.slice(1).findIndex(Boolean)]);
    last = match.index + match[0].length;
  }
  put(source.slice(last));
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

// A locator is an argument to a line, not a line: the recorder does not count
// these as steps, so neither may the page.
const NOT_A_STEP = /^(by[A-Z]|css$)/;

/**
 * The session calls in a clip's source, in the order written, each with its
 * line. Comments and strings are blanked first, so a call named in a comment
 * is not mistaken for one made.
 */
export function calls(source: string): { call: string; line: number }[] {
  const blank = source.replace(TOKEN, (match, comment, string) =>
    comment || string ? match.replace(/[^\n]/g, " ") : match,
  );
  const session = /async\s*\(\s*([A-Za-z_$][\w$]*)/.exec(blank)?.[1] ?? "s";
  const call = new RegExp(`\\b${session}\\.((?:camera\\.)?[A-Za-z]+)\\s*\\(`, "g");
  return [...blank.matchAll(call)]
    .filter((match) => !NOT_A_STEP.test(match[1]))
    .map((match) => ({
      call: match[1],
      line: blank.slice(0, match.index).split("\n").length - 1,
    }));
}

/**
 * Each recorded step's line: the next call in the source with its name. For a
 * script that runs top to bottom, which the example's are, that is exact; a
 * step with no call left to match gets no line rather than a wrong one.
 */
export function bind(
  steps: Step[],
  found: { call: string; line: number }[],
): (number | null)[] {
  let next = 0;
  return steps.map((step) => {
    const at = found.findIndex((c, i) => i >= next && c.call === step.call);
    if (at < 0) return null;
    next = at + 1;
    return found[at].line;
  });
}

/**
 * The lines to light at `frame`: every step that began on the latest frame
 * any step began on by then. A track write spends no time, so it begins on
 * the same frame as the line after it, and both are running.
 */
export function running(steps: TakeClip["steps"], frame: number): number[] {
  let latest = -1;
  for (const step of steps) if (step.frame <= frame) latest = Math.max(latest, step.frame);
  return steps
    .filter((step) => step.frame === latest && step.line !== null)
    .map((step) => step.line as number);
}

/** The frame each line starts on, for a line that is a step. */
export function lineFrames(steps: TakeClip["steps"]): Map<number, number> {
  const frames = new Map<number, number>();
  for (const step of steps) {
    if (step.line !== null && !frames.has(step.line)) frames.set(step.line, step.frame);
  }
  return frames;
}

/** A camera's timecode, hours to frames. */
export function timecode(frame: number, fps: number): string {
  const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
  const seconds = Math.floor(frame / fps);
  return `${pad(seconds / 3600)}:${pad((seconds / 60) % 60)}:${pad(seconds % 60)}:${pad(frame % fps)}`;
}

/**
 * `versioncam check`'s output as the page shows it: the verdicts set apart,
 * and the count of clips that still match in the colour kept for numbers
 * that can be trusted.
 */
export function formatCheck(text: string): string {
  return text
    .trimEnd()
    .split("\n")
    .map((line) => {
      const verdict = /^(PASS|FAIL)(\s+)(.*)$/.exec(line);
      if (verdict) {
        const [, word, gap, rest] = verdict;
        return `<span class="vc-verdict is-${word.toLowerCase()}">${word}</span>${gap}${escape(rest)}`;
      }
      const tally = /^(\d+\/\d+)( clips still match the app\.)$/.exec(line);
      if (tally) return `<span class="vc-num">${tally[1]}</span>${escape(tally[2])}`;
      return escape(line);
    })
    .join("\n");
}
