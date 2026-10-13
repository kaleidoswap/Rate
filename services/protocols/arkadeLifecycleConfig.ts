/** Defaults match the official wallet. Never attach a public delegate to a custom operator. */
export function arkadeLifecycleConfig(network: string, server: string, config: Record<string, any> = {}) {
  const nested = config.arkadeConfig ?? {};
  const url = server.replace(/\/+$/, '');
  const defaultUrl = network === 'mainnet' && url === 'https://arkade.computer'
    ? 'https://delegate.arkade.money'
    : ['signet', 'mutinynet'].includes(network) && url === 'https://mutinynet.arkade.sh'
      ? 'https://delegator.mutinynet.arkade.sh' : undefined;
  const configuredUrl = config.delegatorUrl ?? nested.delegatorUrl;
  const delegatorUrl = typeof configuredUrl === 'string' && /^https:\/\//.test(configuredUrl) ? configuredUrl : defaultUrl;
  return { delegatorUrl, delegationEnabled: (config.delegationEnabled ?? nested.delegationEnabled) !== false && !!delegatorUrl };
}
