import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface Experience {
  id: string;
  company?: string;
  title?: string;
  period?: string;
  situation?: string;
  task?: string;
  actions: string[];
  results: string[];
  skills: string[];
}

export interface Project {
  id: string;
  name?: string;
  role?: string;
  situation?: string;
  actions: string[];
  results: string[];
  skills: string[];
}

export interface Education {
  school: string;
  degree?: string;
  period?: string;
}

export interface Profile {
  version: '1.0';
  updatedAt: string;
  targetRole?: string;
  summary?: string;
  experiences: Experience[];
  projects: Project[];
  education: Education[];
  skills: string[];
}

export function defaultProfile(): Profile {
  return {
    version: '1.0',
    updatedAt: new Date().toISOString(),
    experiences: [],
    projects: [],
    education: [],
    skills: [],
  };
}

export function getProfilePath(): string {
  const config = vscode.workspace.getConfiguration('resumeCopilot');
  const configured = config.get<string>('profilePath') || '.resume-copilot/profile.json';

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('Resume Copilot: No workspace folder is open. Please open a folder first.');
  }

  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.join(workspaceFolders[0].uri.fsPath, configured);
}

export async function loadProfile(profilePath?: string): Promise<Profile | undefined> {
  const filePath = profilePath || getProfilePath();
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Profile;
    return parsed;
  } catch (err) {
    console.error('[Resume Copilot] Failed to load profile:', err);
    return undefined;
  }
}

export async function saveProfile(profile: Profile, profilePath?: string): Promise<void> {
  const filePath = profilePath || getProfilePath();
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const toSave: Profile = {
    ...profile,
    updatedAt: new Date().toISOString(),
  };
  await fs.promises.writeFile(filePath, JSON.stringify(toSave, null, 2), 'utf-8');
}

export function buildProfileContext(profile?: Profile): string {
  if (!profile) {
    return '';
  }

  const lines: string[] = [];
  lines.push('=== Candidate Profile ===');

  if (profile.targetRole) {
    lines.push(`Target role: ${profile.targetRole}`);
  }
  if (profile.summary) {
    lines.push(`Summary: ${profile.summary}`);
  }

  if (profile.experiences.length > 0) {
    lines.push('\nWork Experience:');
    for (const exp of profile.experiences) {
      lines.push(`- ${exp.title || 'Role'} @ ${exp.company || 'Company'} (${exp.period || 'time unspecified'})`);
      if (exp.situation) lines.push(`  Situation: ${exp.situation}`);
      if (exp.task) lines.push(`  Task: ${exp.task}`);
      if (exp.actions.length) lines.push(`  Actions: ${exp.actions.join('; ')}`);
      if (exp.results.length) lines.push(`  Results: ${exp.results.join('; ')}`);
      if (exp.skills.length) lines.push(`  Skills: ${exp.skills.join(', ')}`);
    }
  }

  if (profile.projects.length > 0) {
    lines.push('\nProjects:');
    for (const proj of profile.projects) {
      lines.push(`- ${proj.name || 'Project'} (${proj.role || 'role unspecified'})`);
      if (proj.situation) lines.push(`  Situation: ${proj.situation}`);
      if (proj.actions.length) lines.push(`  Actions: ${proj.actions.join('; ')}`);
      if (proj.results.length) lines.push(`  Results: ${proj.results.join('; ')}`);
      if (proj.skills.length) lines.push(`  Skills: ${proj.skills.join(', ')}`);
    }
  }

  if (profile.education.length > 0) {
    lines.push('\nEducation:');
    for (const edu of profile.education) {
      lines.push(`- ${edu.school}${edu.degree ? `, ${edu.degree}` : ''}${edu.period ? ` (${edu.period})` : ''}`);
    }
  }

  if (profile.skills.length > 0) {
    lines.push(`\nSkills: ${profile.skills.join(', ')}`);
  }

  lines.push('=== End Profile ===\n');
  return lines.join('\n');
}
