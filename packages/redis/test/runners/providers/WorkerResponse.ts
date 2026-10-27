export const deploymentHeader = "x-effect-redis-test-deployment";

/** Control-plane checks must identify the serving deployment and never cache authenticated readiness. */
export const workerResponse = (response: Response, deployment: string | undefined) => {
  if (deployment !== undefined) response.headers.set(deploymentHeader, deployment);
  response.headers.set("cache-control", "no-store");
  response.headers.set("vary", "authorization");
  return response;
};
