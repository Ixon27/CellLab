import type { ReactNode } from 'react';

/** Title block every list and reference page opens with. */
export function PageHeader({ eyebrow, title, note, actions }: { eyebrow?: string; title: string; note?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="workbench-head">
      <div className="min-w-0">
        {eyebrow && <p className="workbench-eyebrow mb-1">{eyebrow}</p>}
        <h1>{title}</h1>
        {note && <p className="workbench-head-note">{note}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export type SaveState = 'saved' | 'pending' | 'saving' | 'failed';
const saveLabels: Record<SaveState, string> = { saved: '저장됨', pending: '저장 대기…', saving: '저장 중…', failed: '저장 실패' };

export function SaveStatus({ state }: { state: SaveState }) {
  return (
    <span className="workbench-save" role="status" data-state={state}>
      <i aria-hidden />
      {saveLabels[state]}
    </span>
  );
}

export interface WorkflowStep {
  /** DOM id of the section this step scrolls to. */
  id: string;
  title: string;
  done: boolean;
  /** Live one-line state, e.g. "88/96칸" or "R² 0.9981". */
  summary: string;
}

/** Sticky rail over a multi-step experiment page; the first unfinished step is marked current. */
export function StepRail({ steps, label }: { steps: WorkflowStep[]; label: string }) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <nav className="workbench-steps" aria-label={label}>
      {steps.map((step, i) => (
        <button
          key={step.id}
          className="workbench-step"
          data-state={step.done ? 'done' : i === current ? 'current' : 'todo'}
          aria-current={i === current ? 'step' : undefined}
          onClick={() =>
            document.getElementById(step.id)?.scrollIntoView({
              behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
              block: 'start',
            })
          }
        >
          <span className="workbench-step-n" aria-hidden>
            {i + 1}
          </span>
          <span className="workbench-step-text">
            <b>{step.title}</b>
            <small>{step.summary}</small>
          </span>
        </button>
      ))}
    </nav>
  );
}

/** One numbered section of a workflow page; `id` matches its WorkflowStep. */
export function StepSection({
  id,
  n,
  title,
  hint,
  actions,
  children,
}: {
  id: string;
  n: number;
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="workbench-section workbench-panel" aria-labelledby={`${id}-title`}>
      <header className="workbench-section-head">
        <span className="workbench-section-num" aria-hidden>
          {n}
        </span>
        <h2 id={`${id}-title`}>{title}</h2>
        {hint && <p className="workbench-section-hint">{hint}</p>}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="workbench-section-body">{children}</div>
    </section>
  );
}
