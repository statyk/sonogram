import type { Env } from '../src/types';
import type { PostOffice } from '../src/post-office';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Omit<Env, 'POST_OFFICE'> {
    POST_OFFICE: DurableObjectNamespace<PostOffice>;
  }
}
