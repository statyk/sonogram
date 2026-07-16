import { DurableObject } from 'cloudflare:workers';
import type { Env } from './types';
import { err } from './http';

export class PostOffice extends DurableObject<Env> {
  async fetch(_request: Request): Promise<Response> {
    return err(501, 'not implemented');
  }
}
