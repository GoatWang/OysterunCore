export type OysterunToolDetailResponseExpectation = {
  toolStorageGeneration: 'sqlite_continuation_v1';
  page?: number;
};

const TOOL_DETAIL_PIPELINE_MISMATCH_MESSAGE =
  'Tool Detail response is incomplete because this Host is still running an older Tool Detail pipeline. Restart the Oysterun Host, then reopen this detail.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toolDetailPipelineMismatch(): Error {
  return new Error(TOOL_DETAIL_PIPELINE_MISMATCH_MESSAGE);
}

export function assertOysterunToolEventDetailResponseContract<T>(
  value: unknown,
  expected: OysterunToolDetailResponseExpectation
): T {
  if (!isRecord(value)) throw toolDetailPipelineMismatch();

  const expectedPage = expected.page ?? 1;
  const page = value.page;
  const pageCount = value.page_count;
  const physicalEventCount = value.physical_event_count;
  const logicalInvocationCount = value.logical_invocation_count;
  const invocations = value.invocations;
  const currentPipelineProven =
    value.status === 'ok' &&
    value.tool_storage_generation === expected.toolStorageGeneration &&
    value.matrix_retained_plus_sqlite_continuation === true &&
    value.continuation_storage_kind === 'host_tool_event_continuation_sqlite';
  const pageShapeValid =
    Number.isSafeInteger(page) &&
    Number(page) === expectedPage &&
    Number.isSafeInteger(pageCount) &&
    Number(pageCount) >= 1 &&
    Number(page) <= Number(pageCount);
  const countShapeValid =
    Number.isSafeInteger(physicalEventCount) &&
    Number(physicalEventCount) >= 1 &&
    Number.isSafeInteger(logicalInvocationCount) &&
    Number(logicalInvocationCount) >= 1 &&
    Number(physicalEventCount) >= Number(logicalInvocationCount);
  const invocationShapeValid =
    Array.isArray(invocations) &&
    invocations.length > 0 &&
    invocations.length <= Number(logicalInvocationCount) &&
    invocations.every(isRecord);

  if (!currentPipelineProven || !pageShapeValid || !countShapeValid || !invocationShapeValid) {
    throw toolDetailPipelineMismatch();
  }
  return value as T;
}
