export function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  return { ...(origin && allowed.includes(origin) ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,mcp-protocol-version,mcp-method',
    'access-control-expose-headers': 'www-authenticate', vary: 'Origin' };
}
