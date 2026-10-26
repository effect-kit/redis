import { array } from "#/command/reply/Collections";
import { simpleText } from "#/command/reply/Data";
import { fields, help } from "#/commands/admin/Build";
import { name, sentinelCommand } from "#/commands/sentinel/Build";

export const sentinelCkQuorum = (service: string) =>
  sentinelCommand("CKQUORUM", simpleText, name(service));
export const sentinelHelp = () => sentinelCommand("HELP", help);
export const sentinelMyId = () => sentinelCommand("MYID", simpleText);
export const sentinelPendingScripts = () => sentinelCommand("PENDING-SCRIPTS", array(fields));
