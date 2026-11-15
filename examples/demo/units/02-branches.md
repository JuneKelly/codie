# Branches Are Just Pointers {#c2-h1}

Unit 1 left you with a pile of snapshots, each commit naming its parent. That chain of parents is the whole history. So what's a branch? Much less than you might expect, and that's good news, because it means branches are cheap to make and almost impossible to break. {#c2-p01}

## A branch is a file with a hash in it {#c2-h2}

Look in `.git/refs/heads/` and you'll find one small file per local branch. Each holds a single commit hash. That's a branch: a name for a commit. {#c2-p02}

```console {#c2-x01}
$ cat .git/refs/heads/main
3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39
```

:::gloss {#c2-g01 for=c2-x01}
After `git gc`, some branches live in `.git/packed-refs` instead of separate files. `git rev-parse main` gives the answer wherever it's stored.
:::

When you commit, Git writes the new commit with the current branch's commit as its parent, then moves the branch to the new commit. Nothing else changes. Creating a branch writes one small file; deleting a branch removes that file and leaves every commit exactly where it was. {#c2-p03}

## HEAD: where you are {#c2-h3}

How does Git know which branch to move? `.git/HEAD` records it. Normally HEAD names a branch rather than a commit: {#c2-p04}

```console {#c2-x02}
$ cat .git/HEAD
ref: refs/heads/main
```

`git switch feature` rewrites that line to `ref: refs/heads/feature` and updates your working files to match that branch's snapshot. {#c2-p05}

:::check {#c2-chk1 objective=O3}
You run `git branch experiment` and then commit twice without switching. Which branch moves, which stays put, and why?
:::

## Detached HEAD {#c2-h4}

If you check out a commit directly, with `git checkout 3f2a9c1` or a tag, HEAD holds that commit's hash instead of a branch name. That's all "detached HEAD" means. You can look around and even commit, but each new commit moves only HEAD. No branch follows along, so once you switch away, nothing names those commits any more. {#c2-p06}

The commits aren't deleted, and unit 4 shows how to find them again. The easy fix is to name them before you leave: `git switch -c <new-branch>` creates a branch at HEAD and attaches HEAD to it. {#c2-p07}

:::check {#c2-chk2 objective=O3}
You're in detached HEAD and have made two commits. Using what a branch actually is, explain why switching back to `main` makes those commits seem to vanish, and what one command would have kept them easy to reach.
:::
