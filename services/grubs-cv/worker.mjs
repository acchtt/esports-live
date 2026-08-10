import { Container, getContainer } from '@cloudflare/containers';

export class GrubsCvContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '10m';

  onStart() {
    console.log('[grubs-cv] container started');
  }

  onStop() {
    console.log('[grubs-cv] container stopped');
  }

  onError(error) {
    console.error('[grubs-cv] container error', error);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isHealth = request.method === 'GET' && url.pathname === '/health';
    const isResult = request.method === 'GET' && url.pathname.startsWith('/v1/grubs/');

    // Keep the public prototype read-only. The container's manual capture route
    // stays blocked until we add an authenticated stream configuration path.
    if (!isHealth && !isResult) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }

    return getContainer(env.GRUBS_CV_CONTAINER, 'singleton').fetch(request);
  }
};
