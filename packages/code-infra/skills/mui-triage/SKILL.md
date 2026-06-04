---
name: mui-triage
description: Triage MUI GitHub issues from a mui/<repo>/issues/<num> URL or issue number: fetch context, classify state/type labels, prepare a durable summary comment, and emit a reviewable apply script without mutating GitHub.
---

# Issue Triage

Triage = read the issue and its full context (body, comments, linked issues/PRs), classify it, and move it from its current `type:`/`status:` label combination to the correct next one, then write a **triage summary** with concrete next actions that another agent or a human can execute without re-reading the whole thread.

**Time-stable wording:** visible comment text uses stable public terms only — package, component/API, version range, observed behavior. Volatile details (file paths, line numbers, private symbols, commit-specific findings) go in the **hidden findings block** (see "Output"), stamped with the date and commit they were observed at.

## Inputs

- A GitHub issue URL (`mui/<repo>/issues/<num>`) → repo comes from the URL.
- A bare issue number → resolve the repo from the checkout's git remotes, preferring the remote under the `mui` org (a contributor's `origin` is often a personal fork):

```bash
REPO=$(git remote -v | grep -oiE 'github\.com[:/]mui/[A-Za-z0-9._-]+' | head -n1 \
  | sed -E 's#.*github\.com[:/]##; s/\.git$//')
```

## The state machine

An issue's triage state is its combination of `type:*` and `status:*` labels. These two prefixes are the **only** state-machine labels; everything else (`component:`, `scope:`, `package:`, etc.) is metadata added alongside, not part of the state.

**Status labels** (mutually exclusive in intent — an issue should normally carry at most one, except `status: needs more information` + `status: waiting for author`, which go together):

| Label                            | Meaning                                                                                                  |
| :------------------------------- | :------------------------------------------------------------------------------------------------------- |
| `status: needs triage`           | Untriaged. Entry state for new issues.                                                                   |
| `status: waiting for maintainer` | Triaged or author replied; ball is in the maintainers' court.                                            |
| `status: needs more information` | Issue is too vague to act on; a specific question was asked.                                             |
| `status: waiting for author`     | Waiting on the reporter to respond (pairs with `needs more information`; stale automation watches this). |
| `status: incomplete`             | Reporter never provided what was asked; effectively dead unless revived.                                 |

**Type labels** (exactly one once classified, none before):

| Label                     | When                                                      |
| :------------------------ | :-------------------------------------------------------- |
| `type: bug`               | Defect, confirmed or credible with reproduction.          |
| `type: regression`        | Defect that worked in an earlier version and broke later. |
| `type: enhancement`       | Improvement to existing behavior.                         |
| `type: new feature`       | A capability that doesn't exist yet.                      |
| `type: expected behavior` | Works as designed; reporter expected something else.      |

