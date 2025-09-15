export interface AuthProvider {
  id: string;
  name: string;
  clientId: string;
  scopes: string;
  description: string;
}

export const AUTH_PROVIDERS: AuthProvider[] = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    clientId: '01ab8ac9400c4e429b23',
    scopes: 'read:user user:email copilot',  // Minimal scope
    description: 'Standard VS Code authentication (widely trusted)'
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot Plugin',
    clientId: 'Iv1.b507a08c87ecfe98',
    scopes: 'read:user user:email copilot',  // Copilot-specific only
    description: 'Minimal Copilot-only permissions'
  },
  {
    id: 'git-credential-manager',
    name: 'Git Credential Manager',
    clientId: '0120e057bd645470c1ed',
    scopes: 'read:user user:email copilot',  // Minimal scope
    description: 'Git Credential Manager authentication'
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    clientId: '178c6fc778ccc68e1d6a',
    scopes: 'read:user user:email copilot',  // Minimal scope
    description: 'Sublime Text'
  },
  {
    id: 'github-cli',
    name: 'GitHub CLI (gh)',
    clientId: 'Iv1.f9b7bf395eacadbfd',
    scopes: 'read:user user:email copilot',  // Minimal scope
    description: 'GitHub CLI (gh)'
  }
];

export function getProvider(id: string): AuthProvider | undefined {
  return AUTH_PROVIDERS.find(p => p.id === id);
}

export function getProviderByClientId(clientId: string): AuthProvider | undefined {
  return AUTH_PROVIDERS.find(p => p.clientId === clientId);
}
