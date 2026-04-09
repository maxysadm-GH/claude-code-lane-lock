# Anthropic engagement plan

**Goal**: Get Anthropic to validate (or at minimum, visibly acknowledge) that lane-lock fills a gap they explicitly declined to fix, in a way that turns the closure of `NOT_PLANNED` issues into an endorsement rather than a dismissal.

**Tone**: Respectful and collaborative. Never adversarial. Anthropic closed these issues for legitimate scoping reasons (third-party plugins are the right layer for this). Lane-lock is the community answer, not a complaint.

---

## Tier 1 — Official channels (highest signal, requires Anthropic action)

### 1.1 Claude Code plugin marketplace submission
**Action**: Submit `claude-code-lane-lock` via `claude.ai/settings/plugins/submit` (or the equivalent endpoint per the current plugin docs at `code.claude.com/docs/en/plugin-marketplaces`).

**Why it matters**: Acceptance into the official marketplace IS Anthropic validation. It puts lane-lock in front of every Claude Code user via `/plugin install claude-code-lane-lock@anthropic`.

**Prerequisites**:
- `.claude-plugin/plugin.json` (✅ done)
- Working CI matrix (⏳ in progress)
- Tests passing (⏳ in progress)
- NOTICE file with attribution (✅ done)
- Apache 2.0 license (✅ done)

**What to submit**:
- Repo URL: https://github.com/maxysadm-GH/claude-code-lane-lock
- Short description: *"Pin Claude Code sessions to their project root. Block cross-project drift at `UserPromptSubmit` exit 2 — before reasoning tokens spend."*
- Category: Developer Tools / Safety
- Keywords: `claude-code`, `hooks`, `safety`, `drift-prevention`, `swarm`

**When**: After first green CI run + 48 hours of stability.

**Turnaround**: Unknown. Anthropic's plugin review queue is undocumented. Worst case, this is a submit-and-wait.

---

### 1.2 Show HN — titled for Anthropic's eyes
**Action**: Submit to Hacker News with a title that acknowledges the gap constructively.

**Title options (ranked)**:
1. *"Show HN: Lane-lock – Block Claude Code from drifting into the wrong repo (anthropics/claude-code#13797)"*
2. *"Show HN: A Claude Code plugin that enforces what anthropics/claude-code#13797 won't"*
3. *"Show HN: Pin Claude Code to a repo. Kill cross-project drift at t=0"*

**Why option 1**: including the bug number in the title is a polite, professional way to surface the gap without attacking. Anthropic engineers check HN. A well-written Show HN referencing their closed bug by number becomes a natural callout.

**Body structure**:
- Opening paragraph: the 4-hour drift incident (the story)
- Middle: "I opened issue #13797. Anthropic closed it NOT_PLANNED. I built the community fix. Here it is. Works on their latest version."
- Closing: mention the research that proved nobody else shipped a solution (12 swarm frameworks, none solved cross-repo drift). Invite critique.

**Important**: Do NOT frame this as "Anthropic missed this." Frame it as "Anthropic decided (legitimately) that third-party plugins were the right layer for this. I'm the third-party plugin." That's the respectful framing that invites engagement instead of defensiveness.

---

## Tier 2 — Semi-official channels (medium signal, easy to execute)

### 2.1 GitHub issue comments on closed threads
**Action**: Politely comment on each of the four relevant closed issues to link lane-lock as the community answer.

