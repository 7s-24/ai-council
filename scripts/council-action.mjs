import fs from 'node:fs';
import path from 'node:path';
import { SessionManager } from '@enderfga/claw-orchestrator';
import { compactReview, git, loadLastRun, root, stamp, writeJson, lastRunPath } from './lib.mjs';

const action = process.argv[2] || 'status';
const last = loadLastRun();

if (action === 'status') {
  console.log(JSON.stringify(last, null, 2));
  process.exit(0);
}

const manager = new SessionManager();

try {
  if (action === 'review') {
    const review = await manager.councilReview(last.id);
    console.log(JSON.stringify(compactReview(review), null, 2));
    process.exit(0);
  }

  if (action === 'accept') {
    const review = await manager.councilReview(last.id);
    const historyDir = path.join(root, '.ai-team', 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    const historyPath = path.join(historyDir, `${stamp()}-${last.id}.md`);
    const plan = review.planContent ? `\n## Council plan\n\n${review.planContent}\n` : '';
    fs.writeFileSync(
      historyPath,
      `# Council Run ${last.id}\n\n- Status: ${review.status}\n- Rounds: ${review.rounds}\n- Safety branch: \`${last.backupBranch}\`\n\n## Final summary\n\n${last.finalSummary || 'No summary was recorded.'}\n${plan}`,
    );
    const result = await manager.councilAccept(last.id);

    git(['add', '--', path.relative(root, historyPath)]);
    const trackedPlan = git(['ls-files', '--', 'plan.md']);
    if (trackedPlan) git(['add', '-u', '--', 'plan.md']);
    const trackedReviews = git(['ls-files', '--', 'reviews']);
    if (trackedReviews) git(['add', '-u', '--', 'reviews']);
    const staged = git(['diff', '--cached', '--name-only']);
    if (staged) {
      git(['commit', '-m', `chore(ai-team): archive council ${last.id}`]);
    }

    const updated = { ...last, status: 'accepted', acceptedAt: new Date().toISOString(), cleanup: result };
    writeJson(lastRunPath, updated);
    console.log(JSON.stringify(result, null, 2));
    console.log(`Archived: ${path.relative(root, historyPath)}`);
    process.exit(0);
  }

  if (action === 'reject') {
    const feedback = process.argv.slice(3).join(' ').trim();
    if (!feedback) throw new Error('Provide rejection feedback after `--`.');
    const result = await manager.councilReject(last.id, feedback);
    writeJson(lastRunPath, {
      ...last,
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      feedback,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  throw new Error(`Unknown action '${action}'. Use status, review, accept, or reject.`);
} catch (error) {
  console.error(error);
  process.exit(1);
}

