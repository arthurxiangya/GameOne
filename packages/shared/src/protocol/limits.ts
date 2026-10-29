export const PROTOCOL_VERSION = 7;

/** Largest client message the server will parse. */
export const MAX_CLIENT_MESSAGE_BYTES = 8 * 1024;
/** Most input frames accepted in one message (covers a short client hitch). */
export const MAX_INPUT_FRAMES = 10;
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 14;
export const CHAT_MAX_LENGTH = 140;
/** Guest identity token: random hex generated and stored by the client. */
export const TOKEN_PATTERN = /^[a-f0-9]{32,64}$/;
