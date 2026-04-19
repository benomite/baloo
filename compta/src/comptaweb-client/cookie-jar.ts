// Cookie jar minimaliste pour le flow d'auth multi-domaine Keycloak + sirom.net.
// Ne gère pas la totalité de la RFC 6265 (expiry, path matching strict) : on s'en
// tient aux attributs utiles pour ce flow précis.

export class CookieJar {
  private byDomain = new Map<string, Map<string, string>>();

  absorb(headers: Headers, requestUrl: URL): void {
    const rawCookies = this.extractSetCookies(headers);
    for (const raw of rawCookies) {
      this.addFromSetCookie(raw, requestUrl.hostname);
    }
  }

  private extractSetCookies(headers: Headers): string[] {
    const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
    if (typeof anyHeaders.getSetCookie === 'function') {
      return anyHeaders.getSetCookie();
    }
    const single = headers.get('set-cookie');
    return single ? [single] : [];
  }

  private addFromSetCookie(raw: string, fallbackDomain: string): void {
    const parts = raw.split(';');
    const [nameValue, ...attrs] = parts;
    const eq = nameValue.indexOf('=');
    if (eq === -1) return;
    const name = nameValue.slice(0, eq).trim();
    const value = nameValue.slice(eq + 1).trim();
    let domain = fallbackDomain;
    for (const attr of attrs) {
      const [k, v] = attr.split('=');
      if (k.trim().toLowerCase() === 'domain' && v) {
        domain = v.trim().replace(/^\./, '');
      }
    }
    if (!this.byDomain.has(domain)) this.byDomain.set(domain, new Map());
    this.byDomain.get(domain)!.set(name, value);
  }

  header(hostname: string): string {
    const pairs: string[] = [];
    for (const [domain, cookies] of this.byDomain) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        for (const [k, v] of cookies) pairs.push(`${k}=${v}`);
      }
    }
    return pairs.join('; ');
  }

  cookiesFor(hostname: string): Array<{ name: string; value: string }> {
    const out: Array<{ name: string; value: string }> = [];
    for (const [domain, cookies] of this.byDomain) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        for (const [name, value] of cookies) out.push({ name, value });
      }
    }
    return out;
  }
}
