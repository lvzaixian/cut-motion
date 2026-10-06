const serializedFrameTolerance = (fps) => (Number(fps) * 0.5e-6) + 1e-9;

const snappedFrameProduct = (seconds, fps) => {
  const product = Number(seconds) * fps;
  const nearestFrame = Math.round(product);
  return Math.abs(product - nearestFrame) <= serializedFrameTolerance(fps) ? nearestFrame : product;
};

export const durationToFrames = (duration, fps) => Math.ceil(snappedFrameProduct(duration, fps));

export const quantizeFrameWindow = (start, end, fps, totalFrames) => ({
  startFrame: Math.max(0, Math.min(totalFrames, Math.floor(snappedFrameProduct(start, fps)))),
  endFrame: Math.max(0, Math.min(totalFrames, Math.ceil(snappedFrameProduct(end, fps))))
});

export const captionFrameWindow = (cue, totalFrames = Number.POSITIVE_INFINITY) => {
  const startFrame = Number(cue?.startFrame);
  const endFrame = Number(cue?.endFrame);
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame)
    || startFrame < 0 || endFrame <= startFrame || endFrame > totalFrames) {
    throw new Error(`${cue?.id ?? "Caption cue"} requires a positive half-open integer frame window`);
  }
  return { startFrame, endFrame };
};

export const intersectFrameWindows = (left, right) => {
  const startFrame = Math.max(left.startFrame, right.startFrame);
  const endFrame = Math.min(left.endFrame, right.endFrame);
  return endFrame > startFrame ? { startFrame, endFrame } : null;
};

export const frameWindowsOverlap = (left, right) => intersectFrameWindows(left, right) !== null;
