import type { Env } from './types';
import { PostOffice } from './post-office';

export { PostOffice };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.POST_OFFICE.idFromName('singleton');
    return env.POST_OFFICE.get(id).fetch(request);
  },
};
