import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const installer = readFileSync(resolve(process.cwd(), 'src-tauri/nsis/installer.nsi'), 'utf8');

describe('Windows installer data preservation', () => {
  it('only removes the application database and managed keys after explicit data-deletion consent', () => {
    const explicitDeletionBlock = installer.match(
      /\$\{If\} \$DeleteAppDataCheckboxState == 1([\s\S]*?)\$\{EndIf\}/,
    )?.[1];

    expect(explicitDeletionBlock).toContain('RmDir /r "$INSTDIR\\data"');
    expect(explicitDeletionBlock).toContain('RmDir /r "$INSTDIR\\ssh_keys"');
  });

  it('does not recursively delete the installation directory during normal uninstall/upgrade flow', () => {
    expect(installer).not.toContain('RmDir /r "$INSTDIR"');
  });
});
