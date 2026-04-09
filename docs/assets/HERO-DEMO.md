# Hero demo recipe

A 20–30 second terminal recording that shows `claude-code-lane-lock` blocking a
drift prompt at t=0, allowing an opted-in cross-lane peek, and passing a doctor
check. The end product is an animated GIF (or webm) for the README and GitHub
social preview.

This recipe is reproducible from scratch, and assumes zero new dependencies
beyond what the plugin already ships.

## 0. Prerequisites

Pick **one** recording path:

| Platform       | Recorder                                | Converter              |
| -------------- | --------------------------------------- | ---------------------- |
| Linux / macOS  | `asciinema` (`pipx install asciinema`)  | `agg` (recommended) or `asciicast2gif` |
| Windows 11     | Windows Terminal built-in recording, or Windows Game Bar (Win+G) → MP4 | `ffmpeg` → GIF |
| Any            | `vhs` by Charm (scripted, deterministic) | native `.gif` output   |

`agg` (ascii-gif) is the best option if you can install it:
<https://github.com/asciinema/agg>. It produces tight, clean GIFs from asciinema
casts with controllable FPS and font rendering.

## 1. Prep the demo environment

These commands are executed **once, before you start recording**. They are not
part of the recording.

```bash
# Create three sibling generic projects to demonstrate drift detection.
mkdir -p ~/projects/project-alpha ~/projects/project-beta ~/projects/project-gamma
for d in alpha beta gamma; do
  (cd ~/projects/project-$d && git init -q && \
    echo "# project-$d" > README.md && \
    git add README.md && git -c user.email=demo@example.com -c user.name=demo commit -qm init)
done

# Pin a shell into project-alpha. The plugin's install hook will write the
# lockfile on first `lane-lock status` call, or automatically when a Claude Code
# session starts here.
cd ~/projects/project-alpha
lane-lock install --session-id demo-hero   # one-shot, creates the lockfile
```

Set a clean, large font in your terminal (at least 16pt) and size the window
to roughly **96 cols × 24 rows** — this is the sweet spot for a GIF that is
readable inline on GitHub.

Clear your scrollback:

```bash
clear
```

## 2. The recording — commands to type

Start the recorder **now**. The exact commands the viewer should see you type
are below, with pacing notes.

```bash
# --- ASCIINEMA ---
asciinema rec ~/lane-lock-hero.cast \
  --idle-time-limit 1.5 \
  --title "claude-code-lane-lock — block drift at t=0"
```

Or, if you're using `vhs` (recommended for deterministic output — no typing
practice required):

```tape
# save as docs/assets/hero-demo.tape
Output docs/assets/hero-demo.gif
Set FontSize 18
Set Width 1200
Set Height 720
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set PlaybackSpeed 1.0

Type "cd ~/projects/project-alpha" Enter
Sleep 800ms
Type "lane-lock status" Enter
Sleep 2s

Type "lane-lock simulate 'fix the project-beta dashboard bug'" Enter
Sleep 3s

Type "lane-lock simulate '[cross-lane: project-beta] glance at the dashboard for the pattern'" Enter
Sleep 3s

Type "lane-lock doctor" Enter
Sleep 3s
```

### The script, broken down

| # | Command (typed verbatim) | Purpose | Target duration |
|---|---|---|---|
| 1 | `cd ~/projects/project-alpha` | Establish the pinned lane | 1 s |
| 2 | `lane-lock status` | Show the active pin | 3 s |
| 3 | `lane-lock simulate "fix the project-beta dashboard bug"` | Hero: drift **BLOCK** at t=0 | 5 s |
| 4 | `lane-lock simulate "[cross-lane: project-beta] glance at the dashboard for the pattern"` | Escape hatch: **ALLOW + warn** | 5 s |
| 5 | `lane-lock doctor` | Quick green diagnostic | 4 s |
| — | stop recording (`Ctrl-D` or `exit`) | | — |

Total: **~22 seconds** inside the 20-30 s budget.

## 3. Expected output — verify before publishing

Your cast should contain these snippets. Use them as a golden reference in CI
or for a hand-check.

### Step 2 — `lane-lock status`

```text
lane-lock status
  session   demo-hero
  pin       /home/user/projects/project-alpha
  aliases   project-alpha
  pinned_at 2026-04-08T19:21:04Z
  config    ~/.claude/lane-lock/config.json
  ok ✓
```

### Step 3 — drift block

```text
lane-lock simulate "fix the project-beta dashboard bug"
  hook      UserPromptSubmit
  decision  BLOCK
  reason    sibling alias detected
  token     project-beta
  pin       project-alpha
  exit      2
  stderr    lane-lock: drift prompt BLOCKED before reasoning started
            (sibling 'project-beta' detected, pin=project-alpha)
            hint: prefix with [cross-lane: project-beta] to opt in
```

### Step 4 — escape hatch

```text
lane-lock simulate "[cross-lane: project-beta] glance at the dashboard for the pattern"
  hook      UserPromptSubmit
  decision  ALLOW
  reason    explicit cross-lane tag
  token     project-beta
  pin       project-alpha
  exit      0
  stderr    lane-lock: cross-lane peek permitted (project-beta), pin held
```

### Step 5 — doctor

```text
lane-lock doctor
  node        v20.11.1     ok
  hooks dir   ~/.claude/lane-lock/hooks ok
  lockfile    sessions/demo-hero.json   ok
  config      config.json               ok
  git root    ~/projects/project-alpha  ok
  all checks passed ✓
```

If any of those blocks drift from the cast, re-record — the demo is the docs.

## 4. Render to GIF

### With `agg` (cleanest)

```bash
agg --font-size 18 --theme monokai --speed 1.2 \
    ~/lane-lock-hero.cast \
    ~/Projects/claude-code-lane-lock/docs/assets/hero-demo.gif
```

Target: **< 1.5 MB**. If it's over, drop to `--font-size 16` and
`--speed 1.4`, or prune dead frames with:

```bash
asciinema cat ~/lane-lock-hero.cast | \
  jq -c 'select(.[1] != "o" or (.[2] | length) > 0)' > ~/trimmed.cast
```

### With `vhs` (deterministic, no recording needed)

```bash
vhs docs/assets/hero-demo.tape
# writes docs/assets/hero-demo.gif directly
```

### With Windows Game Bar + ffmpeg

```bash
# Record with Win+G → saves to ~/Videos/Captures/*.mp4
ffmpeg -i lane-lock-hero.mp4 \
  -vf "fps=15,scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  -loop 0 \
  ~/Projects/claude-code-lane-lock/docs/assets/hero-demo.gif
```

## 5. Reference it from the README

```markdown
![claude-code-lane-lock demo](docs/assets/hero-demo.gif)
```

## 6. Cleanup

```bash
# Reverse the demo environment when you're done.
rm -rf ~/projects/project-alpha ~/projects/project-beta ~/projects/project-gamma
lane-lock uninstall --session-id demo-hero
```

## Notes

- **Do not** record a real project in your fleet. Only the generic
  `project-alpha / -beta / -gamma` names should ever appear in the published GIF.
- Keep the prompt/PS1 minimal during recording: `export PS1='$ '`.
- If you need larger fonts for a blog post, re-render from the same `.cast` —
  don't re-record. The cast is source-of-truth, the GIF is a derivative.
- `vhs` is the most reliable path because the tape file lives in the repo and
  anyone can regenerate the GIF bit-identical in CI.
