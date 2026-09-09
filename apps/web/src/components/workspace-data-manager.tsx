"use client";

import { FloppyDisk, PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  WorkspaceExperimentInput,
  WorkspaceRecord,
  WorkspaceRecordKind,
  WorkspaceRunInput,
  WorkspaceTaskInput,
} from "../lib/workspace-schema";

const labels: Record<WorkspaceRecordKind, string> = {
  task: "Tasks",
  experiment: "Experiments",
  run: "Runs",
};

type EditorForm = Record<string, string>;
type Editing = { kind: WorkspaceRecordKind; id: string } | null;

const emptyForms: Record<WorkspaceRecordKind, EditorForm> = {
  task: {
    id: "",
    repository: "",
    commit: "",
    issue: "",
    setup: "",
    evaluation: "",
    tags: "",
  },
  experiment: {
    id: "",
    name: "",
    description: "",
    taskId: "",
    sourceCommit: "",
    variedVariable: "",
    status: "draft",
  },
  run: {
    id: "",
    experimentId: "",
    taskId: "",
    configurationId: "",
    provider: "",
    model: "",
    status: "planned",
    notes: "",
  },
};

export function WorkspaceDataManager() {
  const [records, setRecords] = useState<WorkspaceRecord[]>([]);
  const [kind, setKind] = useState<WorkspaceRecordKind>("experiment");
  const [form, setForm] = useState<EditorForm>(emptyForms.experiment);
  const [editing, setEditing] = useState<Editing>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace", { credentials: "same-origin" });
      const payload = (await response.json().catch(() => null)) as {
        records?: WorkspaceRecord[];
        error?: string;
      } | null;
      if (!response.ok) {
        setError(payload?.error ?? "Workspace records could not be loaded.");
        return;
      }
      setRecords(payload?.records ?? []);
    } catch {
      setError("Workspace records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void loadRecords(), 0);
    return () => window.clearTimeout(loadTimer);
  }, [loadRecords]);

  function startNew(nextKind = kind) {
    setKind(nextKind);
    setEditing(null);
    setForm({ ...emptyForms[nextKind] });
    setMessage(null);
    setError(null);
  }

  function editRecord(record: WorkspaceRecord) {
    setKind(record.kind);
    setEditing({ kind: record.kind, id: record.payload.id });
    setForm(toForm(record));
    setMessage(null);
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const payload = toPayload(kind, form);
      const response = await fetch(
        editing ? `/api/workspace/${encodeURIComponent(editing.id)}` : "/api/workspace",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ kind, payload }),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        record?: WorkspaceRecord;
        error?: string;
      } | null;
      if (!response.ok || !result?.record) {
        setError(result?.error ?? "Workspace record could not be saved.");
        return;
      }
      setRecords((current) => {
        const next = current.filter(
          (record) =>
            !(
              record.kind === result.record?.kind && record.payload.id === result.record?.payload.id
            ),
        );
        return [result.record as WorkspaceRecord, ...next];
      });
      setEditing({ kind, id: result.record.payload.id });
      setForm(toForm(result.record));
      setMessage(editing ? "Record updated." : "Record created.");
    } catch {
      setError("Workspace service could not be reached.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(record: WorkspaceRecord) {
    if (!window.confirm(`Delete the ${record.kind} record “${record.payload.id}”?`)) return;
    setMessage(null);
    setError(null);
    const response = await fetch(
      `/api/workspace/${encodeURIComponent(record.payload.id)}?kind=${record.kind}`,
      { method: "DELETE", credentials: "same-origin" },
    ).catch(() => null);
    if (!response) {
      setError("Workspace service could not be reached.");
      return;
    }
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(payload?.error ?? "Workspace record could not be deleted.");
      return;
    }
    setRecords((current) => current.filter((candidate) => candidate !== record));
    const activeEditing = editing;
    if (
      activeEditing &&
      activeEditing.kind === record.kind &&
      activeEditing.id === record.payload.id
    ) {
      startNew(kind);
    }
    setMessage("Record deleted.");
  }

  return (
    <section className="workspace-manager" aria-labelledby="workspace-data-title">
      <div className="section-heading workspace-manager-heading">
        <div>
          <span className="section-label">Workspace data</span>
          <h2 id="workspace-data-title">Manage records</h2>
        </div>
        <button
          className="ui-button ui-button-secondary ui-button-sm"
          type="button"
          onClick={() => startNew()}
        >
          <Plus size={14} weight="bold" aria-hidden /> New record
        </button>
      </div>
      <p className="data-copy">
        These records are private to this workspace. They describe experiments, task contracts, and
        planned or manually recorded runs; agent execution still stays in the local CLI.
      </p>
      {message ? (
        <p className="form-success" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="workspace-manager-grid">
        <div className="workspace-record-list" aria-label="Workspace records">
          <div className="workspace-kind-tabs" role="tablist" aria-label="Record type">
            {(Object.keys(labels) as WorkspaceRecordKind[]).map((candidate) => (
              <button
                key={candidate}
                className={
                  candidate === kind ? "workspace-kind-tab is-active" : "workspace-kind-tab"
                }
                type="button"
                role="tab"
                aria-selected={candidate === kind}
                onClick={() => startNew(candidate)}
              >
                {labels[candidate]}
                <span>{records.filter((record) => record.kind === candidate).length}</span>
              </button>
            ))}
          </div>
          {loading ? <p className="panel-footnote">Loading workspace records…</p> : null}
          {!loading && records.filter((record) => record.kind === kind).length === 0 ? (
            <p className="panel-footnote">
              No {labels[kind].toLowerCase()} yet. Create the first one here.
            </p>
          ) : null}
          <ul className="workspace-record-items">
            {records
              .filter((record) => record.kind === kind)
              .map((record) => (
                <li key={`${record.kind}:${record.payload.id}`}>
                  <button
                    className={
                      editing !== null &&
                      editing.kind === record.kind &&
                      editing.id === record.payload.id
                        ? "workspace-record-item is-active"
                        : "workspace-record-item"
                    }
                    type="button"
                    onClick={() => editRecord(record)}
                  >
                    <span>
                      <strong>{recordTitle(record)}</strong>
                      <small>{record.payload.id}</small>
                    </span>
                    <PencilSimple size={14} weight="bold" aria-hidden />
                  </button>
                </li>
              ))}
          </ul>
        </div>

        <form className="workspace-editor" onSubmit={save}>
          <div className="workspace-editor-heading">
            <div>
              <span className="section-label">{editing ? "Edit record" : "New record"}</span>
              <h3>{labels[kind].replace(/s$/u, "")} details</h3>
            </div>
            {editing ? (
              <button
                className="icon-button"
                type="button"
                onClick={() => startNew()}
                aria-label="Close editor"
              >
                <X size={16} weight="bold" aria-hidden />
              </button>
            ) : null}
          </div>
          <WorkspaceFields kind={kind} form={form} setForm={setForm} idLocked={editing !== null} />
          <div className="workspace-editor-actions">
            <button className="ui-button ui-button-primary" type="submit" disabled={saving}>
              <FloppyDisk size={15} weight="bold" aria-hidden />{" "}
              {saving ? "Saving…" : editing ? "Save changes" : "Create record"}
            </button>
            {editing ? (
              <button
                className="ui-button ui-button-danger"
                type="button"
                onClick={() => {
                  const activeEditing = editing;
                  if (!activeEditing) return;
                  const record = records.find(
                    (candidate) =>
                      candidate.kind === activeEditing.kind &&
                      candidate.payload.id === activeEditing.id,
                  );
                  if (record) void remove(record);
                }}
              >
                <Trash size={15} weight="bold" aria-hidden /> Delete
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  );
}

function WorkspaceFields({
  kind,
  form,
  setForm,
  idLocked,
}: {
  kind: WorkspaceRecordKind;
  form: EditorForm;
  setForm: (next: EditorForm) => void;
  idLocked: boolean;
}) {
  const field = (name: string) => (value: string) => setForm({ ...form, [name]: value });
  return (
    <div className="workspace-fields">
      <label>
        Record ID
        <input
          value={form.id ?? ""}
          onChange={(event) => field("id")(event.target.value)}
          required
          disabled={idLocked}
        />
      </label>
      {kind === "task" ? (
        <>
          <label>
            Repository
            <input
              value={form.repository ?? ""}
              onChange={(event) => field("repository")(event.target.value)}
              required
            />
          </label>
          <label>
            Commit
            <input
              value={form.commit ?? ""}
              onChange={(event) => field("commit")(event.target.value)}
              required
            />
          </label>
          <label className="workspace-field-wide">
            Issue / requested change
            <textarea
              value={form.issue ?? ""}
              onChange={(event) => field("issue")(event.target.value)}
              required
              rows={4}
            />
          </label>
          <label className="workspace-field-wide">
            Setup
            <textarea
              value={form.setup ?? ""}
              onChange={(event) => field("setup")(event.target.value)}
              required
              rows={3}
            />
          </label>
          <label className="workspace-field-wide">
            Evaluation
            <textarea
              value={form.evaluation ?? ""}
              onChange={(event) => field("evaluation")(event.target.value)}
              required
              rows={3}
            />
          </label>
          <label>
            Tags<span className="field-hint">Comma-separated</span>
            <input
              value={form.tags ?? ""}
              onChange={(event) => field("tags")(event.target.value)}
            />
          </label>
        </>
      ) : null}
      {kind === "experiment" ? (
        <>
          <label>
            Name
            <input
              value={form.name ?? ""}
              onChange={(event) => field("name")(event.target.value)}
              required
            />
          </label>
          <label>
            Status
            <select
              value={form.status ?? "draft"}
              onChange={(event) => field("status")(event.target.value)}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label className="workspace-field-wide">
            Description
            <textarea
              value={form.description ?? ""}
              onChange={(event) => field("description")(event.target.value)}
              required
              minLength={16}
              rows={4}
            />
          </label>
          <label>
            Task ID<span className="field-hint">Optional link</span>
            <input
              value={form.taskId ?? ""}
              onChange={(event) => field("taskId")(event.target.value)}
            />
          </label>
          <label>
            Source commit
            <input
              value={form.sourceCommit ?? ""}
              onChange={(event) => field("sourceCommit")(event.target.value)}
            />
          </label>
          <label>
            Varied variable
            <input
              value={form.variedVariable ?? ""}
              onChange={(event) => field("variedVariable")(event.target.value)}
            />
          </label>
        </>
      ) : null}
      {kind === "run" ? (
        <>
          <label>
            Experiment ID
            <input
              value={form.experimentId ?? ""}
              onChange={(event) => field("experimentId")(event.target.value)}
              required
            />
          </label>
          <label>
            Task ID
            <input
              value={form.taskId ?? ""}
              onChange={(event) => field("taskId")(event.target.value)}
              required
            />
          </label>
          <label>
            Configuration ID
            <input
              value={form.configurationId ?? ""}
              onChange={(event) => field("configurationId")(event.target.value)}
              required
            />
          </label>
          <label>
            Status
            <select
              value={form.status ?? "planned"}
              onChange={(event) => field("status")(event.target.value)}
            >
              <option value="planned">Planned</option>
              <option value="running">Running</option>
              <option value="resolved">Resolved</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label>
            Provider
            <input
              value={form.provider ?? ""}
              onChange={(event) => field("provider")(event.target.value)}
              required
            />
          </label>
          <label>
            Model
            <input
              value={form.model ?? ""}
              onChange={(event) => field("model")(event.target.value)}
              required
            />
          </label>
          <label className="workspace-field-wide">
            Notes
            <textarea
              value={form.notes ?? ""}
              onChange={(event) => field("notes")(event.target.value)}
              rows={4}
            />
          </label>
        </>
      ) : null}
    </div>
  );
}

function toForm(record: WorkspaceRecord): EditorForm {
  if (record.kind === "task") {
    return { ...record.payload, tags: record.payload.tags.join(", ") };
  }
  return Object.fromEntries(
    Object.entries(record.payload).map(([key, value]) => [
      key,
      value === null ? "" : String(value),
    ]),
  );
}

function toPayload(
  kind: WorkspaceRecordKind,
  form: EditorForm,
): WorkspaceTaskInput | WorkspaceExperimentInput | WorkspaceRunInput {
  if (kind === "task") {
    return {
      id: form.id,
      repository: form.repository,
      commit: form.commit,
      issue: form.issue,
      setup: form.setup,
      evaluation: form.evaluation,
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
  }
  if (kind === "experiment") {
    return {
      id: form.id,
      name: form.name,
      description: form.description,
      taskId: form.taskId || null,
      sourceCommit: form.sourceCommit || null,
      variedVariable: form.variedVariable || null,
      status: form.status as WorkspaceExperimentInput["status"],
    };
  }
  return {
    id: form.id,
    experimentId: form.experimentId,
    taskId: form.taskId,
    configurationId: form.configurationId,
    provider: form.provider,
    model: form.model,
    status: form.status as WorkspaceRunInput["status"],
    notes: form.notes,
  };
}

function recordTitle(record: WorkspaceRecord): string {
  if (record.kind === "task") return record.payload.issue.slice(0, 56);
  if (record.kind === "experiment") return record.payload.name;
  return record.payload.configurationId;
}
