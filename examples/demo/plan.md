# How Git Actually Works — plan

## Aim
Replace a working developer's memorised Git commands with a model of what Git stores and how
the commands change it, so that branches, rebases and "lost" work stop being mysterious and
recovery becomes routine.

## Learning objectives
- O1: Explain what a commit stores, and how Git produces diffs from snapshots.
- O2: Predict which objects Git writes for a given change.
- O3: Explain what a branch and HEAD are, and what "detached HEAD" means.
- O4: Draw the commit graph before and after a merge and a rebase, and argue when each fits.
- O5: Recover commits that seem lost, using the reflog.

## Syllabus
### 01-snapshots — Commits Are Snapshots
Why: everything else is built on the object database; most confusion starts with "commits store diffs". Objectives: O1, O2.
### 02-branches — Branches Are Just Pointers
Why: once commits are understood, branches and HEAD are small, and detached HEAD stops being scary. Objectives: O3. Prerequisites: chapter 1.
### 03-merge-rebase — Merging and Rebasing, Drawn Out
Why: both are ways of combining histories; drawing the graph shows what each rewrites. Teams disagree about which to prefer, so present both positions. Objectives: O4. Prerequisites: chapter 2.
### 04-recovery — Getting Back What You Lost
Why: the learner's motivation. With chapters 1–3 in place, the reflog is a short step. Objectives: O5. Prerequisites: chapters 2 and 3.

## Amendments
- 2026-11-15: Chapter 4 will open with undoing a botched rebase (`git reflog` plus `git reset --hard`), at the reader's request; that's what cost them work last week.
