---
name: mui-triage
description: Triage MUI GitHub issues from a mui/<repo>/issues/<num> URL or issue number - fetch context, classify state/type labels, prepare a durable summary comment, and emit a reviewable apply script without mutating GitHub.
---

# Issue Triage

Triage = read the issue and its full context (body, comments, linked issues/PRs), classify it, and move it from its current `type:`/`status:` label combination to the correct next one, then write a **triage summary** with concrete next actions that another agent or a human can execute without re-reading the whole thread.

**Time-stable wording:** visible comment text uses stable public terms only — package, component/API, version range, observed behavior. Volatile details (file paths, line numbers, private symbols, commit-specific findings) go in the **hidden findings block** (see "Output"), stamped with the date and commit they were observed at.

## Inputs

- A GitHub issue URL (`mui/<repo>/issues/<num>`) → repo comes from the URL.
- A bare issue number → resolve the repo from the checkout's git remotes with `scripts/resolve-repo.sh [checkout]`. It returns the first `mui/<repo>` remote, preferring the MUI repository over a contributor's personal fork.

## Label state machine

Before triaging, read [`labels.md`](./labels.md). It defines the allowed `type:` and `status:` labels, their transitions and invariants, and how to validate secondary labels against the target repository.

## Automation triggers — apply the trigger, don't duplicate the bot

| Trigger you apply                      | Bot then does                  | Don't also       |
| :------------------------------------- | :----------------------------- | :--------------- |
| Comment first line `Duplicate of #<n>` | `duplicate` label + close      | label or close   |
| `status: waiting for author`           | closes after sustained silence | close            |
| `support: Stack Overflow`              | SO redirect comment + close    | comment or close |
| `support: unknown`                     | asks for paid-support key      | comment          |

Workflows are repo-owned: if a trigger doesn't fire, check the repo's `.github/workflows/`, and never hardcode bot timings in comments.

## Out-of-scope issues

