/** Weak identities bind cached frames to a private snapshot and one immutable admission policy. */
const encoded = new WeakMap<object, WeakMap<object, ReadonlyArray<ReadonlyArray<Uint8Array>>>>();

export const registerCompiledFrames = (commands: object) => {
  encoded.set(commands, new WeakMap());
};

export const cachedGroups = (commands: object, limits: object) =>
  encoded.get(commands)?.get(limits);

export const cacheGroups = (
  commands: object,
  limits: object,
  groups: ReadonlyArray<ReadonlyArray<Uint8Array>>,
) => {
  encoded.get(commands)?.set(limits, groups);
};
