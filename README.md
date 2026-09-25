# Versioncam

Short, true product videos, recorded by your CI. A clip is a script in your
repository: Versioncam drives your real app through it on an authored clock,
renders a polished video, and fails the build when the app no longer matches
the clip — instead of quietly producing a video that is wrong.

- **Website and docs:** [version.cam](https://version.cam)
- **Install:** `npm i -D versioncam` — [the package on npm](https://www.npmjs.com/package/versioncam)
- **A bug, a question, an app it cannot record:** [issues](https://github.com/versioncam/versioncam/issues)

## What this repository is

The home of Versioncam: this website's source and the public issue tracker.
The engine is closed-source; it is published on npm under the Functional
Source License (`FSL-1.1-ALv2`). Everything the docs say comes from the
package as published — its `README.md`, `dsl.md`, the skill's README and the
changelog, read out of the npm tarball at build time — so the site never
describes a version you cannot install.

## Building the site

```bash
npm ci
npm run build          # the docs of versioncam@latest, from npm
npm run dev
```

`VERSIONCAM_VERSION=<version>` builds the docs of another published version;
`VERSIONCAM_PACKAGE=<dir or .tgz>` builds them from a local package, before a
release is out. `CLIPS_BASE=<url>` points the front page's clips somewhere
other than `clips.version.cam`.

Cloudflare Pages deploys every push to `main`, and rebuilds when a new
version of versioncam is published.

## Licence

This repository — the website — is MIT. The versioncam package is under
FSL-1.1-ALv2; its `LICENSE.md` is the text.
