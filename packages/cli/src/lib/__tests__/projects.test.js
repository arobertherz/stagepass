import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  upsertProject,
  getProject,
  ensureMigratedProject,
  loadProjects,
} from '../projects.js';

describe('projects', () => {
  let tmpDir;
  let projectsPath;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stagepass-proj-'));
    projectsPath = path.join(tmpDir, 'projects.json');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('defaults new projects to allowAllOrigins=false and keeps flags undefined as keep', async () => {
    const created = await upsertProject(
      'app.sp',
      { root: '/Users/dev/Sites/app', isNew: true },
      projectsPath
    );
    expect(created.allowAllOrigins).toBe(false);
    expect(created.origins).toEqual([]);

    await upsertProject(
      'app.sp',
      {
        root: '/Users/dev/Sites/app',
        originsFromFlags: ['example.com'],
        allowAllOriginsFlag: undefined,
      },
      projectsPath
    );
    const kept = await getProject('app.sp', projectsPath);
    expect(kept.allowAllOrigins).toBe(false);
    expect(kept.origins).toEqual(['example.com']);
  });

  it('merges --origin and removes with --remove-origin', async () => {
    await upsertProject(
      'app.sp',
      {
        root: '/Users/dev/Sites/app',
        originsFromFlags: ['a.example.com', 'b.example.com', '*.c.example.com'],
      },
      projectsPath
    );

    const afterRemove = await upsertProject(
      'app.sp',
      {
        root: '/Users/dev/Sites/app',
        originsToRemove: ['b.example.com', '*.c.example.com'],
      },
      projectsPath
    );
    expect(afterRemove.origins).toEqual(['a.example.com']);

    const afterAdd = await upsertProject(
      'app.sp',
      {
        root: '/Users/dev/Sites/app',
        originsFromFlags: ['b.example.com'],
        originsToRemove: ['a.example.com'],
      },
      projectsPath
    );
    expect(afterAdd.origins).toEqual(['b.example.com']);
  });

  it('rejects invalid --remove-origin values', async () => {
    await expect(
      upsertProject(
        'app.sp',
        {
          root: '/Users/dev/Sites/app',
          originsToRemove: ['http://attacker.example'],
        },
        projectsPath
      )
    ).rejects.toThrow();
  });

  it('seeds from Caddyfile marker options when no projects.json entry exists', async () => {
    const seeded = await upsertProject(
      'app.sp',
      {
        root: '/Users/dev/Sites/app',
        seed: {
          origins: ['live.example.com'],
          allowAllOrigins: true,
        },
        allowAllOriginsFlag: undefined,
        isNew: false,
      },
      projectsPath
    );
    expect(seeded.allowAllOrigins).toBe(true);
    expect(seeded.origins).toEqual(['live.example.com']);
  });

  it('ensureMigratedProject creates allowAllOrigins=true and never drops existing origins', async () => {
    const created = await ensureMigratedProject(
      'legacy.sp',
      '/Users/dev/Sites/legacy',
      projectsPath
    );
    expect(created.allowAllOrigins).toBe(true);
    expect(created.origins).toEqual([]);

    await upsertProject(
      'legacy.sp',
      {
        root: '/Users/dev/Sites/legacy',
        originsFromFlags: ['example.com'],
        allowAllOriginsFlag: false,
      },
      projectsPath
    );

    const again = await ensureMigratedProject(
      'legacy.sp',
      '/Users/dev/Sites/other',
      projectsPath
    );
    expect(again.allowAllOrigins).toBe(false);
    expect(again.origins).toEqual(['example.com']);
    expect(again.root).toBe('/Users/dev/Sites/legacy');

    const doc = await loadProjects(projectsPath);
    expect(doc.projects['legacy.sp'].origins).toEqual(['example.com']);
  });
});
