import type { Task } from "@morphscope/schemas";
import type { BaselineToolbox, CommandExecution } from "@morphscope/agent-core";

export interface EvaluationResult {
  passed: boolean;
  score: number;
  terminalState: "resolved" | "task_failed" | "timeout" | "environment_error";
  command: CommandExecution;
  diff: string;
  changedFiles: string[];
}

export interface EvaluatorOptions {
  task: Task;
  toolbox: BaselineToolbox;
  timeoutMs?: number;
  changedFiles?: string[];
}

export function evaluateTask(options: EvaluatorOptions): EvaluationResult {
  let command: CommandExecution;
  try {
    command = options.toolbox.runCommand(options.task.evaluation, {
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    command = {
      command: options.task.evaluation,
      cwd: ".",
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: message,
      durationMs: 0,
      timedOut: false,
      truncated: false,
    };
  }

  const diff = options.toolbox.gitDiff();
  const passed = command.exitCode === 0 && !command.timedOut;
  return {
    passed,
    score: passed ? 1 : 0,
    terminalState: command.timedOut
      ? "timeout"
      : command.exitCode === null
        ? "environment_error"
        : passed
          ? "resolved"
          : "task_failed",
    command,
    diff,
    changedFiles: options.changedFiles ?? changedFilesFromDiff(diff),
  };
}

function changedFilesFromDiff(diff: string): string[] {
  return [...new Set([...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]))];
}
