import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const environments = [
  { key: 'swift', label: 'Swift / Apple', markers: ['Package.swift'], suffixes: ['.xcodeproj', '.xcworkspace'] },
  { key: 'node', label: 'Node.js', markers: ['package.json'] },
  { key: 'python', label: 'Python', markers: ['pyproject.toml', 'requirements.txt', 'setup.py'] },
  { key: 'rust', label: 'Rust', markers: ['Cargo.toml'] },
  { key: 'go', label: 'Go', markers: ['go.mod'] },
  { key: 'java', label: 'JVM', markers: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
];

function containsMarker(directory, environment) {
  if (environment.markers?.some((marker) => fs.existsSync(path.join(directory, marker)))) return true;
  if (!environment.suffixes?.length) return false;
  try {
    return fs.readdirSync(directory).some((entry) => environment.suffixes.some((suffix) => entry.endsWith(suffix)));
  } catch {
    return false;
  }
}

export function detectProjectEnvironment(directory) {
  const matches = environments.filter((environment) => containsMarker(directory, environment));
  if (!matches.length) return { key: 'other', label: '其他' };
  if (matches.length === 1) return { key: matches[0].key, label: matches[0].label };
  return { key: 'mixed', label: '混合环境' };
}

export function projectId(directory) {
  return crypto.createHash('sha256').update(path.resolve(directory)).digest('hex').slice(0, 16);
}

export function discoverProjects(projectsRoot, currentWorkspace, additionalProjects = []) {
  const catalogRoot = fs.realpathSync(projectsRoot);
  const current = fs.realpathSync(currentWorkspace);
  const candidates = [];

  const addCandidate = (value) => {
    try {
      const resolved = fs.realpathSync(value);
      if (fs.statSync(resolved).isDirectory()) candidates.push(resolved);
    } catch {
      // Ignore stale bookmarks and unavailable removable volumes.
    }
  };

  for (const entry of fs.readdirSync(catalogRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const directory = path.join(catalogRoot, entry.name);
    const resolved = fs.realpathSync(directory);
    if (resolved !== catalogRoot && !resolved.startsWith(`${catalogRoot}${path.sep}`)) continue;
    addCandidate(resolved);
  }
  additionalProjects.forEach(addCandidate);
  addCandidate(current);

  return [...new Set(candidates)].map((directory) => {
    const environment = detectProjectEnvironment(directory);
    return {
      id: projectId(directory),
      name: path.basename(directory),
      path: directory,
      environment: environment.key,
      environmentLabel: environment.label,
      git: fs.existsSync(path.join(directory, '.git')),
    };
  }).sort((left, right) => (
    left.environmentLabel.localeCompare(right.environmentLabel, 'zh-CN')
      || left.name.localeCompare(right.name, 'zh-CN')
  ));
}

export function publicProject(project) {
  return {
    id: project.id,
    name: project.name,
    environment: project.environment,
    environmentLabel: project.environmentLabel,
    git: project.git,
  };
}