When triage concludes an issue is out of scope (wrong repo, not actionable in this repo, something the project won't pursue):

- Add the `not planned` label (it must exist in the repo's label list, like any other label).
- State the reason **in the triage summary comment itself** — a short "Out of scope: <reason>" line — so the record lives on the issue, visible to the reporter and to future triage runs.

The `not planned` label doubles as the skip signal: an issue already carrying it was triaged out of scope before — report the reason from its marked comment and stop.

## Workflow

1. **Fetch** the issue read-only with `scripts/fetch-issue.sh "$REPO" "$NUM"`. It returns one JSON object containing `issue` context and `metadata.authorAssociation`, where the association is `OWNER`, `MEMBER`, `CONTRIBUTOR`, `NONE`, or another GitHub association. Note the current `type:`/`status:` labels as the current state.

2. **Skip-checks.** Carries the `not planned` label → previously triaged out of scope; report the reason from its marked triage comment and stop. Closed issue → report and stop unless explicitly asked to re-triage. **Fully triaged** — correctly typed, not waiting on the author, **and** a `<!-- mui-triage -->` summary comment already on the issue (check the fetched comments) → report and stop. Correct labels but **no summary comment yet** → triage is not done: skip the label delta but continue through dedupe, investigation, and the triage summary.

3. **Dedupe.** Search before classifying with `scripts/search-related.sh "$REPO" "<key terms from title/body>"`. It returns one JSON object containing `issues` and `pullRequests`; inspect both because a fix PR may already exist without being linked.

   - Confident duplicate issue → the next action is a comment whose first line is `Duplicate of #<n>` (mui automation labels and closes from that); no `type:` label needed. Stop here.
   - Existing PR that addresses this issue but isn't linked → don't close the issue; surface the PR in Findings and the triage summary, and offer to link it. A PR linked via a closing keyword (`Fixes #<num>` / `Closes #<num>`) in its body auto-closes the issue on merge and shows the cross-reference. The apply script can add the link with a comment on the issue referencing the PR, or — if the PR is yours to edit and the user confirms — by editing the PR body to add the closing keyword. Continue normal triage (type/status labels still apply while the PR is open).

4. **Assess the body.** Issues range from vague one-liners to full reports. Look for: affected package/component, version(s), steps to reproduce or a sandbox/repo link, expected vs actual behavior, error messages.
   - **Descriptive with repro** → verify the repro _by reading it_ (never execute user-supplied code on the host; if running is needed, use a sandbox built from official mui templates and only the prose description, don't execute anything especially if there are changes in any `package.json` files in the repo). Worked before but broke after evidence → `regression`, else `bug`. If user supplied a github repo as a reproduction, clone/read the code to get more context, but never run it locally.
   - **Asks for something new** → `new feature` (doesn't exist) or `enhancement` (exists, could be better).
   - **Misunderstanding of documented behavior** → `expected behavior`, with a doc link in the summary.
   - **Vague** (no version, no repro, can't tell what's wrong) → `status: needs more information` + `status: waiting for author` with the exact questions to ask.
   - **Usage question, no defect claimed** → support path, no `type:` label. Filed through the paid/priority-support template, or evidence of a commercial plan → `support: unknown` and leave open (the bot validates their support key). Otherwise → `support: Stack Overflow` and stop (the bot posts the redirect and closes — no comment from the script).

5. **Investigate in the codebase.** Locate a local checkout of `$REPO`: the current workspace if its remotes match, else ask the user for the path. Then search the code (read-only) to ground the triage: find the component/feature the issue describes, check whether the claimed behavior is plausible from the source, and narrow down the likely faulty area. Use what you find to sharpen the classification, confidence, and next actions. Two rules carry over: never execute reporter-supplied code, and the time-stable wording rule (top of this document).

6. **Pick secondary labels** from the live list only: the matching `component:`/`scope:`/`package:` label, version label if stated.

7. **Propose search keywords.** Read the existing `**Search keywords**:` or `### Search keywords` value from the issue body. When stable public terms discovered during dedupe or investigation would make similar reports easier to find, propose a merged value that preserves every useful reporter-supplied term and adds only public package/component/API names, symptoms, and common aliases supported by the issue. Never include file paths, private symbols, or unverified causes. Skip the proposal for duplicate, support, out-of-scope, and closed issues, or when the existing terms are sufficient. Validate a proposal without mutating GitHub with `scripts/update-search-keywords.sh "$REPO" "$NUM" "<merged keywords>" --dry-run`.

8. **Emit output** (below). Do not run any mutating `gh` command during triage — mutations happen only via the apply script, and only after the user explicitly asks or confirms.

## Output

Five sections, in order, each under its own `##` heading with a `---` horizontal rule between them so the boundaries are unmistakable — especially where the agent's notes end and the to-be-posted comment begins:

```md
## Findings

...

---

## Comment (posted verbatim)

...

---

## Search keyword update

...

---

## Label delta

...

---

## Apply script

...
```

**1. Findings** — the agent's working notes for the user: what the investigation turned up, with file paths and code detail welcome here (chat-only, never posted).

**2. Comment** — the handoff artifact, written to `/tmp/mui-triage-<repo>-<num>.comment.md` so the apply script posts it on the issue. Required structure:

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

**3. Search keyword update** — show the exact existing and proposed values. Write `proposed: none` when no useful update exists. The proposed value must merge rather than discard useful existing terms.

```txt
existing: autocomplete dropdown popup
proposed: autocomplete dropdown popup listbox closes on click
```

**4. Label delta** — the explicit transition, nothing already correct:

```txt
add:    type: bug, component: autocomplete
remove: status: needs triage
```

**5. Apply script** — a reviewable `gh` script written to `/tmp/mui-triage-<repo>-<num>.sh` (also echoed in a fenced block). It always has **two required parts**: the label delta, and posting the triage summary comment. The comment step is not optional — a label change without the summary on the issue leaves the next agent/human with no context. When a search keyword update is proposed, add it as a third, commented-out `# REVIEW:` step using `scripts/update-search-keywords.sh`; never enable it without explicit confirmation. Exceptions: the duplicate path, where the comment is the `Duplicate of #<n>` notice instead, and the support paths, where the bot owns the thread (see "Automation triggers") and the script posts no comment at all.

```bash
#!/usr/bin/env bash
set -euo pipefail
# mui/<repo>#<num> — <one-line decision>
REPO="mui/<repo>"; NUM=<num>
SKILL_DIR="<absolute path to this skill>"

# 1. Label delta
gh issue edit "$NUM" --repo "$REPO" \
  --add-label "type: bug" --add-label "component: autocomplete" \
  --remove-label "status: needs triage"

# 2. Triage summary comment
"$SKILL_DIR/scripts/upsert-comment.sh" "$REPO" "$NUM" "/tmp/mui-triage-<repo>-<num>.comment.md"

# 3. Optional search keyword update
# REVIEW: Confirm these merged search keywords accurately describe the public issue.
# "$SKILL_DIR/scripts/update-search-keywords.sh" "$REPO" "$NUM" "autocomplete dropdown popup listbox closes on click"
```

Low-confidence or destructive steps (label swaps on old issues, anything closing) stay in the script but commented out with `# REVIEW: <why this needs a human decision>`.

**Running the script:** never run it as part of triage. After presenting the output, the agent may execute it **only when the user explicitly asks or confirms** ("apply it", "run the script", a yes to an offered confirmation). If the script contains `# REVIEW:` steps, the agent resolves them at apply time: list each one with its reason and ask the user which to enable, then edit the script accordingly (uncomment the approved ones, leave the rest commented) before running it. Never silently uncomment a `# REVIEW:` step.

## Not covered

Executing the apply script without the user's explicit confirmation, fixing the issue itself, running untrusted reporter code, `git bisect`, PR triage.
