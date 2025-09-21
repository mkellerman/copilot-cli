import { ConfigManager, type ConfigIssue } from '../../../core/config-manager.js';

export async function runDoctorCommand(): Promise<void> {
  const manager = ConfigManager.getInstance();
  const report = manager.doctor();

  if (report.ok) {
    console.log('✓ Configuration is valid');
  } else {
    console.log('✗ Configuration issues detected:');
    report.issues.forEach((issue) => printIssue(issue));
  }

  console.log('\nEffective configuration:');
  console.log(JSON.stringify(report.config, null, 2));
}

function printIssue(issue: ConfigIssue): void {
  const location = issue.path ?? '*';
  const valueHint = issue.value !== undefined ? ` (value: ${JSON.stringify(issue.value)})` : '';
  console.log(` - [${issue.source}] ${location}: ${issue.message}${valueHint}`);
}
