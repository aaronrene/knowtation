// Fault injection for the isolated gateway process, never used by the application.
export async function load(url, context, nextLoad) {
  const target = process.env.GATEWAY_TEST_MODULE;
  if (target && url.endsWith(`/hub/gateway/${target}.mjs`)) {
    if (process.env.GATEWAY_TEST_FAULT === 'import') {
      throw new Error('Injected gateway module load failure');
    }
    if (process.env.GATEWAY_TEST_FAULT === 'factory') {
      const factory = target === 'agent-credential-routes' ? 'createAgentCredentialRouter' : 'createNativeOAuthRouter';
      return {
        format: 'module', shortCircuit: true,
        source: `export function ${factory}() { throw new Error("Injected router construction failure"); }`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return nextLoad(url, context);
}
