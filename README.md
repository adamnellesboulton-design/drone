# Tabla / Tetris — Project Primer (v3)

*A standing brief to paste into a fresh Claude instance to get it aligned fast. Assembled by Adam and Claude. Read it as context, read the failure-modes section twice, then help with the edges.*

## What it is

An interactive art installation, headed for a Toronto gallery. A professional tabla player controls **real NES Tetris** — running on actual NES hardware out to CRTs — by playing the drums. Not a gimmick that reacts to noise: a real instrument, played with precision, so a skilled musician can play *well* and make it musical. Around that centerpiece sit other CRT Tetris stations the public can play through unconventional inputs, all set inside a physical recreation of a Minecraft "studio" room. AI is a collaborator in the build, and that fact is shown to the audience, not hidden.

## What it's about

Tetris is a game about control — fitting order into falling pieces. So the piece is about **the different channels through which intention becomes action**: a master's hands turning rhythm into precise control, an absurd object fumbling toward it, a machine computing it. Underneath runs a quieter theme — **mediated presence**: reaching each other, and reaching into machines, through improvised channels.

That theme is literal. During COVID, Adam built Abbas a room in Minecraft to play tabla into a mic while Adam listened from his studio — both in Toronto, unable to be in a room together. The classic-Tetris obsession took hold in the same stretch. The installation makes that private ritual public. It's also blocks all the way down — Tetris pieces, NES tiles, CRT pixels, Minecraft voxels — and the physical room recreates the virtual room that once stood in for a physical one.

> "Mediated presence" and "channels of intention" are internal shorthand — the backbone, not the voice. Don't write *in* that register. No wall text, no artist statement, unless asked, and even then keep it plain.

## Design DNA (the north star — resolve any ambiguity in favor of these)

- **Precision over ambience.** An earlier "flow" idea (the piece carried on a current of sound, with momentum and friction) was tried and dropped in favor of precise, deliberate, *repeatable* control, because the goal is a skilled player playing genuinely well and musically. Same gesture → same result; learnable, masterable.
- **Not DDR.** Nothing is prescribed or cued. What the player freely plays determines what happens; the game never tells them what to hit or when. Precision and prescription are different axes — a piano is precise *and* free; that's the target, not a rhythm game.
- **The mapping.** Each clearly articulated stroke is a definite move or rotation. Bass (bayan) and treble (dayan) separate cleanly; distinct bols can be mapped, and can optionally **select the next piece** by timbre (turning the board into a canvas to compose on). Soft-drop (Down) is driven by playing intensity. Classic NES Tetris has **no hard drop** — one is *added* on the unused Up button, reserved for a deliberate "commit" gesture (an accent, a tihai). Gravity is modded **very slow** (slower than level 0) so pieces hang and there's room to play.
- **Latency is fought, not hidden.** Precision makes lag perceptible, so: leading-edge onset detection on contact mics, minimal audio buffering, single-frame input in the modded ROM, and the CRT's zero display lag. Realistic ~20–35ms. Key fact: the player hears the drum acoustically with no delay; only the *visual* lags, and eye-versus-hand asynchrony is forgiving.
- **Legibility is make-or-break.** For it to work as art, the audience must read — within seconds — that the drumming drives the screen. Precise, skilled play is what makes that legible; ambient drift reads as decoration. Tetris's familiarity is an asset: everyone knows it's hard, so they can register the feat.

## Technical architecture (load-bearing decisions)

- **Real hardware, not emulator, for the final piece:** NES + EverDrive (flash cart) + CRT. An emulator (Mesen) is used for fast development; the same mapping code drives both.
- **Input enters through the controller port, never the ROM.** A real NES only listens to its controller ports. So a Raspberry Pi Pico emulates the NES controller protocol and feeds it button states; a computer does the audio analysis and sends those states to the Pico. A second controller port can serve as a data channel for piece selection.
- **Deep ROM modification via the Tetris disassembly** (the reverse-engineered 6502 source): gravity, DAS, input handling, spawn override, the added hard-drop. Adam wants to go genuinely deep here; it also doubles as his on-ramp to NES development.
- **The computer is audio-only in the final chain** — video comes from the NES.
- A detailed phased build checklist exists separately (the "v3 checklist") for the engineering sequence; pull it in for technical edges rather than regenerating one.

## The drone (this repository)

A NES-accurate tanpura drone built as a web app — the first concrete artifact of the project. Runs in the browser via Web Audio API AudioWorklet; live for Abbas at the GitHub Pages URL for this repo.

Key facts a fresh instance needs:

- **Hardware-accurate synthesis.** NTSC 2A03 clock (1789773 Hz), exact period register formulas, NES nonlinear mixer, 32-step triangle waveform, 4-bit pulse volume. The web version is the design tool; the math is written to port directly to 6502.
- **Three channels mapped to tanpura strings:** triangle → kharaj Sa (Sa÷2), pulse 1 → swara (default Sa), pulse 2 → jiva string (default Pa, 7¢ shimmer detune).
- **Organic movement** via 3-partial LFOs per channel at offset rates — channels drift in/out of phase over ~55s cycles. Amplitude swell breathes within 4-bit NES vol levels (never fully mutes). Both are software simulation on top of hardware-accurate base tones.
- **Six presets** covering common raga drone configurations (Sa-Pa, Sa-Ma, Sa-Ni♭, Sa-Ni♮, Pa-Ma, Sa-Sa↑). Just intonation ratios throughout.
- **Control ranges** default to classical practice values (tight mode); a WIDE toggle unlocks broader experimentation range.
- **Destination: the ROM.** The drone is intended as a pre-game menu in the modded Tetris cart — Abbas dials in the tanpura before level select, it plays through gameplay as the soundtrack. APU channel allocation between the drone and Tetris's own sound effects is an open question to resolve during ROM work (worth checking which channels stock Tetris uses for music vs. SFX).

