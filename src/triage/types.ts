// --- Triage outcomes ---

export type TriageOutcome =
  | NewWorkflow
  | InProgressWorkflowAdjustment
  | ImmediateResponse;

// --- NewWorkflow ---

export interface NewWorkflow {
  kind: "new_workflow";
  resolution: NewWorkflowResolution;
  reasoning: string;
}

export type NewWorkflowResolution =
  | RunWorkflow
  | ConfirmWorkflow
  | SuggestWorkflows;

export interface RunWorkflow {
  type: "run";
  repoSlug: string;
  workflowFile: string;
  workflowName: string;
  inputs: Record<string, string>;
  worktreeId?: string;
}

export interface ConfirmWorkflow {
  type: "confirm";
  repoSlug: string;
  workflowFile: string;
  workflowName: string;
  inputs: Record<string, string>;
  worktreeId?: string;
}

export interface SuggestWorkflows {
  type: "suggest";
  suggestions: Array<{
    repoSlug: string;
    workflowFile: string;
    workflowName: string;
    inputs: Record<string, string>;
    description: string;
    worktreeId?: string;
  }>;
  prompt: string;
}

// --- InProgressWorkflowAdjustment ---

export interface InProgressWorkflowAdjustment {
  kind: "in_progress_workflow_adjustment";
  relatedRun: { repoSlug: string; worktreeId: string; runId: string };
  action: WorkflowAdjustmentAction;
  reasoning: string;
}

export type WorkflowAdjustmentAction =
  | { type: "rollback_to_step"; stepIndex: number }
  | { type: "retry_fresh"; inputsOverride?: Record<string, string> }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cancel" }
  | { type: "adjust"; instruction: string }
  | { type: "status_check" };

// --- ImmediateResponse ---

export interface ImmediateResponse {
  kind: "immediate_response";
  message: string;
  reasoning: string;
}

// --- JSON Schema for --json-schema flag ---

export const triageOutcomeJsonSchema = {
  type: "object",
  oneOf: [
    {
      properties: {
        kind: { const: "new_workflow" },
        resolution: {
          type: "object",
          oneOf: [
            {
              properties: {
                type: { const: "run" },
                repoSlug: { type: "string" },
                workflowFile: { type: "string" },
                workflowName: { type: "string" },
                inputs: { type: "object", additionalProperties: { type: "string" } },
                worktreeId: { type: "string" },
              },
              required: ["type", "repoSlug", "workflowFile", "workflowName", "inputs"],
            },
            {
              properties: {
                type: { const: "confirm" },
                repoSlug: { type: "string" },
                workflowFile: { type: "string" },
                workflowName: { type: "string" },
                inputs: { type: "object", additionalProperties: { type: "string" } },
                worktreeId: { type: "string" },
              },
              required: ["type", "repoSlug", "workflowFile", "workflowName", "inputs"],
            },
            {
              properties: {
                type: { const: "suggest" },
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      repoSlug: { type: "string" },
                      workflowFile: { type: "string" },
                      workflowName: { type: "string" },
                      inputs: { type: "object", additionalProperties: { type: "string" } },
                      description: { type: "string" },
                      worktreeId: { type: "string" },
                    },
                    required: ["repoSlug", "workflowFile", "workflowName", "inputs", "description"],
                  },
                },
                prompt: { type: "string" },
              },
              required: ["type", "suggestions", "prompt"],
            },
          ],
        },
        reasoning: { type: "string" },
      },
      required: ["kind", "resolution", "reasoning"],
    },
    {
      properties: {
        kind: { const: "in_progress_workflow_adjustment" },
        relatedRun: {
          type: "object",
          properties: {
            repoSlug: { type: "string" },
            worktreeId: { type: "string" },
            runId: { type: "string" },
          },
          required: ["repoSlug", "worktreeId", "runId"],
        },
        action: {
          type: "object",
          oneOf: [
            { properties: { type: { const: "rollback_to_step" }, stepIndex: { type: "number" } }, required: ["type", "stepIndex"] },
            {
              properties: {
                type: { const: "retry_fresh" },
                inputsOverride: {
                  type: "object",
                  additionalProperties: { type: "string" },
                },
              },
              required: ["type"],
            },
            { properties: { type: { const: "pause" } }, required: ["type"] },
            { properties: { type: { const: "resume" } }, required: ["type"] },
            { properties: { type: { const: "cancel" } }, required: ["type"] },
            { properties: { type: { const: "adjust" }, instruction: { type: "string" } }, required: ["type", "instruction"] },
            { properties: { type: { const: "status_check" } }, required: ["type"] },
          ],
        },
        reasoning: { type: "string" },
      },
      required: ["kind", "relatedRun", "action", "reasoning"],
    },
    {
      properties: {
        kind: { const: "immediate_response" },
        message: { type: "string" },
        reasoning: { type: "string" },
      },
      required: ["kind", "message", "reasoning"],
    },
  ],
} as const;
