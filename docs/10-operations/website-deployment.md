# Website Deployment — YourAiDepartment.ai

**Canonical operations runbook for releasing the static production website.**

`docs/02-website/website-build-spec.md` requires that deployment documentation exist. This is that document. Where the two disagree about mechanics, this file wins, because this one describes what is actually done.

---

## Scope — read this before applying anything below

This convention covers **one thing**: the static marketing/content website at `youraidepartment.ai`, built by Astro to `dist/` and deployed manually through SiteGround.

It does **not** apply to, and must never be used as precedent for:

- Sales Brain service deployments
- Twilio infrastructure, voice routing, or campaign configuration
- PostgreSQL or any production database
- systemd services, schedulers, probes, or the outbound caller
- any other server-side system

Those have their own procedures and their own risk profiles. A ZIP in Dropbox is a fine way to ship 247 static files. It is not a way to ship a service.

---

## Production deployment handoff — Dropbox → SiteGround

This is the standing workflow. It does not change unless Michael changes it.

| Step | Who | What |
|---|---|---|
| 1 | Claude / EdgeXpert | Build and verify the exact release locally |
| 2 | Claude / EdgeXpert | **Creates the ZIP** from `dist/` |
| 3 | Claude / EdgeXpert | **Uploads the ZIP to Dropbox** using the `dropbox:` rclone remote in this environment |
| 4 | Claude / EdgeXpert | Hands Michael the filename, path, SHA-256, source SHA, changed files, and extract instructions |
| 5 | **Michael** | **Manually downloads from Dropbox and uploads/extracts it in SiteGround** |
| 6 | Michael | Confirms the upload is complete |
| 7 | Claude / EdgeXpert | **SiteGround and Cloudflare caches are cleared** (guided or performed where possible) |
| 8 | Claude / EdgeXpert | **Production is verified against the exact release SHA / package**, including live behavioural tests |

State it plainly, because it has been got wrong before:

> **Lack of SiteGround credentials in the coding environment is expected, and is not a deployment-preparation blocker.**
>
> Claude does not need SSH access or SiteGround credentials to complete its part of a normal website deployment. The handoff point is **a verified release ZIP uploaded to Dropbox** — not "waiting for credentials". Do not report a deployment as blocked because there is no SSH key. Do not ask Michael for SiteGround credentials.

The one thing Claude genuinely cannot do is step 5. Everything before it is Claude's job, and everything after it is Claude's job.

---

## Claude's part, in order

### 1. Establish what production is actually serving

Never trust a branch name. Prove it from the artifact:

```bash
git archive <suspected-sha> | tar -x -C /tmp/prodcheck
ln -s "$PWD/node_modules" /tmp/prodcheck/node_modules
(cd /tmp/prodcheck && npx astro build)
curl -s https://youraidepartment.ai/ -o /tmp/live_home.html
sha256sum /tmp/live_home.html /tmp/prodcheck/dist/index.html
```

Pages without a `mailto:` link should be **byte-identical**. Pages with one will differ only where Cloudflare rewrites the address into a `__cf_email__` span — that transform is expected and is not a content difference. Confirm the hashed `_astro/*.js` filenames referenced by the live page exist in the build.

Knowing the real production SHA is what makes the next step meaningful.

### 2. Cut the release from production, not from your working branch

Diff the release candidate against the **production SHA**, not against whatever it was developed on top of:

```bash
git diff --stat <production-sha> <release-sha>
```

If that diff contains anything the release is not about, stop and rebuild the branch on top of the production SHA with only the intended change. A compliance fix must not carry an unrelated sprint to production because the two happened to share a checkout. Cherry-pick onto the production SHA; never force-push over the original branch, which stays intact for its own sprint.

The deploy diff should be narrowly explainable in one sentence.

### 3. Verify

On the exact commit that will be deployed:

```bash
npx astro check     # expect 0 errors, 0 warnings
npm test            # builds first, then runs the full suite
grep -c "<loc>" dist/sitemap.xml
```

Record the real numbers. If a count differs from a previous release, explain *why* rather than making it match.

### 4. Know the artifact-level diff before packaging

Source diffs overstate what actually reaches the server. Compare built trees:

```bash
diff -rq /tmp/prodcheck/dist dist
diff <(cd /tmp/prodcheck/dist && find _astro -type f | sort) \
     <(cd dist && find _astro -type f | sort)
```

