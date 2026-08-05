# Label state machine

An issue's triage state is its combination of `type:*` and `status:*` labels. These two prefixes are the only state-machine labels; everything else (`component:`, `scope:`, `package:`, etc.) is metadata added alongside, not part of the state.

## Status labels

Status labels are mutually exclusive in intent. An issue should normally carry at most one, except `status: needs more information` and `status: waiting for author`, which go together.

| Label                            | Meaning                                                                                                  |
| :------------------------------- | :------------------------------------------------------------------------------------------------------- |
| `status: needs triage`           | Untriaged. Entry state for new issues.                                                                   |
| `status: waiting for maintainer` | Triaged or author replied; ball is in the maintainers' court.                                            |
| `status: needs more information` | Issue is too vague to act on; a specific question was asked.                                             |
| `status: waiting for author`     | Waiting on the reporter to respond (pairs with `needs more information`; stale automation watches this). |
| `status: incomplete`             | Reporter never provided what was asked; effectively dead unless revived.                                 |

## Type labels

An issue has exactly one type once classified and none before.

| Label                     | When                                                      |
| :------------------------ | :-------------------------------------------------------- |
| `type: bug`               | Defect, confirmed or credible with reproduction.          |
| `type: regression`        | Defect that worked in an earlier version and broke later. |
| `type: enhancement`       | Improvement to existing behavior.                         |
| `type: new feature`       | A capability that doesn't exist yet.                      |
| `type: expected behavior` | Works as designed; reporter expected something else.      |

No `type:` or `status:` labels means automation did not run or labels were stripped. Treat the issue as `status: needs triage`; the transitions below apply as-is, but the label delta has nothing to remove.

## Transitions

Every triage run computes one transition and emits only the label delta. Re-running on an already-correct issue must be a no-op.

- `status: needs triage` + **classifiable** → add `type: X` (+ scope/component), remove `status: needs triage`.
- `status: needs triage` + **too vague** → add `status: needs more information` + `status: waiting for author`, remove `status: needs triage`; ask a specific question (which version? minimal repro? expected vs actual?).
- Waiting on author + **author replies with the info** → add `status: waiting for maintainer`, remove both waiting labels; re-triage from there.
- `status: needs triage` + **duplicate / pure support question** → exit via the matching automation trigger in `SKILL.md`; no `type:` label ever added.
- `status: needs triage` + **out of scope** (wrong repo, not actionable here) → add `not planned`, explain why in the triage comment; no `type:` label.

Rules:

1. **No `type:` while waiting on the author** — classification waits for the answer.
2. **`status: needs more information` always pairs with `status: waiting for author`** — the reason plus what the no-response bot watches.
3. **`status: incomplete` is stale-bot-owned** — never transition into it; a revived issue re-enters at `waiting for maintainer`.
4. **One `type:` maximum.** Disagree with an existing one → propose the swap explicitly and say why.

## Existing labels

Never invent a label. Before label operations, run `scripts/list-labels.sh "$REPO"` relative to this skill's directory and only use labels from its output, spelled exactly. It caches per repository; if a desired label is missing, refresh once with `scripts/list-labels.sh "$REPO" --refresh` before concluding it does not exist.

The state-machine labels above exist across MUI repositories, but secondary labels differ (`component: button` vs. `scope: button`, version labels, package labels). Match against the list; drop a label that is not in it from the apply script with a note rather than guessing.
