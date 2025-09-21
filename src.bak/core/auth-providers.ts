export interface AuthProvider {
  id: string;
  name: string;
  clientId: string;
  scopes: string;
  owner?: string;
}

export const AUTH_PROVIDERS: AuthProvider[] = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    clientId: '01ab8ac9400c4e429b23',
    scopes: 'read:user user:email copilot',
    owner: 'visual-studio-code'
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot Plugin',
    clientId: 'Iv1.b507a08c87ecfe98',
    scopes: 'read:user user:email copilot',
    owner: 'github'
  },
  {
    id: 'github-cli',
    name: 'GitHub CLI',
    clientId: '178c6fc778ccc68e1d6a',
    scopes: 'read:user user:email copilot',
    owner: 'github'
  }
];

export function getProvider(id: string): AuthProvider | undefined {
  return AUTH_PROVIDERS.find(p => p.id === id);
}

export function getProviderByClientId(clientId: string): AuthProvider | undefined {
  return AUTH_PROVIDERS.find(p => p.clientId === clientId);
}
