import { handleRequest } from '../server/sync-server.mjs'

export default async function handler(request, response) {
  const requestUrl = new URL(request.url || '/', 'http://localhost')
  const rewrittenPath = requestUrl.searchParams.get('__noclick_path')

  if (rewrittenPath) {
    requestUrl.searchParams.delete('__noclick_path')
    const query = requestUrl.searchParams.toString()
    request.url = `${rewrittenPath}${query ? `?${query}` : ''}`
  }

  await handleRequest(request, response)
}
