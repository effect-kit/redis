import type { Socket } from "bun";

/** Chain authorization alone is insufficient: also bind the peer to the dial/SNI identity. */
export const verifyIdentity = (socket: Socket, hostname: string) => {
  const certificate = socket.getPeerX509Certificate();
  const ip = hostname.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
  const matched = ip
    ? certificate.checkIP(hostname)
    : certificate.checkHost(hostname, { partialWildcards: false });

  if (matched === undefined) throw new Error("TLS peer identity mismatch");
};
