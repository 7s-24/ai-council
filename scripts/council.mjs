import fs from 'node:fs';
import path from 'node:path';
import { SessionManager } from '@enderfga/claw-orchestrator';
import {
  command,
  compactReview,
  git,
  lastRunPath,
  readJson,
  requireCleanMain,
  root,
  stamp,
  writeJson,
} from './lib.mjs';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const taskArgument = argv.find((value) => !value.startsWith('--'));
const taskPath = path.resolve(root, taskArgument || '.ai-team/TASK.md');
const relativeTaskPath = path.relative(root, taskPath);

if (relativeTaskPath.startsWith('..') || path.isAbsolute(relativeTaskPath)) {
  throw new Error('The task file must be inside this repository.');
}
if (!fs.existsSync(taskPath)) {
  throw new Error(`Task file not found: ${taskPath}`);
}

const task = fs.readFileSync(taskPath, 'utf8').trim();
if (task.length < 80) {
  throw new Error('The task is too short. Add a goal, required work, and acceptance criteria.');
}

const teamPath = path.join(root, '.ai-team', 'team.json');
const team = readJson(teamPath);
if (!Array.isArray(team.agents) || team.agents.length !== 3) {
  throw new Error('team.json must define exactly three agents.');
}
const engines = new Set(team.agents.map((agent) => agent.engine));
for (const expected of ['claude', 'codex', 'agy']) {
  if (!engines.has(expected)) throw new Error(`team.json is missing engine '${expected}'.`);
}

requireCleanMain();

const doctor = command(process.execPath, ['scripts/doctor.mjs']);
process.stdout.write(doctor.stdout || '');
process.stderr.write(doctor.stderr || '');
if (doctor.status !== 0) {
  throw new Error('Host CLI/login preflight failed. Fix `npm run doctor` before starting Council.');
}

console.log(`Workspace: ${root}`);
console.log(`Task: ${relativeTaskPath}`);
console.log(`Agents: ${team.agents.map((agent) => `${agent.name}/${agent.engine}`).join(', ')}`);
console.log(`Limits: ${team.maxRounds} rounds, ${team.maxTurnsPerAgent} turns per agent, $${team.maxBudgetUsd} estimated budget per agent`);

if (dryRun) {
  console.log('Dry run passed. No model was called and no branch was created.');
  process.exit(0);
}

const backupBranch = `safety/before-${stamp()}`;
git(['branch', backupBranch, 'HEAD']);
console.log(`Safety branch: ${backupBranch}`);

const manager = new SessionManager();
let councilId;

async function abort() {
  if (councilId) {
    try {
      manager.councilAbort(councilId);
    } catch {
      // Best-effort interrupt cleanup.
    }
  }
  process.exit(130);
}

process.once('SIGINT', abort);
process.once('SIGTERM', abort);

try {
  const started = await manager.councilStart(task, {
    name: `ai-council-${stamp()}`,
    agents: team.agents,
    maxRounds: team.maxRounds,
    projectDir: root,
    agentTimeoutMs: team.agentTimeoutMs,
    maxTurnsPerAgent: team.maxTurnsPerAgent,
    maxBudgetUsd: team.maxBudgetUsd,
    defaultPermissionMode: 'bypassPermissions',
  });
  councilId = started.id;
  const liveCouncil = manager.getCouncil(councilId);
  writeJson(lastRunPath, {
    id: councilId,
    status: started.status,
    taskFile: relativeTaskPath,
    backupBranch,
    startedAt: started.startTime,
  });
  console.log(`Council: ${councilId}`);

  const deadline = Date.now() + Math.max(600000, team.agentTimeoutMs * team.maxRounds + 60000);
  let current = started;
  while (Date.now() < deadline) {
    current = liveCouncil?.getSession() || manager.councilStatus(councilId);
    if (!current) throw new Error('Council state disappeared.');
    if (current.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (current.status === 'running') {
    manager.councilAbort(councilId);
    throw new Error('Council timed out and was aborted.');
  }

  const review = await manager.councilReview(councilId);
  const completedRounds = current.responses.length
    ? Math.max(...current.responses.map((response) => response.round))
    : 0;
  writeJson(lastRunPath, {
    id: councilId,
    status: current.status,
    taskFile: relativeTaskPath,
    backupBranch,
    startedAt: current.startTime,
    endedAt: current.endTime,
    finalSummary: current.finalSummary,
    review: {
      ...compactReview(review),
      status: current.status,
      rounds: completedRounds,
    },
  });

  console.log(`Council finished with status: ${current.status}`);
  console.log(current.finalSummary || 'No summary was produced.');
  console.log('Run `npm run team:review` before accepting the result.');
  process.exit(current.status === 'error' ? 1 : 0);
} catch (error) {
  writeJson(lastRunPath, {
    id: councilId,
    status: 'error',
    taskFile: relativeTaskPath,
    backupBranch,
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(error);
  process.exit(1);
}