This produces the exact list of files Michael is replacing, and answers the cache question below.

### 5. Package

```bash
(cd dist && zip -qr "../youraidepartment-production-<yyyymmdd>-<slug>-<sha>.zip" .)
```

Build the ZIP **from inside `dist/`** so paths are web-root-relative with no wrapper directory.

**Never package:** `src/`, `.git/`, `.env` or any secret, `node_modules/`, Sales Brain files, or output from an unrelated sprint. Verify before uploading:

```bash
unzip -l release.zip | grep -Ei "\.git/|node_modules|\.env|/src/|\.ts$" && echo "STOP — contaminated"
```

Then prove the ZIP equals the build:

```bash
unzip -q release.zip -d /tmp/verify && diff -rq dist /tmp/verify
sha256sum release.zip
```

When a release changes only a handful of files, also produce a **delta ZIP** containing just those files at their web-root-relative paths, plus a short `DEPLOY-README.txt`. It is faster to upload and far easier to roll back.

### 6. Upload to Dropbox

The conventional location is:

```
dropbox:/YourAiDepartment-Website/
```

Use it. Do not create parallel folder trees.

```bash
rclone copyto release.zip "dropbox:/YourAiDepartment-Website/release.zip"
rclone lsl "dropbox:/YourAiDepartment-Website/"
```

Verify the upload by size, and ideally by copying it back and re-hashing — a truncated upload that Michael extracts over the document root is a bad way to find out.

### 7. Hand off

Give Michael exactly this, and not much else:

- Dropbox filename and folder
- Share link, if the workflow can produce one
- ZIP size and SHA-256
- Source commit SHA (and the build SHA, if the tip is docs-only — see below)
- The exact list of production files being replaced
- Backup instructions
- Whether to extract over the document root or extract elsewhere and copy

**If the branch tip is a docs-only commit, say so and give both SHAs.** Never imply a docs commit rebuilt assets. Prove it instead: `diff -rq` the two builds and report that `dist/` is byte-identical.

---

## Michael's part

1. Download the ZIP from Dropbox.
2. **Back up the files being replaced first** (SiteGround File Manager → download, or copy to `*.bak-<date>`). For a small release this is seconds and it is the entire rollback plan.
3. Upload and extract through SiteGround File Manager into the document root, or extract locally and upload only the named files.
4. Tell Claude it is done.

---

## After Michael confirms — caches, then verify

### Caches

Purge in this order:

1. **SiteGround** — Site Tools → Speed → Caching → Dynamic Cache → Flush (and the static cache, if enabled).
2. **Cloudflare** — purge by URL for each changed page, or purge everything for a large release.

> **The cache is the most likely way a correct deployment still fails.** Astro content-hashes files under `_astro/`, so asset changes cache-bust themselves. **HTML does not.** A release that changes only `.html` files changes no filename anywhere, and Cloudflare will keep serving the old pages — including the bug you just fixed — until purged. Check `diff -rq` output: if only `.html` files changed, purging is mandatory, not optional.

### Verify

```bash
curl -sI https://youraidepartment.ai/<changed-page>/ | grep -i "last-modified\|cf-cache-status"
```

`last-modified` must have moved. Then confirm content, and re-run whatever behavioural suite the release warranted against the **live** site.

> **Deployed is not live, and live is not verified.** Do not report success from the fact that a ZIP reached Dropbox, or that Michael extracted it. Report it from a fetch of the production URL.

A release that ships client-side behaviour should have a live acceptance script — see `scripts/verify-30923-live.mjs` for the pattern: fetch the real page, extract the inline handler the site is actually serving, and execute it against a DOM shim with `fetch` stubbed. Structural checks on HTML attributes are not enough; the Twilio 30923 rejection was caused by a page whose markup was correct and whose JavaScript was not.

---

## Rollback

The backup from Michael's step 2 is the rollback. Restore the previous files, purge both caches again, re-verify.

Because releases are cut from the production SHA, the previous release is always a clean `git checkout <production-sha> && npm run build` away if the backup is missing.

---

## Related

- `docs/02-website/website-build-spec.md` — build and hosting requirements
- `scripts/verify-30923-live.mjs` — worked example of a live acceptance test
- `docs/twilio-a2p-resubmission.md` — a release whose verification mattered more than its size
