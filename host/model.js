/** Credential for one source, config field first, environment second. */
export function secret(config, field, envName) {
  const fromConfig = config?.[field];
  if (typeof fromConfig === 'string' && fromConfig.trim() !== '') return fromConfig.trim();
  const fromEnv = process.env[envName];
  return typeof fromEnv === 'string' ? fromEnv.trim() : '';
}

/** Target language, overridable per request. */
export function targetLanguage(config, requested) {
  if (typeof requested === 'string' && /^[A-Za-z-]{2,12}$/.test(requested)) return requested;
  const configured = config?.target ?? process.env.DSH_ENGLISH_READER_TARGET;
  return typeof configured === 'string' && /^[A-Za-z-]{2,12}$/.test(configured) ? configured : 'zh-CN';
}

/** The route this Harness is already configured to talk to. */
export function defaultModelRoute(ctx) {
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
    if (selection !== undefined && selection !== null && typeof selection.provider === 'string' && typeof selection.model === 'string') {
      return { provider: selection.provider, model: selection.model };
    }
  } catch { /* no default configured */ }
  try {
    const [first] = ctx.get('llm')?.listProviders?.() ?? [];
    if (first !== undefined) return { provider: first.id, model: '' };
  } catch { /* no providers */ }
  return undefined;
}