**Issues to comment on**:
1. [`anthropics/claude-code#13797`](https://github.com/anthropics/claude-code/issues/13797) — the "wrong repo" bug closed NOT_PLANNED. This is THE main target.
2. [`anthropics/claude-code#21397`](https://github.com/anthropics/claude-code/issues/21397) — path-scoped Edit/Write permissions broken. Secondary.
3. [`anthropics/claude-code#27311`](https://github.com/anthropics/claude-code/issues/27311) — plan files overwritten across concurrent sessions. Related.
4. [`anthropics/claude-code#26514`](https://github.com/anthropics/claude-code/issues/26514) — ralph-loop session scoping. Related.

**Comment template (for #13797)**:
> Hi folks — for anyone landing on this issue who needs a workaround today: I shipped a community plugin that addresses this class of drift by adding hooks to every Claude Code session. It pins the session to its git project root at `SessionStart`, and blocks any prompt that references a different project at `UserPromptSubmit` with exit code 2 — before any reasoning token fires.
>
> **→ https://github.com/maxysadm-GH/claude-code-lane-lock**
>
> Published under Apache 2.0. Zero runtime deps. 30 tests across macOS + Linux + Windows. Not affiliated with Anthropic.
>
> Happy to hand this over or make it an official plugin example if the team ever wants — the code is intentionally small (7 hook scripts + 7 lib modules, ~1500 lines). Built because I hit the failure mode in production (details in the README) and the community prior art (git worktrees, claudekit, disler's hooks cookbook, etc.) doesn't cover cross-*repo* drift.

**When**: After CI is green and the README is finalized. Don't post with a broken CI badge.

**Do NOT**: Comment on multiple issues in rapid succession — that reads as spam. Space them by 24 hours. Tailor the comment to each issue's specific scope.

---

### 2.2 Anthropic Discord / Community forums
**Action**: Post in `#claude-code` channel on the Anthropic community Discord (if it exists; the community server sometimes has a plugins / extensions channel).

**Template**:
> Shipped a small plugin that scratched an itch I had: [title + one sentence]. Would love feedback from anyone running multi-project Claude Code sessions in parallel.
>
> Repo: [link]

Keep it short. No self-promotion beyond the link. Respond to questions in-thread.

---

### 2.3 `awesome-claude-code` list PR
**Action**: Open a PR against [`hesreallyhim/awesome-claude-code`](https://github.com/hesreallyhim/awesome-claude-code) adding lane-lock to the Hooks / Safety section.

**Why it matters**: awesome-lists are the first place users look. Being on it is a passive permanent referral.

**PR body**:
> Added `claude-code-lane-lock` under Hooks. It pins Claude Code sessions to their git project root and blocks cross-project drift at `UserPromptSubmit` exit 2. Apache 2.0, zero runtime deps, 30 tests passing.

---

## Tier 3 — Direct engagement (lower signal, higher variance)

### 3.1 Boris Cherny (Anthropic, built Claude Code)
**Handles**:
- Threads: @boris_cherny
- Twitter/X: @bcherny
- GitHub: @bcherny

**Template DM**:
> Hey Boris — built a small plugin that addresses the class of drift discussed in claude-code#13797 (which I saw was closed NOT_PLANNED). It's Apache 2.0 and shipping-quality. No ask — just wanted to flag it in case it's useful as a reference for the plugin marketplace docs or for other users hitting the same issue.
>
> https://github.com/maxysadm-GH/claude-code-lane-lock
>
> Built on Claude Max btw. Thank you for Claude Code.

**Rules**:
- Send ONCE. No follow-up unless he replies.
- Do NOT tag him publicly in the launch tweet thread (that reads as demanding attention).
- If he responds positively, ask nothing specific — let him drive what's next.

### 3.2 Alex Albert (@alexalbert__)
**Why**: Alex is Anthropic's most active public voice on Claude Code community matters. A retweet from him would be the single highest-signal social event.

**Action**: Tag `@alexalbert__` ONCE in the launch tweet thread when it ships, with a single-line note like *"Built this because of an issue Anthropic closed as NOT_PLANNED — here's the community fix."*

---

## Tier 4 — Passive signal (long tail)

### 4.1 Blog post on mbacio.com
- Long-form narrative of the 4-hour drift
- Research pass that proved the gap
- Architecture deep dive
- Link out to the repo
- SEO-friendly title: *"Pinning Claude Code sessions: a 1500-line fix for the overnight drift problem"*

**Why it matters**: Engineers Googling the problem 6 months from now will find this post. Long-tail discovery is where lane-lock makes its money.

### 4.2 Reddit r/ClaudeAI + r/ClaudeCode
- Post title: *"I built a plugin that blocks cross-project drift in Claude Code (the anthropics/claude-code#13797 problem)"*
- Community-tone body, problem-first
- Responsive to comments in the first 2 hours

### 4.3 YouTube short (future)
- 60-second walkthrough of the install + drift block demo
- No talking head needed — just screen + captions
- Embed in README and social

---

## Sequence and gates

**Order of operations**:

1. **Gate**: CI green across all 6 matrix jobs, README at final quality
2. `awesome-claude-code` PR (low-risk, no downside)
3. Show HN submission + tweet thread from MBACIO
4. 24h later: Reddit r/ClaudeCode + r/ClaudeAI
5. 24h later: polite GitHub issue comments on #13797, #21397 (spaced 24h apart)
6. 48h later: Claude Code plugin marketplace submission
7. 72h later: DM to Boris Cherny + blog post publish on mbacio.com
8. Week 2: respond to marketplace review, iterate based on community feedback

**Kill criteria** (back off + wait): if any of the first 3 steps surfaces a serious bug or Anthropic team member responds negatively before step 4, pause the sequence, fix the issue, restart from step 1.

---

## What "Anthropic validation" looks like concretely

Low bar → high bar:

- **Low**: a retweet or fave from any Anthropic employee on the launch tweet
- **Medium**: Boris Cherny or Alex Albert publicly comments positively on the repo or tweet thread
- **Medium-high**: lane-lock is accepted into the Claude Code plugin marketplace
- **High**: Anthropic documentation (in `code.claude.com/docs/en/plugins` or related) references lane-lock as an example community plugin
- **Highest**: Anthropic invites MBACIO into the plugin ecosystem program (if one exists) or engages on the `#13797` thread to signal "here's the community fix, we endorse it"

Any of the Low/Medium outcomes is a win that validates the gap. The High outcomes would be transformative for MBACIO's AI-services portfolio.

---

*This file is the engagement playbook. Do NOT execute step 1 (the PR) until main CI is green and the README is final. Do NOT post on social or the GitHub issue comments until you are 100% confident the repo is clean. Reputation is a one-shot resource.*
