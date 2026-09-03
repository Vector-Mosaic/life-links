import { createHash } from "node:crypto";
import { LifeLinkDomainError, normalizeRoutineBindingId, normalizeRoutineStepId } from "@life-links/core";

/** Shared HTTP/remote command preparation; canonical validation remains in core. */
export function routineDefinitionWithStableIds(input: Record<string, unknown>, revisionId: string): Record<string, unknown> {
  if (!Array.isArray(input.steps) || (input.bindings !== undefined && !Array.isArray(input.bindings))) {
    throw new LifeLinkDomainError("invalid_routine", "Routine definition Steps and bindings are invalid.", {
      reason: "invalid_definition"
    });
  }
  const steps = input.steps.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new LifeLinkDomainError("invalid_routine", "Routine Step is invalid.", { reason: "invalid_step" });
    }
    const step = value as Record<string, unknown>;
    return { ...step, id: normalizeRoutineStepId(step.id ?? stableRoutineNestedId("routine-step-", revisionId, "step", index)) };
  });
  const bindings = (input.bindings as unknown[] | undefined)?.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new LifeLinkDomainError("invalid_routine", "Routine context binding is invalid.", { reason: "invalid_binding" });
    }
    const binding = value as Record<string, unknown>;
    return {
      ...binding,
      id: normalizeRoutineBindingId(binding.id ?? stableRoutineNestedId("routine-binding-", revisionId, "binding", index))
    };
  });
  const { id: _id, revisionId: _revisionId, expectedCurrentRevisionId: _expectedRevision, ...definition } = input;
  return { ...definition, steps, ...(bindings === undefined ? {} : { bindings }) };
}

export function stableRoutineNestedId(prefix: "routine-step-" | "routine-binding-", revisionId: string, kind: string, index: number): string {
  const hex = createHash("sha256").update(`${revisionId}\u0000${kind}\u0000${index}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const uuid = `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
  return `${prefix}${uuid}`;
}
