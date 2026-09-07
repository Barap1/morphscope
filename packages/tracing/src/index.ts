export {
  TraceReader,
  TraceWriter,
  type SpanHandle,
  type TracePersistence,
  type TraceSnapshot,
} from "./trace-writer.js";
export { redactSecrets, redactText, type RedactionResult } from "./redaction.js";
