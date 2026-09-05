import type { FastifyReply } from 'fastify';
import { isUuid } from '../domain/ids.js';

export { UUID_SHAPE, isUuid } from '../domain/ids.js';

/**
 * Guards a JSON route's id parameter.
 *
 * A malformed id is a 404, not a 400 and not a 500: the client asked for a record
 * that cannot exist, and the answer should not be a PostgreSQL error message
 * describing the type it failed to cast to.
 */
export function validUuid(id: unknown, reply: FastifyReply): id is string {
  if (isUuid(id)) return true;
  reply.code(404).send({ ok: false, message: 'Not found' });
  return false;
}
