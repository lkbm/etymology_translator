# CLAUDE.md

This is a Preact project in TypeScript, hosted on Cloudflare Workers.

The goal is a simple in browser "text editor" that "syntax highlights" your text based on etymology: words from Greek are one color, Old English another, etc.

Possible future enhancements:
- Support for additional etymological sources

## Core Principles
* Prefer to edit files directly using standard text modifications. Avoid writing custom Python scripts to patch source files. Simple `awk` is acceptable, but direct editing is preferred.
* When writing one-off utility scripts, save them in the `untracked_files/` directory rather than writing them in the command line or in temporary files.
* When finishing a change in a TypeScript application, run the build command to ensure that the code compiles correctly. If the build fails, fix the issues before declaring the task complete.
* Avoid using `/tmp` -- just make a `untracked_files/tmp/` if you need a place for temp files.
* Never kill all wangler or node processes. I have other projects running on the same machine.

## Tech Stack & Tooling
* Use `tsc` for compiling and running TypeScript tasks.
* Use `make` for common commands and tasks.

## Generated data
* `npx tsx scripts/generate-dict.ts` → `src/etymologyDict.ts` (bundled; common words only) and `scripts/.cache/etymology-full.json` (all classified words).
* `npx tsx scripts/generate-synonyms.ts` → `public/synonyms/*.json`, served as static shards for the synonym panel. Needs `etymology-full.json`, so run generate-dict first.
* Source datasets (etymology-db, WordNet, Moby Thesaurus, GloVe) download to `scripts/.cache/` on first run. Thesauri decide what counts as a synonym; GloVe only ranks them (`score()` in generate-synonyms.ts).

## Code Style
* Prefer modern ESNext syntax, strict null checks, and explicit interface definitions. Use `Oxfmt` for formatting.

# Testing
* Run the smallest relevant tests first.
* Before finishing, run formatting, linting, and type checking for modified files.
* If tests aren't run, explicitly state why.

# Git
* Never commit or create branches unless explicitly asked.
* Never amend history unless explicitly asked.

# Do the whole task
Never leave part of an implement "for me". I have a project where I do manual coding, and this is not it. If I ask you to build something, complete the task.
