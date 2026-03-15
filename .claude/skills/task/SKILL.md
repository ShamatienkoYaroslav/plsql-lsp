---
name: task
description: Work on a task or section from TODO.todo. Implements the feature, updates TODO.todo and README.md.
argument-hint: [task-or-section-number]
disable-model-invocation: true
---

You are working on the PL/SQL Language Server project. Your job is to implement tasks from `TODO.todo`.

## Input

The user provided: `$ARGUMENTS`

## Step 1: Identify the task(s)

Read `TODO.todo` from the project root.

- If `$ARGUMENTS` is a **task number** (e.g. `2.40`, `3.8`, `5.1`): find that specific task line.
- If `$ARGUMENTS` is a **section number** (e.g. `2`, `4`, `6`): find ALL incomplete (`[ ]`) tasks in that section and work through them sequentially.
- If `$ARGUMENTS` is **empty or not provided**: scan the file top-to-bottom and pick the **first incomplete (`[ ]`) task**.

If the task is already marked `[x]`, tell the user and stop.

## Step 2: Understand the codebase context

Before writing any code:

1. Read `LSP.md` for the full design plan and architecture context.
2. Read `CLAUDE.md` for project conventions.
3. Read `src/server.ts` to understand the LSP server wiring.
4. Read the existing source files relevant to the task (use Glob and Grep to find them).
5. Read existing tests in `tests/` to understand the testing patterns and conventions used.
6. Study similar already-implemented features in the codebase to match the style and patterns.

## Step 3: Implement

Write the code to implement the task. Follow these rules:

- **Match existing code style** — follow the patterns, naming conventions, and structure already in the codebase.
- **Edit existing files** when possible — only create new files if the task genuinely requires it.
- **Wire up to the LSP server** — if the task adds a new LSP capability, register it in `src/server.ts` (add the capability in `onInitialize` and add the request handler).
- **Add tests** — write tests for the new functionality using the same test framework and patterns as the existing tests in `tests/`.
- **Keep it focused** — implement exactly what the task describes, nothing more.
- **No over-engineering** — simple, direct implementations. No unnecessary abstractions.
- **Run tests and type-check after implementation**:
  - Run `npx tsc --noEmit` to verify no type errors.
  - Run `npx vitest run` to verify all tests pass (existing and new).
  - Fix any failures before proceeding.

## Step 4: Update TODO.todo

After successful implementation:

1. Read `TODO.todo` again (it may have changed).
2. Change the completed task(s) from `[ ]` to `[x]`.
3. Use the Edit tool for precise replacements.

## Step 5: Update README.md if needed

Read `README.md`. If the implemented task adds a **user-visible feature or capability** (new LSP capability, new configuration option, new supported syntax), update the README to mention it. Do NOT update for internal changes like refactors or test additions.

## Step 6: Verify and summarize

Run the full test suite one final time: `npx vitest run`

Then provide a summary:
- What task(s) were completed (by number and description)
- What files were created or modified
- What tests were added
- Any follow-up tasks or notes
