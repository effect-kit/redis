/** Cloudflare downloads text parts without filenames; uploads require actual module file parts. */
export const restorationBody = (
  original: Iterable<readonly [string, string | Blob]>,
  entrypoint: string,
  settings: {
    readonly compatibility_date: string;
    readonly compatibility_flags?: ReadonlyArray<string>;
  },
) => {
  const body = new FormData();
  for (const [name, value] of original)
    if (name !== "metadata")
      body.append(
        name,
        typeof value === "string"
          ? new File([value], name, { type: "application/javascript+module" })
          : value,
      );

  body.set(
    "metadata",
    JSON.stringify({
      main_module: entrypoint,
      compatibility_date: settings.compatibility_date,
      compatibility_flags: settings.compatibility_flags ?? [],
      bindings: [],
    }),
  );
  return body;
};
