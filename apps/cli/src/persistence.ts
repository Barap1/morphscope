import type { EvaluationResult } from "@morphscope/evaluator";
import { redactText } from "@morphscope/tracing";

export function persistedEvaluation(result: EvaluationResult | undefined): EvaluationResult | null {
  if (!result) return null;
  return {
    ...result,
    diff: redactText(result.diff).value,
    command: persistedCommand(result.command),
    validations: result.validations.map((validation) => ({
      ...validation,
      commandResult: persistedCommand(validation.commandResult),
    })),
  };
}

function persistedCommand<T extends { stdout: string; stderr: string }>(command: T): T {
  return {
    ...command,
    stdout: redactText(command.stdout).value,
    stderr: redactText(command.stderr).value,
  };
}
