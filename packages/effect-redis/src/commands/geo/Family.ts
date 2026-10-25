import type { RedisExecutor } from "#/command/Executor";
import * as Commands from "#/commands/geo/index";

export const geoFamily = (executor: RedisExecutor) => ({
  georadius: (...args: Parameters<typeof Commands.georadius>) =>
    executor.execute(Commands.georadius(...args)),

  georadiusRo: (...args: Parameters<typeof Commands.georadiusRo>) =>
    executor.execute(Commands.georadiusRo(...args)),

  georadiusbymember: (...args: Parameters<typeof Commands.georadiusbymember>) =>
    executor.execute(Commands.georadiusbymember(...args)),

  georadiusbymemberRo: (...args: Parameters<typeof Commands.georadiusbymemberRo>) =>
    executor.execute(Commands.georadiusbymemberRo(...args)),

  georadiusWith: (...args: Parameters<typeof Commands.georadiusWith>) =>
    executor.execute(Commands.georadiusWith(...args)),

  georadiusStore: (...args: Parameters<typeof Commands.georadiusStore>) =>
    executor.execute(Commands.georadiusStore(...args)),

  geosearch: (...args: Parameters<typeof Commands.geosearch>) =>
    executor.execute(Commands.geosearch(...args)),

  geosearchWith: (...args: Parameters<typeof Commands.geosearchWith>) =>
    executor.execute(Commands.geosearchWith(...args)),

  geosearchstore: (...args: Parameters<typeof Commands.geosearchstore>) =>
    executor.execute(Commands.geosearchstore(...args)),

  geoadd: (...args: Parameters<typeof Commands.geoadd>) =>
    executor.execute(Commands.geoadd(...args)),

  geohash: (...args: Parameters<typeof Commands.geohash>) =>
    executor.execute(Commands.geohash(...args)),

  geopos: (...args: Parameters<typeof Commands.geopos>) =>
    executor.execute(Commands.geopos(...args)),

  geodist: (...args: Parameters<typeof Commands.geodist>) =>
    executor.execute(Commands.geodist(...args)),

  geodistToken: (...args: Parameters<typeof Commands.geodistToken>) =>
    executor.execute(Commands.geodistToken(...args)),
});
