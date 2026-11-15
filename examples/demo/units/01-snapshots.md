# Commits Are Snapshots {#c1-h1}

You use Git every working day: `add`, `commit`, `push`, `pull`, and the occasional rescue command pasted from a search result. This workbook is about what sits underneath those commands. Once you can picture it, most of Git's strange behaviour stops being strange, and the rebase that ate your afternoon becomes something you can undo in a minute. {#c1-p01}

## Git is a database of objects {#c1-h2}

Every repository has a `.git` folder, and inside it is `.git/objects`: a small database holding everything Git has ever recorded. Each object is stored under a name computed from its contents, a SHA-1 hash. The same content always gets the same name, and changing a single byte gives a completely different one. {#c1-p02}

:::gloss {#c1-g01 for=c1-p02}
Git can also use SHA-256 (`git init --object-format=sha256`), but SHA-1 is still the default and by far the most common.
:::

Three kinds of object do almost all the work: {#c1-p03}

| Object | What it holds |
|---|---|
| **blob** | The contents of one file. No filename, no permissions: just the bytes. |
| **tree** | A directory listing: each entry's name and mode, and the hash of the blob or tree it points to. |
| **commit** | One tree (the whole project at that moment), the parent commit or commits, author, committer and message. | {#c1-t01}

## A commit, opened up {#c1-h3}

`git cat-file -p` prints any object. Try it on your latest commit: {#c1-p04}

```console {#c1-x01}
$ git cat-file -p HEAD
tree 8d3c1f0b2a6e4d9f7c5b3a1e0d8c6b4a2f0e9d7c
parent 5e1a9b7c3d2f8e6a4b0c9d1e7f3a5b2c8d6e4f10
author Sam Rivera <sam@example.com> 1731672000 +0000
committer Sam Rivera <sam@example.com> 1731672000 +0000

Add retries to the upload client
```

There's no diff in there. The commit names a tree, and that tree describes every file in the project as it stood when you committed. Run `git cat-file -p` on the tree's hash and you'll see the top-level directory; follow any entry and you reach a blob or another tree. {#c1-p05}

## Snapshots that don't waste space {#c1-h4}

If every commit is a full snapshot, why doesn't a repository balloon? Because objects are named by their contents. When you change one file and commit, Git writes a new blob for that file, new trees for each directory on the path to it, and a new commit. Every other file has the same content as before, so its tree entry points at a blob that already exists. Unchanged files cost nothing. {#c1-p06}

:::gloss {#c1-g02 for=c1-p06}
Git compresses further: `git gc` gathers objects into packfiles and stores similar objects as deltas against each other. That's a storage detail. The model you work with is still whole snapshots.
:::

So where do diffs come from? Git computes them when you ask. `git show`, `git diff` and `git log -p` compare two snapshots and work out the difference on the spot. {#c1-p07}

:::check {#c1-chk1 objective=O1}
A teammate says "a Git commit stores the changes you made". Explain what a commit actually stores, and why Git can still show you those changes.
:::

:::check {#c1-chk2 objective=O2}
You rename `src/util.js` to `src/helpers.js` without editing it, and commit. Which new objects does Git write, and which existing ones does it reuse?
:::
