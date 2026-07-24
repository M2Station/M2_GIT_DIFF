# Copilot Instructions

> This file is the project-level guidance for GitHub Copilot / Copilot Chat, **designed to be reusable across projects**.
> Location: `.github/copilot-instructions.md`
>
> This file records no project-specific information (name, tech stack, directory structure) - these are always
> discovered by the agent per Section 2. It can therefore be copied verbatim into any repo, or synced automatically from a central repo.
> Sections marked "(conditional)" apply only when the project matches that shape.

---

## 1. Communication

- Use **Traditional Chinese** for conversational replies; always use **English** for code, variable names, commit messages, and API naming.
- Keep technical terms in their original English (e.g. firmware, schedule, dependency, build); do not force-translate them.
- Answers should be concise and give the conclusion and runnable code directly; no pleasantries or restating the question.
- State "not sure" explicitly where uncertain; do not guess APIs, parameter names, or file structure.
- When the user must **choose or confirm** anything, present the options as a **clickable button list** (an interactive choice prompt), never as free text they must type; typing stays available only as a fallback. This applies to every decision point, confirmations included.

---

## 2. Obtaining Project Context

**Assume no project information.** At the start of each work session, or before performing any cross-file task, discover the project context yourself; do not ask the user to repeat it:

```bash
cat README.md 2>/dev/null | head -60          # project purpose, how to start
cat package.json pyproject.toml Cargo.toml 2>/dev/null   # tech stack, scripts, version location
ls .github/workflows/                          # CI/CD, release method
git log --oneline -15                          # commit conventions, recently active areas
ls -a                                          # config files, project structure
```

Judgment principles:

- **Use the actual files in the repo as the sole basis**; do not rely on assumptions in this file, and do not apply experience from other projects.
- Always derive tech stack, directory structure, naming style, and deployment method from existing code, and follow them.
- When the README or config files lack key information (e.g. start command, deployment target), **ask directly**; do not guess or invent conventions.
- If the project root also has `AGENTS.md`, `CONTRIBUTING.md`, or `docs/`, read and follow them first.
- This file describes **general conventions**; when they conflict with the project's actual conventions, **the project's actual conventions take precedence**.

---

## 3. Technology Choices

Do not assume a tech stack - follow the discovery results from Section 2. The following are general cross-project principles:

- **Follow the project's existing technology**; do not introduce new frameworks, build tools, or abstraction layers out of personal preference.
- Determine the runtime environment (shell, package manager, Node/Python version) from the project config files; when it cannot be determined, ask, do not assume.
- Generated command syntax must match the user's shell (PowerShell / bash / zsh); when unsure, ask first or provide both.

### Dependency Principles

- **Prefer native APIs**; avoid introducing new packages for small features.
- Before adding a dependency, explain the rationale and alternatives, and confirm whether a similar package already exists in the project.
- Do not use unmaintained packages or ones with known security vulnerabilities.
- CDN resources must pin a version; do not use `latest`.
- Always follow the project's existing lock strategy for versions (`^` / `~` / fully pinned); do not change it yourself.

---

## 4. Code Conventions

### General

- Indentation: 4 spaces (consistent across HTML / CSS / JS); do not use tabs.
- Strings: use single quotes `'` in JS; use backticks for template strings.
- Trailing semicolons: **required**.
- Keep one blank line at end of file; use UTF-8 (no BOM), LF line endings.
- Try to keep line length under 120 characters.

### Naming

| Target | Convention | Example |
|---|---|---|
| Variable / function | camelCase | `parseScheduleRow` |
| Class / constructor | PascalCase | `ScheduleEngine` |
| Constant | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| File | kebab-case | `schedule-engine.js` |
| CSS class | kebab-case, semantic | `.milestone-bar` |
| CSS variable | `--` + kebab-case | `--accent-cyan` |
| Private member | `_` prefix | `_cache` |

### Writing Functions

- A function does one thing only; consider splitting when it exceeds 50 lines.
- Switch to an options object when there are more than 3 parameters.
- Return explicitly; avoid judgment errors caused by implicitly returning `undefined`.
- Keep side effects (DOM manipulation, file I/O, DB writes) centralized; do not scatter them through computation logic.

### Comments

- Comments explain **why** something is done, not restate what the code does.
- Add JSDoc to public functions (types + purpose + boundary conditions).
- Mark temporary code with `// TODO:` or `// FIXME:` and add the reason.
- **Do not** produce large amounts of meaningless decorative comments or separator lines.

---

## 5. Error Handling

- Always validate external input (files, APIs, user input) before use.
- Do not use empty `catch {}`; at least log it or convert it to an explicit error.
- Error messages must include enough context to locate the problem (file name, field, index value).
- Use fail-fast for unexpected states; do not silently fall back.
- User-visible error messages in Traditional Chinese; logs in English.

---

## 6. Security

- **Strictly forbidden** to write accounts, passwords, tokens, API keys, internal IPs, or customer confidential data into code.
- Put sensitive config in `.env` or config files, and confirm they are added to `.gitignore`.
- Use obviously fake values in example code: `YOUR_API_KEY`, `example.com`.
- Always use parameterized queries (prepared statements) for SQL; never concatenate strings.
- Avoid `innerHTML` when outputting user data on the frontend, prefer `textContent`; escape when necessary.
- When customer names, project codenames, part numbers, cost, or quote information are involved, do not write them into any repo (including commit messages and PR descriptions).

