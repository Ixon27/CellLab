export type JobKind = 'literature';
export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface JobDto {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  message: string | null;
  error: string | null;
}

export interface Settings {
  engine: 'claude' | 'codex';
  claude: { quickModel: string; heavyModel: string; quickEffort: string; heavyEffort: string };
  codex: { quickModel: string; heavyModel: string; quickEffort: string; heavyEffort: string };
  contactEmail: string;
  onboardingDone: boolean;
}

/** `GET /api/system` */
export interface SystemInfo {
  desktop: boolean;
  filesPath: string;
  dbPath: string;
  home: string;
  dataDir: string;
}
