// Reader activity for the README screenshots, posted through the real API: questions, check
// answers, unit and workbook messages and a finished unit, each answered as a teaching session would.
export async function seed(base) {
  async function post(route, body) {
    const res = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json();
    if (!res.ok) throw new Error(`${route}: ${res.status} ${JSON.stringify(out)}`);
    return out;
  }
  // Claim the single pending event and answer it.
  async function answer(text) {
    const { events } = await post('/api/events/claim', {});
    const pending = events.filter((e) => !e.redelivered);
    if (pending.length !== 1) throw new Error(`expected one new event, got ${JSON.stringify(events)}`);
    await post('/api/reply', { event_id: pending[0].id, text });
  }

  const U1 = '01-snapshots';

  await post('/api/post', { text: "Welcome! Unit 1 is ready: [Commits Are Snapshots](/u/01-snapshots). It's short, with two checks at the end. Ask about anything, here or by selecting a passage." });

  await post('/api/messages', {
    unit: U1,
    anchor: { block: 'c1-p02', quote: 'computed from its contents, a SHA-1 hash', prefix: 'Each object is stored under a name ', suffix: '. The same content always gets' },
    text: 'What happens if two different files end up with the same hash?',
  });
  await answer(`Git would treat them as the same object: whichever was stored first wins, and the second file would silently read back as the first.

  In practice that needs a deliberate attack, not bad luck. Researchers built the first SHA-1 collision in 2017 (two crafted PDFs), and since version 2.13 Git has used a hardened SHA-1 that detects that kind of attack and refuses the object. SHA-256 repositories are the longer-term answer.

  For your own work, you can treat the hash as a unique fingerprint. That's what makes the next section work.`);

  await post('/api/messages', {
    unit: U1,
    anchor: { block: 'c1-p07', quote: 'Git computes them when you ask', prefix: 'So where do diffs come from? ', suffix: '. git show, git diff' },
    text: "Then how does Git know I renamed a file, if it doesn't record changes?",
  });
  await answer(`It guesses, after the fact. When Git compares two snapshots and sees one path disappear and another appear, it checks how similar their contents are. Above a threshold (50% by default) it reports a rename.

  - \`git diff -M80%\` makes the test stricter.
  - \`git log --follow <file>\` uses the same detection to trace a file's history across renames.

  So a rename plus heavy edits in one commit can show up as a delete and an add. Renaming in one commit and editing in the next keeps the history easy to follow.`);

  await post('/api/messages', {
    unit: U1, anchor: { block: 'c1-chk1' }, fields: { confidence: 3 },
    text: "It stores a snapshot: a tree of the whole project plus the parent commit. When you ask for the changes, Git diffs this commit's tree against the parent's tree.",
  });
  await answer("Exactly right, and you brought in the parent, which is the part people usually miss: the diff is always between two snapshots. Marked O1 as secure.");

  await post('/api/messages', {
    unit: U1, anchor: { block: 'c1-chk2' }, fields: { confidence: 2 },
    text: 'A new commit. The blob is reused because the contents are the same.',
  });
  await answer(`Half there. The blob is reused, yes. But the filename isn't in the blob, it's in the tree that lists \`src/\`. So Git writes a new \`src\` tree, a new root tree (its entry for \`src\` now has a different hash), and the commit. Three new objects, one reused.`);

  await post('/api/messages', { unit: U1, text: 'Is there a command that shows the whole snapshot at once, rather than one tree at a time?' });
  await answer('`git ls-tree -r HEAD` lists every blob in the snapshot with its path and hash. Add `-t` to see the trees on the way down too.');

  await post(`/api/units/${U1}/state`, { state: 'done' });
  await answer(`Unit 2 is ready: [Branches Are Just Pointers](/u/02-branches).

  Your answers on snapshots were solid, so it moves quickly. One adjustment: the rename check showed trees are still a little hazy, so unit 2 points out which tree changes each time a branch moves.`);

  await post('/api/messages', { text: "Could the last unit cover undoing a bad rebase? That's what cost me an afternoon last week." });
  await answer("Yes. I've changed the plan so unit 4 opens with exactly that: finding your pre-rebase commit in `git reflog` and resetting to it. Units 2 and 3 set it up.");
}
