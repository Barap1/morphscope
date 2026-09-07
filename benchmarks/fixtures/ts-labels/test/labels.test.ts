import { formatLabel } from "../src/labels.js";

const actual = formatLabel("  MorphScope  ");
if (actual !== "morphscope") throw new Error(`Unexpected label: ${actual}`);
