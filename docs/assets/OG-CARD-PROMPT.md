# GitHub social preview / OG card — image generator prompt

A detailed prompt for generating the 1280×640 GitHub social preview card for
`claude-code-lane-lock`. Drop this into DALL·E, Midjourney, Ideogram, FLUX, or
any successor — the prompt is model-agnostic.

## Final image specs

- **Dimensions**: 1280 × 640 px (GitHub social preview)
- **Format**: PNG, sRGB, ≤ 1 MB
- **Filename**: `docs/assets/og-card.png`
- **Safe area**: keep all text at least 80 px from any edge — GitHub crops
  slightly on mobile embeds
- **Contrast**: WCAG-AA against dark background

## Main prompt (paste this)

> A high-end developer-tools social preview card, 1280 by 640 pixels, pure
> dark-mode aesthetic in the visual language of Linear, Vercel, and Raycast.
> Background is a deep near-black slate (#0a0a0f) with a subtle diagonal
> gradient toward a slightly warmer charcoal. A single soft radial glow in the
> top-left in a cool amber tone (#f59e0b at 8% opacity) suggests a warning
> light without dominating the frame.
>
> Centered vertically, left-aligned at roughly 10% from the left edge:
>
> - A minimalist shield glyph rendered as a crisp outlined vector, roughly 96
>   pixels tall, in a muted crimson (#dc2626). Inside the shield, a single
>   horizontal slash line suggests a barrier. No text inside the glyph.
>
> - To the right of the shield, primary title "claude-code-lane-lock" in a
>   modern monospaced variable font, bright off-white (#f1f5f9), weight 700,
>   letter-spacing tight, font size about 68 px. The word "lane-lock" is
>   slightly brighter than the "claude-code-" prefix to draw the eye.
>
> - Immediately below the title, tagline in a lighter neutral gray (#94a3b8),
>   sans-serif, weight 500, size 28 px:
>   "Pin Claude Code sessions. Block drift at t=0."
>
> - Below the tagline, one more line of smaller text in a muted desaturated
>   slate (#64748b), size 18 px, font-family monospace:
>   "$ UserPromptSubmit → exit 2 → 0 reasoning tokens burned"
>
> On the right third of the card, a stylised terminal window mockup with a
> rounded 12 px corner radius, dark window chrome (#1e293b), three traffic
> lights in the top-left of the window, and inside: three lines of fake
> terminal output rendered in a clean monospace at about 16 px. The output
> reads, in order:
>
> 1. `$ lane-lock status` in dim white
> 2. `  pin: ~/projects/project-alpha` in a soft cyan (#7dd3fc)
> 3. `  drift: BLOCKED` in the same muted crimson as the shield
>
> The terminal window has a very subtle 1 px stroke (#334155) and a soft
> drop shadow. No cursor, no animated elements.
>
> In the bottom-right corner, tiny text in #334155, size 14 px:
> "github.com/maxysadm-GH/claude-code-lane-lock"
>
> The entire composition should feel calm and engineered, not loud. Plenty of
> negative space. Think developer-tool product marketing by someone who
> respects the reader. No stock photography, no 3D glass spheres, no abstract
> particles, no generative-AI gloss. Flat vector plus subtle gradients only.
>
> Crucially: **do not include any Anthropic logos, any Claude character art,
> or any orange Anthropic brand mark**. The only branded name in the image is
> the repository name "claude-code-lane-lock" rendered as plain text.

## Negative prompt (for models that support it)

```
Anthropic logo, Claude logo, orange brand mark, mascot, cartoon character,
3D render, glass orb, particles, lens flare, stock photo, photography, hands
on keyboard, clip art, emoji, generic "cyber" aesthetic, neon blue grid,
matrix rain, robots, AI faces, brain imagery, lock-and-key photograph
```

## Style reference keywords (if the generator accepts them)

```
linear.app landing page, vercel.com hero, raycast.com card, fly.io docs,
stripe press kit, developer tools, dark mode, sf mono, jetbrains mono,
geist, inter tight, subtle gradient, vector, flat design
```

## Copy safelist (exact strings allowed in the image)

Only these strings may appear rendered on the card:

1. `claude-code-lane-lock`
2. `Pin Claude Code sessions. Block drift at t=0.`
3. `$ UserPromptSubmit → exit 2 → 0 reasoning tokens burned`
4. `$ lane-lock status`
5. `  pin: ~/projects/project-alpha`
6. `  drift: BLOCKED`
7. `github.com/maxysadm-GH/claude-code-lane-lock`

If the generator adds any other visible text, regenerate.

## Variations worth trying

- **Shield left / text right** (default, described above)
- **Wordmark only** — drop the shield, let the title breathe centered
- **Grid bg** — replace gradient with a subtle 24 px dot grid (#1e293b) at 40%
- **Monochrome** — ditch the crimson shield, render it in the same off-white
  as the title for a more neutral, institutional feel

## Post-processing checklist

- [ ] Resize/crop to exactly 1280 × 640
- [ ] Strip metadata (`exiftool -all= og-card.png`)
- [ ] Run through `oxipng -o 4 og-card.png` to compress
- [ ] Verify < 1 MB final size
- [ ] Spot-check on a phone-sized preview (320 × 160) — main title must still
      be legible
- [ ] Confirm no Anthropic brand assets are visible