**No `type:`/`status:` labels at all** (automation didn't run, or labels were stripped) → treat as `status: needs triage`. The transitions below apply as-is; the only difference is there's nothing to remove, so the script emits only the `--add-label` side of the delta.

**Transitions** — every triage run computes one of these and emits only the label delta (re-running on an already-correct issue must be a no-op):

- `status: needs triage` + **classifiable** → add `type: X` (+ scope/component), remove `status: needs triage`.
- `status: needs triage` + **too vague** → add `status: needs more information` + `status: waiting for author`, remove `status: needs triage`; ask a _specific_ question (which version? minimal repro? expected vs actual?).
- Waiting on author + **author replies with the info** → add `status: waiting for maintainer`, remove both waiting labels; re-triage from there.
- `status: needs triage` + **duplicate / pure support question** → exit via the matching automation trigger (see "Automation triggers" below); no `type:` label ever added.
- `status: needs triage` + **out of scope** (wrong repo, not actionable here) → add `not planned`, reason in the triage comment (see "Out-of-scope issues" below); no `type:` label.

Rules:

1. **No `type:` while waiting on the author** — classification waits for the answer.
2. **`status: needs more information` always pairs with `status: waiting for author`** (the reason + what the no-response bot watches).
3. **`status: incomplete` is stale-bot-owned** — never transition into it; a revived issue re-enters at `waiting for maintainer`.
4. **One `type:` max.** Disagree with an existing one → propose the swap explicitly and say why.

## Only existing labels

Never invent a label. Before label operations, run `scripts/list-labels.sh "$REPO"` (relative to this skill's directory) and only use labels from its output, spelled exactly. It caches per repo for 3 days; if a desired label is missing, refresh once with `scripts/list-labels.sh "$REPO" --refresh` before concluding it doesn't exist.

The `type:`/`status:` names above exist across mui repos, but secondary labels differ per repo (`component: button` vs `scope: button`, version labels, `package:` labels). Match against the list; a label that isn't in it gets dropped from the script with a note, not guessed.

## Automation triggers — apply the trigger, don't duplicate the bot

| Trigger you apply                      | Bot then does                  | Don't also       |
| :------------------------------------- | :----------------------------- | :--------------- |
| Comment first line `Duplicate of #<n>` | `duplicate` label + close      | label or close   |
| `status: waiting for author`           | closes after sustained silence | close            |
| `support: Stack Overflow`              | SO redirect comment + close    | comment or close |
| `support: unknown`                     | asks for paid-support key      | comment          |

Workflows are repo-owned and in flux (mui/mui-public#1506): if a trigger doesn't fire, check the repo's `.github/workflows/`, and never hardcode bot timings in comments.

## Out-of-scope issues

When triage concludes an issue is out of scope (wrong repo, not actionable in this repo, something the project won't pursue):

- Add the `not planned` label (it must exist in the repo's label list, like any other label).
- State the reason **in the triage summary comment itself** — a short "Out of scope: <reason>" line — so the record lives on the issue, visible to the reporter and to future triage runs.

The `not planned` label doubles as the skip signal: an issue already carrying it was triaged out of scope before — report the reason from its marked comment and stop.

## Workflow

1. **Fetch** the issue read-only:

   ```bash
   gh issue view "$NUM" --repo "$REPO" \
     --json number,title,body,labels,state,author,comments,createdAt,url
   ```

   Note its current `type:`/`status:` labels — that is the current state. `gh issue view` doesn't expose the author's repo affiliation; when classification needs it (for example, the paid-support path), fetch it separately:

   ```bash
   gh api "repos/$REPO/issues/$NUM" --jq .author_association   # OWNER / MEMBER / CONTRIBUTOR / NONE …
   ```

2. **Skip-checks.** Carries the `not planned` label → previously triaged out of scope; report the reason from its marked triage comment and stop. Closed issue → report and stop unless explicitly asked to re-triage. **Fully triaged** — correctly typed, not waiting on the author, **and** a `<!-- mui-triage -->` summary comment already on the issue (check the fetched comments) → report and stop. Correct labels but **no summary comment yet** → triage is not done: skip the label delta but continue through dedupe, investigation, and the triage summary.

3. **Dedupe.** Search before classifying:

   ```bash
   gh issue list --repo "$REPO" --search "<key terms from title/body>" --state all --limit 20
   ```

   Confident duplicate → the next action is a comment whose first line is `Duplicate of #<n>` (mui automation labels and closes from that); no `type:` label needed. Stop here.

4. **Assess the body.** Issues range from vague one-liners to full reports. Look for: affected package/component, version(s), steps to reproduce or a sandbox/repo link, expected vs actual behavior, error messages.
   - **Descriptive with repro** → verify the repro _by reading it_ (never execute user-supplied code on the host; if running is needed, use a sandbox built from official mui templates and only the prose description). Worked before but broke after evidence → `regression`, else `bug`. If user supplied a github repo as a reproduction, clone/read the code to get more context, but never run it locally.
   - **Asks for something new** → `new feature` (doesn't exist) or `enhancement` (exists, could be better).
   - **Misunderstanding of documented behavior** → `expected behavior`, with a doc link in the summary.
   - **Vague** (no version, no repro, can't tell what's wrong) → `status: needs more information` + `status: waiting for author` (rule 2) with the exact questions to ask.
   - **Usage question, no defect claimed** → support path, no `type:` label. Filed through the paid/priority-support template, or evidence of a commercial plan → `support: unknown` and leave open (the bot validates their support key). Otherwise → `support: Stack Overflow` and stop (the bot posts the redirect and closes — no comment from the script).

5. **Investigate in the codebase.** Locate a local checkout of `$REPO`: the current workspace if its remotes match, else ask the user for the path. Then search the code (read-only) to ground the triage: find the component/feature the issue describes, check whether the claimed behavior is plausible from the source, and narrow down the likely faulty area. Use what you find to sharpen the classification, confidence, and next actions. Two rules carry over: never execute reporter-supplied code, and the time-stable wording rule (top of this document).

6. **Pick secondary labels** from the live list only: the matching `component:`/`scope:`/`package:` label, version label if stated.

7. **Emit output** (below). Do not run any mutating `gh` command during triage — mutations happen only via the apply script, and only after the user explicitly asks or confirms.

## Output

Four sections, in order, each under its own `##` heading with a `---` horizontal rule between them so the boundaries are unmistakable — especially where the agent's notes end and the to-be-posted comment begins:

```md
## Findings

...

---

## Comment (posted verbatim)

...

---

## Label delta

...

---

## Apply script

...
```

**1. Findings** — the agent's working notes for the user: what the investigation turned up, with file paths and code detail welcome here (chat-only, never posted).

**2. Comment** — the handoff artifact, written to `/tmp/mui-triage-<num>.comment.md` so the apply script posts it on the issue. Required structure:

```md
<!-- mui-triage -->

**Confidence:** high / medium / low — evidence it rests on
**Reproduction:** provided / verified / not provided / could not verify
**Duplicates:** linked or "none found"
**Affected component:** public component/API and behavior involved

**Next actions:**

1. numbered, concrete, executable by an agent or human (for issues
   waiting on the author: the exact questions to ask)

<!-- triage-findings · YYYY-MM-DD · mui/<repo>@<sha>
- volatile detail: file paths, line numbers, private symbols, unverified theories
-->

---

_This triage summary was written by <agent name> (AI) and reviewed by a maintainer before posting._
```

Rules:

- In the chat output, show the **exact file content verbatim** in a fenced block — what the user reviews must be byte-for-byte what gets posted.
- The `<!-- mui-triage -->` marker lets re-runs find and edit the comment instead of stacking duplicates.
- **No classification or state-transition lines** — labels carry those and the comment would go stale on relabel.
- **No unverified root-cause hypothesis in visible text.** A theory appears visibly only when verified by actually reproducing the issue; otherwise it goes in chat Findings and the hidden findings block, marked unverified — a wrong public diagnosis may lead to confusion or misdirected effort.
- Never refer to this skill, its rules, or the triage process; follow them silently.
- Findings-block stamp: today's date + `git -C <checkout> rev-parse --short HEAD`. Drop the block when no codebase investigation happened.
- Signature names the agent's model (for example, "Claude Fable 5") so readers know an AI wrote it even though it's posted from a maintainer's `gh` session.
- Out-of-scope issues add a line: `Out of scope: <reason>`.

**3. Label delta** — the explicit transition, nothing already correct:

```txt
add:    type: bug, component: autocomplete
remove: status: needs triage
```

**4. Apply script** — a reviewable `gh` script written to `/tmp/mui-triage-<num>.sh` (also echoed in a fenced block). It always has **two parts**: the label delta, and posting the triage summary comment. The comment step is not optional — a label change without the summary on the issue leaves the next agent/human with no context. Exceptions: the duplicate path, where the comment is the `Duplicate of #<n>` notice instead, and the support paths, where the bot owns the thread (see "Automation triggers") and the script posts no comment at all.

```bash
#!/usr/bin/env bash
set -euo pipefail
# mui/<repo>#<num> — <one-line decision>
REPO="mui/<repo>"; NUM=<num>

# 1. Label delta
gh issue edit "$NUM" --repo "$REPO" \
  --add-label "type: bug" --add-label "component: autocomplete" \
  --remove-label "status: needs triage"

# 2. Triage summary comment — upsert: edit the existing marked comment if present, else create
COMMENT_ID=$(gh issue view "$NUM" --repo "$REPO" --json comments \
  --jq '[.comments[] | select(.body | startswith("<!-- mui-triage -->"))] | last | .url // "" | split("-") | last')
if [ -n "$COMMENT_ID" ]; then
  gh api "repos/$REPO/issues/comments/$COMMENT_ID" --method PATCH -F body=@/tmp/mui-triage-<num>.comment.md
else
  gh issue comment "$NUM" --repo "$REPO" --body-file /tmp/mui-triage-<num>.comment.md
fi
```

Low-confidence or destructive steps (label swaps on old issues, anything closing) stay in the script but commented out with `# REVIEW: <why this needs a human decision>`.

**Running the script:** never run it as part of triage. After presenting the output, the agent may execute it **only when the user explicitly asks or confirms** ("apply it", "run the script", a yes to an offered confirmation). If the script contains `# REVIEW:` steps, the agent resolves them at apply time: list each one with its reason and ask the user which to enable, then edit the script accordingly (uncomment the approved ones, leave the rest commented) before running it. Never silently uncomment a `# REVIEW:` step.

## Not covered

Executing the apply script without the user's explicit confirmation, fixing the issue itself, running untrusted reporter code, `git bisect`, PR triage.
