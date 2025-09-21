import { z, type ZodRawShape } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getActiveProfile, loadAuthProfiles } from '../../config/index.js';
import { ModelCatalog } from '../../core/model-catalog.js';

const CopilotAuthShape: ZodRawShape = {};
const CopilotAuthSchema = z.object(CopilotAuthShape);

export function registerCopilotAuthTool(server: McpServer): void {
  server.tool(
    'copilot-auth',
    'Report authentication and model catalog status',
    CopilotAuthShape,
    async (params) => {
      CopilotAuthSchema.parse(params);
      const activeProfileId = getActiveProfile();
      const profiles = loadAuthProfiles();

      if (!activeProfileId || !profiles[activeProfileId]) {
        return {
          content: [
            {
              type: 'text',
              text: 'Not authenticated. Run: copilot-cli auth login'
            }
          ],
          data: { authenticated: false }
        };
      }

      const profile = profiles[activeProfileId];
      const catalog = ModelCatalog.getInstance();
      const entry = catalog.getEntry(activeProfileId);

      const lines: string[] = [];
      lines.push(`Profile: ${activeProfileId}`);
      lines.push(`User: ${profile.user.name || profile.user.login} (@${profile.user.login})`);
      if (entry) {
        lines.push(`Models cached: ${entry.models.length}`);
        lines.push(`Catalog status: ${entry.status}`);
        lines.push(`Last updated: ${new Date(entry.updatedAt).toLocaleString()}`);
      } else {
        lines.push('Models cached: none');
        lines.push('Run: copilot-cli model refresh to populate the catalog');
      }

      return {
        content: [
          {
            type: 'text',
            text: lines.join('\n')
          }
        ],
        data: {
          authenticated: true,
          profile: {
            id: activeProfileId,
            user: profile.user
          },
          catalog: entry || null
        }
      };
    }
  );
}
