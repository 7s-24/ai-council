import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { detectProjectEnvironment, discoverProjects } from './project-catalog.mjs';

test('project environments are detected from root markers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-projects-'));
  try {
    const nodeProject = path.join(root, 'web-client');
    const pythonProject = path.join(root, 'data-pipeline');
    const mixedProject = path.join(root, 'full-stack');
    fs.mkdirSync(nodeProject);
    fs.mkdirSync(pythonProject);
    fs.mkdirSync(mixedProject);
    fs.writeFileSync(path.join(nodeProject, 'package.json'), '{}');
    fs.writeFileSync(path.join(pythonProject, 'pyproject.toml'), '');
    fs.writeFileSync(path.join(mixedProject, 'package.json'), '{}');
    fs.writeFileSync(path.join(mixedProject, 'pyproject.toml'), '');

    assert.equal(detectProjectEnvironment(nodeProject).key, 'node');
    assert.equal(detectProjectEnvironment(pythonProject).key, 'python');
    assert.equal(detectProjectEnvironment(mixedProject).key, 'mixed');
    const projects = discoverProjects(root, nodeProject);
    assert.deepEqual(projects.map((project) => project.name).sort(), ['data-pipeline', 'full-stack', 'web-client']);
    assert.ok(projects.every((project) => !project.path.endsWith('/')));
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-external-'));
    try {
      fs.writeFileSync(path.join(externalRoot, 'Cargo.toml'), '');
      const expanded = discoverProjects(root, nodeProject, [externalRoot, '/missing/project']);
      assert.ok(expanded.some((project) => project.path === fs.realpathSync(externalRoot) && project.environment === 'rust'));
    } finally {
      fs.rmSync(externalRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
