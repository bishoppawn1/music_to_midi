import type { SensitivityId } from "./detection-settings";

export type SensitivityVersions<T> = Record<SensitivityId, T>;

export function activateSensitivityVersion<
  TVersion extends object,
  TResult extends {
    activeSensitivity: SensitivityId;
    variants: SensitivityVersions<TVersion>;
  },
>(result: TResult, sensitivity: SensitivityId): TResult & TVersion {
  return {
    ...result,
    ...result.variants[sensitivity],
    activeSensitivity: sensitivity,
  };
}

export function sensitivityVersionUrls(
  variants: SensitivityVersions<{ midiUrl: string }>,
) {
  return Array.from(
    new Set(Object.values(variants).map((variant) => variant.midiUrl)),
  );
}
