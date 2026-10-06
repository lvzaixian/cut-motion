export const isVisualOrchestrationVersion = (beatMap, version) =>
  beatMap?.visualOrchestrationVersion === version;
export const isVisualOrchestrationActive = (beatMap) =>
  isVisualOrchestrationVersion(beatMap, 1) || isVisualOrchestrationVersion(beatMap, 2);
export const isVisualOrchestrationV2 = (beatMap) =>
  isVisualOrchestrationVersion(beatMap, 2);