---

## 7. Git Conventions

### Commit Message

Use Conventional Commits:

```text
<type>(<scope>): <subject>

<body optional, describing the motivation and scope of impact>
```

**type**: `feat` / `fix` / `refactor` / `perf` / `docs` / `style` / `test` / `chore` / `build`

- Subject uses English, starts with a base-form verb, no more than 72 characters, no trailing period.
- One commit contains only one logical change.
- Example: `feat(scheduler): add reverse planning for PCB milestones`

### Branches

- `main`: releasable state; do not push directly.
- `feature/<description>`, `fix/<description>`, `chore/<description>`.
- PRs need a self-check: it runs, no console error, no leftover debug code.

---

## 8. Copilot Behavior

**Must do:**

- Use a **minimal diff** when modifying existing files; do not casually reorder or reformat unrelated blocks.
- Reference the project's existing style and naming before editing; prioritize consistency over personal preference.
- Produced code must be directly runnable; do not leave placeholders like `...` or `// other logic`.
- For multi-file changes, list the plan before starting.
- Before large refactors, deleting files, or changing data structures, **ask for confirmation first** — presented as a **clickable button choice** (e.g. **[Proceed] / [Cancel]**), not as text the user must type.

**Do not:**

- Do not fabricate nonexistent functions, packages, config items, or file paths.
- Do not add frameworks, build tools, or abstraction layers when not asked.
- Do not change existing UI behavior or visual style for the sake of "improvement".
- Do not output lengthy preambles, summaries, or re-paste the entire unmodified file.
- Do not remove existing comments, TODOs, or seemingly useless but unconfirmed code.

---

## 9. Workflow Routing (Prompt Files)

When the user's message matches the semantics below, **read the corresponding prompt file before acting**, and follow that file's steps exactly; do not improvise the flow.

| Trigger semantics | Corresponding file | Description |
|---|---|---|
| `review` / `code review` / self review / "check this" / "take a look at these changes" | `.github/prompts/m2_review.prompt.md` | Self code review, **do not modify code** |
| `pr` / `PR` / "open PR" / "submit for review" / `open pull request` | `.github/prompts/m2_pr.prompt.md` | Open PR -> monitor CI every 3 seconds -> remind the user to confirm the merge |
| `next` / `cleanup` / "wrap up" / "clean up branches" / "back to main" / "ready for next" / "收尾" / "準備下一輪" | `.github/prompts/m2_next.prompt.md` | Post-merge cleanup -> delete merged branch, sync main, verify clean tree, ready for next |
| `release` / "ship a version" / "publish a new version" / "cut a release" / `bump version` | `.github/prompts/m2_release.prompt.md` | Version bump -> PR -> merge -> tag -> CI publish |

### Routing Rules

- Standard flow order: `/m2_review` -> fix -> `/m2_pr` -> user confirms merge -> `/m2_next` (cleanup) -> `/m2_release` when cutting a version.
- If the user only says "release" without specifying a version -> compute the next version per the prompt file rules, report it, then execute.
- When no prompt file matches, **do not invent a release or PR flow** - ask first.
- When a prompt file's rules conflict with this file, **the prompt file takes precedence** (it is the dedicated spec for that task).
- All four flows have a "stop and wait for user confirmation" node; do not skip it for the sake of a smooth flow.

## 10. Single-File HTML Tool Conventions (conditional)

> **Applies only when the project's main output is a single-file `.html` tool that opens directly in a browser.**
> When the project does not match this shape, ignore this whole section; do not apply it to general web projects.

- All HTML / CSS / JS is concentrated in a single `.html`, openable directly in a browser, no server required.
- External resources allowed only: Google Fonts, and CDN libraries served from a CDN (pinned versions).
- Section order inside the file: `<style>` -> `<body>` structure -> `<script>`, each section marked with a block comment.
- State is centrally managed in a single `state` object; avoid scattered global variables.
- Use `localStorage` for data persistence; prefix keys with the project name to avoid collisions.
- When export is needed (JSON / Excel / PPTX), make the feature a standalone function; do not mix it with render logic.

---

## 11. Visual Design Conventions (conditional)

> **Applies as the default style only when the project has no existing design system and the UI must be built from scratch.**
> When the project already has design tokens, CSS variables, or a component library, **always follow the existing system** and ignore this section.

- Dark background, high contrast, high information density; avoid large empty areas and rounded cartoonish styles.
- Fonts: `Orbitron` for headings, `DM Mono` for data and code, `Noto Sans TC` as the Chinese fallback.
- Palette: neon accents with cyan (`#00e5ff`) as primary and magenta (`#ff2fd0`) as secondary.
- Always define colors as CSS variables under `:root`; do not hardcode color codes in components.
- Restrained motion: transitions of 150-250ms; no bounce or exaggerated entrance animations.
- Tables, Gantt charts, and dashboards must support large amounts of data; prioritize readability and scroll performance.

---

## 12. Testing and Validation

<!-- TODO: projects without a test framework can simplify this to a manual checklist -->

- New logic needs a minimal verifiable method (unit test or runnable example).
- Boundary conditions must be tested: null, empty array, single element, maximum value, invalid input.
- Pre-delivery checklist:
  - [ ] Starts / opens normally, no console error
  - [ ] Main flow walked through manually once
  - [ ] No leftover `console.log` or test data
  - [ ] No hardcoded secrets
  - [ ] README / comments updated accordingly