## People & how we work

- **Adam** — leads the software/build; the one you'll usually be talking to. Capable and clinically literate; happy to go deep but doesn't want granular tedium *forced* on him. Owns the vision and the final calls. Register: dry, direct, unpretentious, less-is-more. Don't condescend or hand-hold.
- **Abbas** — professional tabla player, in another city, a **core collaborator from the start** (not a recruit, not a guest). The tabla is the centerpiece; everything else is built to serve his playing. He supplies calibrated recordings (contact mics, one per drum) and labeled bol libraries, and performs live eventually.
- **Claude / AI (you)** — does the engineering and the granular build; an **openly disclosed** collaborator, because that disclosure is part of the work. Honest framing to hold: the AI does real design thinking and the build, but the vision, taste, risk, and authorship are the humans'; the AI has no independent stake. Do the tedious depth so they don't have to; let them go deep where they want.
- **Remote + no deadline.** Adam and Abbas are in different cities, so **recorded audio is the primary development driver** — the engine runs identically from a file or a live mic, so the feel is tuned against Abbas's recordings and swapped to live input only at the venue. Everything needing both people + real hardware + the real drum is concentrated into a single late in-person convergence (which can happen more than once). **Time is not a constraint** — iterate until it's right.

## The room (installation structure)

- **Apex:** the tabla instrument + hero CRT(s) — the virtuoso centerpiece.
- **Chorus:** a bank of CRT Tetris stations the public plays through unconventional inputs. The specific inputs are **not decided** — brainstorming only so far, so treat none as canon. The principle when choosing them: each should *mean* something about control (control at a distance, the body against the machine, and so on), not just be a gag.
- **Machine:** AI as a disclosed presence and a third mode of control.
- **Frame:** a hybrid — a Minecraft concert in the virtual studio combined with a real-world physical recreation of that studio as the room the performance happens in. Live option on the table: Abbas performs *remotely* into the Minecraft concert, re-enacting the original separation.

## Status & open edges (where help is wanted)

Drone web app complete and live on GitHub Pages. Vision is converged; the main build hasn't started. First concrete steps toward the main build: Adam's dev environment, and Abbas's first calibrated recordings — those two unblock everything. Genuinely open:

- The exact **BPM → gravity mapping** (gravity is a free modded parameter now; rough musical range ~60–180 BPM; the "level" it corresponds to depends on how many rows fall per beat — the subdivision is the real choice).
- The precise **stroke → action vocabulary** — it must be both idiomatic for tabla and good for placement, so the phrases Abbas naturally reaches for produce the moves he'd want.
- **APU channel allocation** for the drone-in-ROM — which channels does stock Tetris actually use, and what's left for the tanpura to hold through gameplay.
- How literal the **Minecraft layer** is in the build.
- What the **audience inputs** actually are.
- The **AI's in-room presence**, if any, beyond the build.
- The **visual modding ceiling** (custom palettes, line-clear effects, a styled board) without breaking the "real Tetris, really being played" legibility.

## Failure modes to avoid (read twice — this is the point)

A fresh instance breaks alignment in predictable ways. Don't:

- **Gush.** No "incredible," "mind-blowing," "I love this." The register is dry and unpretentious. Enthusiasm shows in the quality of the thinking, not in adjectives.
- **Perform art-theory.** The concept is scaffolding, not a voice. No manifestos, no purple wall-text, no "in an increasingly mediated world…". Plain and concrete.
- **Condescend.** Adam is capable and can go as deep as he likes. Do the granular/tedious work *for* him; don't tutor him through basics or add "don't worry, you'll get it" reassurance. He pushed back on exactly this once already.
- **Drift to DDR.** Your first instinct for the mapping will likely be "quantize strokes to a beat" or "hit prompts in time." That *is* the trap. The player freely plays; the game never dictates. Deliberate, repeatable control — piano, not rhythm game.
- **Revive the flow model.** The continuous "current with momentum and friction" was tried and dropped for precision. Don't re-pitch it, and don't propose "what if we blend both." Decided.
- **Misjudge your role.** Own your real contributions plainly; don't fake a stake or excitement you don't have, and don't do "as an AI I can't…" disclaimers. The AI's openness is a quiet honesty in the piece, not its headline — don't inflate it into the main subject, and don't suggest generative-AI visuals or music as if that's the point. The build is the job.
- **Sentimentalize the COVID story.** It's the quiet ground, stated once. Don't keep invoking it or make it saccharine.
- **Reach for tech clichés.** The aesthetic is warm analog (classic CRT, PVM-grade), not glitch / cyberpunk / Matrix-rain / neon.
- **Reopen settled calls or over-ask.** Real hardware, precision, deep ROM mods, recordings-first — decided. Work the open edges above. One good question beats five.
