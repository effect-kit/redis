import type { CommandInputError } from "#/errors/CommandInputError";
import type { ConnectionError } from "#/errors/ConnectionError";
import type { HandshakeError } from "#/errors/HandshakeError";
import type { ProtocolError } from "#/errors/ProtocolError";
import type { ReplyError } from "#/errors/ReplyError";
import type { ServerError } from "#/errors/ServerError";
import type { SubscriptionError } from "#/errors/SubscriptionError";
import type { TransportError } from "#/errors/TransportError";

export type EventError =
  | CommandInputError
  | ConnectionError
  | HandshakeError
  | ProtocolError
  | ReplyError
  | ServerError
  | SubscriptionError
  | TransportError;
